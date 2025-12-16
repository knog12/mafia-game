const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

const VERCEL_URL = 'https://mafia-game.vercel.app';

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
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
  DAY_DISCUSSION: 'DAY_DISCUSSION',
  GAME_OVER: 'GAME_OVER'
};

const AVATARS = ['👨', '👩', '🕵️', '🤠', '🧙', '🧛', '🤖', '👽', '🤡', '👹'];

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
  socket.on('create_room', ({ playerName, playerId }) => {
    // التحقق من البيانات
    if (!playerId) {
      socket.emit('error', 'Missing Player ID');
      return;
    }

    const roomId = uuidv4().substring(0, 4).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      hostId: playerId,
      players: [],
      phase: PHASES.LOBBY,
      mafiaTarget: null,
      nurseTarget: null,
      detectiveCheck: null,
      winner: null
    };
    socket.join(roomId);

    // إضافة اللاعب (الهوست)
    const newHost = {
      id: playerId,
      socketId: socket.id,
      name: playerName,
      role: 'PENDING',
      isAlive: true,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      isHost: true,
      hasSelfHealed: false
    };

    rooms[roomId].players.push(newHost);
    socket.emit('room_created', roomId);
    io.to(roomId).emit('update_players', rooms[roomId].players);
    console.log(`Room ${roomId} created by ${playerName} (${playerId})`);
  });

  // 2. دخول غرفة / إعادة الاتصال (Persistence)
  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', 'الغرفة غير موجودة');
      return;
    }

    if (!playerId) {
      socket.emit('error', 'Missing Player ID');
      return;
    }

    // التحقق هل اللاعب موجود مسبقاً (إعادة اتصال)
    // نستخدم findIndex للبحث عن ID المطابق
    const existingPlayerIndex = room.players.findIndex(p => p.id === playerId);

    if (existingPlayerIndex !== -1) {
      socket.join(roomId);
      // تحديث الـ socketId للاعب العائد
      room.players[existingPlayerIndex].socketId = socket.id;
      // تحديث الاسم إذا تغير (اختياري)
      if (playerName) room.players[existingPlayerIndex].name = playerName;

      console.log(`Player ${playerName} (${playerId}) reconnected to ${roomId}.`);

      // إرسال حالة اللعبة الحالية للاعب العائد
      socket.emit('game_state_update', { phase: room.phase });
      socket.emit('player_reconnected', {
        player: room.players[existingPlayerIndex],
        players: room.players
      });
      // تحديث القائمة للجميع
      io.to(roomId).emit('update_players', room.players);
    } else {
      // لاعب جديد
      if (room.phase !== PHASES.LOBBY) {
        socket.emit('error', 'اللعبة بدأت بالفعل، لا يمكن الانضمام كلاعب جديد.');
        return;
      }

      socket.join(roomId);

      // التأكد من عدم وجود "شبح" بنفس الاسم (اختياري، لكن مفيد لمنع التكرار البصري)
      // لكننا نعتمد على ID، فالاسم مكرر مسموح

      const newPlayer = {
        id: playerId,
        socketId: socket.id,
        name: playerName,
        role: 'PENDING',
        isAlive: true,
        avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], // تأكيد استخدام الإيموجي
        isHost: false,
        hasSelfHealed: false
      };

      room.players.push(newPlayer);
      io.to(roomId).emit('update_players', room.players);
      console.log(`Player ${playerName} (${playerId}) joined ${roomId}.`);
    }
  });

  // 3. بدء اللعبة
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // التحقق من أن المرسل هو الهوست
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || sender.id !== room.hostId) return;

    if (room.players.length < 3) {
      // socket.emit('error', 'العدد غير كافٍ');
    }

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
    if (!room) return;

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

  // استقبال الأكشن من اللاعبين
  socket.on('player_action', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAlive) return;

    if (room.phase === PHASES.NIGHT_MAFIA && player.role === 'MAFIA') {
      room.mafiaTarget = targetId;

      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_NURSE);
        io.to(roomId).emit('play_audio', 'nurse_wake');
      }, 2000);
    }

    if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      if (targetId === player.id) {
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
      }, 2000);
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

    // **تعديل الصوت المتداخل**: الانتظار قبل تشغيل صوت النتيجة
    setTimeout(() => {
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

      // الانتقال لمرحلة النقاش (وانتظار قرار الهوست بلا مؤقت)
      if (room.phase !== PHASES.GAME_OVER) {
        setTimeout(() => {
          updatePhase(roomId, PHASES.DAY_DISCUSSION);
        }, 4000);
      }
    }, 4500);
  }

  // **صلاحية الهوست الحصرية**: اتخاذ قرار في أي وقت بالنهار
  socket.on('host_action_day', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // التحقق من الهوست
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || sender.id !== room.hostId) return;

    if (room.phase !== PHASES.DAY_DISCUSSION) return;

    if (action === 'KICK') {
      const pIndex = room.players.findIndex(p => p.id === targetId);
      if (pIndex !== -1) {
        room.players[pIndex].isAlive = false;
        io.to(roomId).emit('player_kicked', { name: room.players[pIndex].name });
        io.to(roomId).emit('game_message', `قرر الهوست طرد اللاعب: ${room.players[pIndex].name}`);
      }
    } else if (action === 'SKIP') {
      io.to(roomId).emit('game_message', 'قرر الهوست عدم طرد أحد وإنهاء اليوم.');
    }

    checkWinCondition(roomId);

    if (rooms[roomId] && rooms[roomId].phase !== PHASES.GAME_OVER) {
      setTimeout(() => {
        startNightCycle(roomId);
      }, 4000);
    }
  });

  // **قائمة الآدمن**: طرد لاعب نهائياً من الغرفة
  socket.on('admin_kick_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // تأكد من صلاحية الهوست
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || sender.id !== room.hostId) return;

    const pIndex = room.players.findIndex(p => p.id === targetId);
    if (pIndex !== -1) {
      const removedName = room.players[pIndex].name;

      // إخبار اللاعب المطرود
      io.to(room.players[pIndex].socketId).emit('force_disconnect');

      // حذفه من القائمة
      room.players.splice(pIndex, 1);

      io.to(roomId).emit('update_players', room.players);
      io.to(roomId).emit('game_message', `قام الهوست بطرد ${removedName} من الغرفة.`);
    }
  });

  function checkWinCondition(roomId) {
    const room = rooms[roomId];
    if (!room) return;

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
    console.log('User Disconnected (Session Kept)', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});