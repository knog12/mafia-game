const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

// **مهم:** تأكد أن هذا الرابط هو رابط سيرفرك على Render
// مثال: const socket = io('https://mafia-game-dpfv.onrender.com');
const RENDER_SERVER_URL = 'https://mafia-game-dpfv.onrender.com';

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // هذا يسمح لـ Vercel بالاتصال
    origin: [
      "https://mafia-game.vercel.app", // ضع رابط Vercel هنا (مع اسم مشروعك)
      "http://localhost:5173" // للمطورين (أنت)
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  // **الإضافة الأهم لحل مشكلة الجوالات (Websockets):**
  transports: ['websocket', 'polling']
});

// === متغيرات اللعبة ===
const rooms = {}; // لتخزين بيانات كل غرفة

// === مراحل اللعبة ===
const PHASES = {
  LOBBY: 'LOBBY',
  NIGHT_SLEEP: 'NIGHT_SLEEP',
  NIGHT_MAFIA: 'NIGHT_MAFIA',
  NIGHT_NURSE: 'NIGHT_NURSE',
  NIGHT_DETECTIVE: 'NIGHT_DETECTIVE',
  DAY_WAKE: 'DAY_WAKE',
  DAY_RESULTS: 'DAY_RESULTS',
  DAY_DISCUSSION: 'DAY_DISCUSSION',
  DAY_VOTING: 'DAY_VOTING',
  GAME_OVER: 'GAME_OVER'
};

// === دوال مساعدة ===
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// === بداية الاتصال ===
io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

  // 1. إنشاء غرفة
  socket.on('create_room', ({ playerName }) => {
    const roomId = uuidv4().substring(0, 4).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      players: [],
      phase: PHASES.LOBBY,
      mafiaTarget: null,
      nurseTarget: null,
      detectiveCheck: null,
      votes: {},
      winner: null
    };
    socket.join(roomId);
    // نضيف الهوست كلاعب (التعديل الجذري لضمان عمل الزر على الجوال)
    rooms[roomId].players.push({
      id: socket.id,
      name: playerName,
      role: 'PENDING', // نجعله Pending لتوحيد الأدوار قبل بدء اللعبة
      isAlive: true,
      avatar: Math.floor(Math.random() * 10), // صورة عشوائية
      isHost: true, // الأهم: نثبت أنه الهوست
      hasSelfHealed: false // خاص بالممرضة
    });
    socket.emit('room_created', roomId);
    io.to(roomId).emit('update_players', rooms[roomId].players);
  });

  // 2. دخول غرفة
  socket.on('join_room', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (room && room.phase === PHASES.LOBBY) {
      socket.join(roomId);
      room.players.push({
        id: socket.id,
        name: playerName,
        role: 'PENDING',
        isAlive: true,
        avatar: Math.floor(Math.random() * 10),
        isHost: false,
        hasSelfHealed: false
      });
      io.to(roomId).emit('update_players', room.players);
      // إرسال حالة الغرفة للاعب الجديد
      socket.emit('game_state_update', { phase: room.phase });
    } else {
      socket.emit('error', 'الغرفة غير موجودة أو اللعبة بدأت');
    }
  });

  // 3. بدء اللعبة (توزيع الأدوار)
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];

    // **التعديل الثاني:** التحقق من دور الهوست الفعلي
    const hostPlayer = room.players.find(p => p.id === socket.id && p.isHost);
    if (!room || !hostPlayer) return;

    const playerCount = room.players.length;
    let mafiaCount = playerCount < 9 ? 1 : 2;

    // تجهيز قائمة الأدوار
    let roles = [];
    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    roles.push('DOCTOR'); // الممرضة
    roles.push('DETECTIVE'); // الشايب

    // الباقي مواطنين
    while (roles.length < playerCount) {
      roles.push('CITIZEN');
    }

    roles = shuffleArray(roles);

    // توزيع الأدوار على اللاعبين
    room.players.forEach((player, index) => {
      player.role = roles[index];
    });

    io.to(roomId).emit('game_started', room.players); // يرسل لكل واحد دوره
    startNightCycle(roomId);
  });

  // === إدارة جولات الليل ===
  function startNightCycle(roomId) {
    const room = rooms[roomId];
    // تصفية الاختيارات السابقة
    room.mafiaTarget = null;
    room.nurseTarget = null;
    room.detectiveCheck = null;

    // المرحلة 1: النوم
    updatePhase(roomId, PHASES.NIGHT_SLEEP);
    io.to(roomId).emit('play_audio', 'everyone_sleep'); // تشغيل صوت النوم عند الهوست

    setTimeout(() => {
      // المرحلة 2: المافيا
      updatePhase(roomId, PHASES.NIGHT_MAFIA);
      io.to(roomId).emit('play_audio', 'mafia_wake');
    }, 4000); // 4 ثواني للنوم
  }

  // استقبال الأكشن من اللاعبين (قتل، حماية، كشف)
  socket.on('player_action', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    const player = room.players.find(p => p.id === socket.id);
    if (!room || !player || !player.isAlive) return;

    // أكشن المافيا
    if (room.phase === PHASES.NIGHT_MAFIA && player.role === 'MAFIA') {
      room.mafiaTarget = targetId;
      // إذا فيه 2 مافيا، يكفي واحد يختار عشان نمشي اللعب بسرعة (أو ننتظر اتفاقهم - هنا سنسرع اللعب)

      // ننتقل للممرضة بعد 3 ثواني
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_NURSE);
        io.to(roomId).emit('play_audio', 'nurse_wake');
      }, 3000);
    }

    // أكشن الممرضة
    if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      // التحقق من قاعدة "علاج النفس مرة واحدة"
      if (targetId === socket.id) {
        if (player.hasSelfHealed) {
          socket.emit('error', 'لقد عالجت نفسك سابقاً!');
          return;
        }
        player.hasSelfHealed = true; // استهلكت المحاولة
      }

      room.nurseTarget = targetId;

      // ننتقل للشايب بعد 3 ثواني
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 3000);
    }

    // أكشن الشايب
    if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const targetPlayer = room.players.find(p => p.id === targetId);
      const result = targetPlayer.role === 'MAFIA' ? 'مافيا (MAFIA)' : 'بريء (Citizen/Doc)';
      socket.emit('investigation_result', result); // النتيجة تروح للشايب بس

      // ننتقل للصباح بعد 3 ثواني
      setTimeout(() => {
        calculateResults(roomId);
      }, 3000);
    }
  });

  // === حساب النتائج والصباح ===
  function calculateResults(roomId) {
    const room = rooms[roomId];
    updatePhase(roomId, PHASES.DAY_WAKE);
    io.to(roomId).emit('play_audio', 'everyone_wake');

    let msg = "";
    let audioToPlay = "";

    if (room.mafiaTarget && room.mafiaTarget !== room.nurseTarget) {
      // نجح القتل
      const victimIndex = room.players.findIndex(p => p.id === room.mafiaTarget);
      if (victimIndex !== -1) {
        room.players[victimIndex].isAlive = false;
        msg = `للأسف... تم اغتيال اللاعب ${room.players[victimIndex].name}`;
        audioToPlay = 'result_success';
      }
    } else {
      // فشل القتل (الممرضة انقذته)
      msg = "الليلة كانت آمنة! لم يمت أحد.";
      audioToPlay = 'result_fail';
    }

    io.to(roomId).emit('day_result', { msg, players: room.players });
    io.to(roomId).emit('play_audio', audioToPlay);

    checkWinCondition(roomId);

    // بدء المؤقت للنقاش
    setTimeout(() => {
      if (room.phase !== PHASES.GAME_OVER) {
        updatePhase(roomId, PHASES.DAY_DISCUSSION);
        // مؤقت 1:45 دقيقة
        let timeLeft = 105;
        const timer = setInterval(() => {
          if (room.phase !== PHASES.DAY_DISCUSSION) { clearInterval(timer); return; }
          io.to(roomId).emit('timer_update', timeLeft);
          timeLeft--;
          if (timeLeft < 0) {
            clearInterval(timer);
            startVoting(roomId);
          }
        }, 1000);
      }
    }, 5000); // 5 ثواني عرض النتيجة
  }

  function startVoting(roomId) {
    updatePhase(roomId, PHASES.DAY_VOTING);
    rooms[roomId].votes = {};
  }

  // استقبال التصويت
  socket.on('vote_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (room.phase !== PHASES.DAY_VOTING) return;

    // تخزين التصويت
    room.votes[socket.id] = targetId;

    // التحقق هل الجميع صوت؟ (الأحياء فقط)
    const alivePlayers = room.players.filter(p => p.isAlive).length;
    if (Object.keys(room.votes).length >= alivePlayers) {
      processVoting(roomId);
    }
  });

  function processVoting(roomId) {
    const room = rooms[roomId];
    const voteCounts = {};

    Object.values(room.votes).forEach(targetId => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    // إيجاد أكثر شخص حصل على تصويت
    let maxVotes = 0;
    let kickedId = null;
    for (const [id, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        kickedId = id;
      }
    }

    if (kickedId) {
      const pIndex = room.players.findIndex(p => p.id === kickedId);
      room.players[pIndex].isAlive = false;
      io.to(roomId).emit('player_kicked', { name: room.players[pIndex].name });
    }

    checkWinCondition(roomId);

    if (room.phase !== PHASES.GAME_OVER) {
      // العودة لليل
      setTimeout(() => {
        startNightCycle(roomId);
      }, 5000);
    }
  }

  function checkWinCondition(roomId) {
    const room = rooms[roomId];
    const mafiaAlive = room.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const citizensAlive = room.players.filter(p => p.isAlive && p.role !== 'MAFIA').length; // الكل ضد المافيا

    if (mafiaAlive === 0) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'CITIZENS');
    } else if (mafiaAlive >= citizensAlive) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'MAFIA');
    }
  }

  function updatePhase(roomId, newPhase) {
    if (rooms[roomId]) {
      rooms[roomId].phase = newPhase;
      io.to(roomId).emit('phase_change', newPhase);
    }
  }

  socket.on('disconnect', () => {
    console.log('User Disconnected', socket.id);
    // التعامل مع خروج اللاعب (اختياري: يمكن إنهاء اللعبة أو تحويله لميت)
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});