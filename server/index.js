const express = require('express');
const http = require = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

// **مهم:** ضع رابط الواجهة (Vercel) الخاص بك هنا (مثال فقط)
const VERCEL_URL = 'https://mafia-game.vercel.app';

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [VERCEL_URL, "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// === متغيرات اللعبة ===
const rooms = {};

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
  HOST_DECISION: 'HOST_DECISION', // مرحلة جديدة لقرار الهوست
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
    rooms[roomId].players.push({
      id: socket.id,
      name: playerName,
      role: 'PENDING',
      isAlive: true,
      avatar: Math.floor(Math.random() * 10),
      isHost: true,
      hasSelfHealed: false
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
      socket.emit('game_state_update', { phase: room.phase });
    } else {
      socket.emit('error', 'الغرفة غير موجودة أو اللعبة بدأت');
    }
  });

  // 3. بدء اللعبة (توزيع الأدوار)
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    const hostPlayer = room.players.find(p => p.id === socket.id && p.isHost);
    if (!room || !hostPlayer) return;

    const playerCount = room.players.length;
    let mafiaCount = playerCount < 9 ? 1 : 2;

    let roles = [];
    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    roles.push('DOCTOR');
    roles.push('DETECTIVE');

    while (roles.length < playerCount) {
      roles.push('CITIZEN');
    }

    roles = shuffleArray(roles);

    room.players.forEach((player, index) => {
      player.role = roles[index];
    });

    io.to(roomId).emit('game_started', room.players);
    startNightCycle(roomId);
  });

  // === إدارة جولات الليل ===
  function startNightCycle(roomId) {
    const room = rooms[roomId];
    room.mafiaTarget = null;
    room.nurseTarget = null;
    room.detectiveCheck = null;

    updatePhase(roomId, PHASES.NIGHT_SLEEP);
    io.to(roomId).emit('play_audio', 'everyone_sleep');

    setTimeout(() => {
      updatePhase(roomId, PHASES.NIGHT_MAFIA);
      io.to(roomId).emit('play_audio', 'mafia_wake');
    }, 4000);
  }

  // استقبال الأكشن من اللاعبين (قتل، حماية، كشف)
  socket.on('player_action', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    const player = room.players.find(p => p.id === socket.id);
    if (!room || !player || !player.isAlive) return;

    if (room.phase === PHASES.NIGHT_MAFIA && player.role === 'MAFIA') {
      room.mafiaTarget = targetId;

      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_NURSE);
        io.to(roomId).emit('play_audio', 'nurse_wake');
      }, 3000);
    }

    if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      if (targetId === socket.id) {
        if (player.hasSelfHealed) {
          socket.emit('error', 'لقد عالجت نفسك سابقاً!');
          return;
        }
        player.hasSelfHealed = true;
      }

      room.nurseTarget = targetId;

      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 3000);
    }

    if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const targetPlayer = room.players.find(p => p.id === targetId);
      const result = targetPlayer.role === 'MAFIA' ? 'مافيا (MAFIA)' : 'بريء (Citizen/Doc)';
      socket.emit('investigation_result', result);

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
      const victimIndex = room.players.findIndex(p => p.id === room.mafiaTarget);
      if (victimIndex !== -1) {
        room.players[victimIndex].isAlive = false;
        msg = `للأسف... تم اغتيال اللاعب ${room.players[victimIndex].name}`;
        audioToPlay = 'result_success';
      }
    } else {
      msg = "الليلة كانت آمنة! لم يمت أحد.";
      audioToPlay = 'result_fail';
    }

    io.to(roomId).emit('day_result', { msg, players: room.players });
    io.to(roomId).emit('play_audio', audioToPlay);

    checkWinCondition(roomId);

    setTimeout(() => {
      if (room.phase !== PHASES.GAME_OVER) {
        updatePhase(roomId, PHASES.DAY_DISCUSSION);
        let timeLeft = 105;
        const timer = setInterval(() => {
          if (room.phase !== PHASES.DAY_DISCUSSION) { clearInterval(timer); return; }
          io.to(roomId).emit('timer_update', timeLeft);
          timeLeft--;
          if (timeLeft < 0) {
            clearInterval(timer);
            startVoting(roomId); // ينتقل لـ DAY_VOTING
          }
        }, 1000);
      }
    }, 5000);
  }

  function startVoting(roomId) {
    updatePhase(roomId, PHASES.DAY_VOTING);
    rooms[roomId].votes = {};
  }

  // استقبال التصويت (لا تتم المعالجة التلقائية بعد الآن)
  socket.on('vote_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (room.phase !== PHASES.DAY_VOTING) return;

    // يقوم اللاعب بالتصويت ويتم حفظ التصويت فوراً
    room.votes[socket.id] = targetId;

    // إرسال تحديث للهوست (وشاشة التصويت)
    io.to(roomId).emit('update_votes', room.votes);

    // هنا لا يتم استدعاء processVoting تلقائياً، بل ننتظر قرار الهوست
  });

  // عند انتهاء مهلة التصويت (إذا أردنا إضافة مؤقت للتصويت)
  // نعتبر أن انتهاء مهلة النقاش هو المهلة الوحيدة، وبعدها نرسل النتائج للهوست

  // دالة خاصة لإرسال النتائج للهوست لاتخاذ القرار
  function processVotingForHost(roomId) {
    const room = rooms[roomId];
    updatePhase(roomId, PHASES.HOST_DECISION); // مرحلة جديدة

    const voteCounts = {};
    Object.values(room.votes).forEach(targetId => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    // إيجاد أكثر شخص حصل على تصويت
    let maxVotes = 0;
    let candidateId = null;
    for (const [id, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        candidateId = id;
      }
    }

    const candidate = room.players.find(p => p.id === candidateId);

    // إرسال النتائج للهوست فقط
    io.to(room.hostId).emit('host_needs_decision', {
      candidateName: candidate ? candidate.name : 'لا يوجد مرشح واضح',
      candidateId: candidateId,
      voteCounts: voteCounts,
      players: room.players // لإظهار قائمة اللاعبين
    });
  }

  // ربط انتهاء التصويت بدالة الإرسال للهوست
  socket.on('end_voting_host', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return; // تأكد أنه الهوست

    processVotingForHost(roomId);
  });

  // قرار الهوست النهائي (إما طرد أو سكب)
  socket.on('host_made_decision', ({ roomId, decision, kickedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId || room.phase !== PHASES.HOST_DECISION) return;

    if (decision === 'KICK') {
      const pIndex = room.players.findIndex(p => p.id === kickedPlayerId);
      if (pIndex !== -1) {
        room.players[pIndex].isAlive = false;
        io.to(roomId).emit('player_kicked', { name: room.players[pIndex].name });
        io.to(roomId).emit('game_message', `قرر الهوست طرد اللاعب: ${room.players[pIndex].name}`);
      }
    } else if (decision === 'SKIP') {
      io.to(roomId).emit('game_message', 'قرر الهوست عدم طرد أحد هذه الجولة.');
    }

    checkWinCondition(roomId);

    if (room.phase !== PHASES.GAME_OVER) {
      setTimeout(() => {
        startNightCycle(roomId);
      }, 5000);
    }
  });


  function checkWinCondition(roomId) {
    const room = rooms[roomId];
    const mafiaAlive = room.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const citizensAlive = room.players.filter(p => p.isAlive && p.role !== 'MAFIA').length;

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
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});