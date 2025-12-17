const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// === STATE ===
const rooms = {};

const PHASES = {
  LOBBY: 'LOBBY',
  NIGHT_SLEEP: 'NIGHT_SLEEP',   // وقت تشغيل صوتية النوم
  NIGHT_MAFIA: 'NIGHT_MAFIA',
  NIGHT_NURSE: 'NIGHT_NURSE',
  NIGHT_DETECTIVE: 'NIGHT_DETECTIVE',
  DAY_WAKE: 'DAY_WAKE',         // وقت عرض نتائج الليل
  DAY_DISCUSSION: 'DAY_DISCUSSION', // وقت النقاش وازرار الهوست
  GAME_OVER: 'GAME_OVER'
};

const AVATARS = ['👨', '👩', '🕵️', '🤠', '🧙', '🧛', '🤖', '👽', '🤡', '👹', '👮', '👑'];

// === SOCKET ===
io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

  // 1. CREATE ROOM
  socket.on('create_room', ({ playerName, playerId }) => {
    if (!playerId) return socket.emit('error', 'No Player ID');

    const roomId = uuidv4().substring(0, 4).toUpperCase();

    const hostPlayer = {
      id: playerId,
      socketId: socket.id,
      name: playerName,
      isHost: true,
      role: 'PENDING',
      isAlive: true,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      hasSelfHealed: false
    };

    rooms[roomId] = {
      id: roomId,
      hostId: playerId,
      players: [hostPlayer],
      phase: PHASES.LOBBY,
      mafiaTarget: null,
      nurseTarget: null,
      detectiveCheck: null,
      winner: null
    };

    socket.join(roomId);
    socket.emit('room_joined', { roomId, players: rooms[roomId].players, phase: PHASES.LOBBY });
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  // 2. JOIN / RECONNECT
  socket.on('join_room', ({ roomId, playerName, playerId }) => handleJoin(socket, roomId?.toUpperCase(), playerName, playerId));
  socket.on('reconnect_user', ({ roomId, playerName, playerId }) => handleJoin(socket, roomId?.toUpperCase(), playerName, playerId));

  function handleJoin(socket, roomId, playerName, playerId) {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'الغرفة غير موجودة');
    if (!playerId) return socket.emit('error', 'No Player ID');

    // 1. Try Match by ID
    let player = room.players.find(p => p.id === playerId);

    // 2. Fallback: Match by Name (Fixes "Host lost permissions" bug)
    if (!player && playerName) {
      const matchByName = room.players.find(p => p.name === playerName);
      if (matchByName) {
        console.log(`Matched ${playerName} by NAME. Recovering session.`);
        player = matchByName;
        player.id = playerId; // Update ID to current
      }
    }

    if (player) {
      // Reconnection
      player.socketId = socket.id;
      if (playerName) player.name = playerName;
      socket.join(roomId);
      socket.emit('room_joined', { roomId, players: room.players, phase: room.phase });
      io.to(roomId).emit('update_players', room.players);
    } else {
      // New Player
      if (room.phase !== PHASES.LOBBY) return socket.emit('error', 'اللعبة بدأت بالفعل');

      const newPlayer = {
        id: playerId,
        socketId: socket.id,
        name: playerName,
        isHost: false,
        role: 'PENDING',
        isAlive: true,
        avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
        hasSelfHealed: false
      };

      room.players.push(newPlayer);
      socket.join(roomId);
      socket.emit('room_joined', { roomId, players: room.players, phase: room.phase });
      io.to(roomId).emit('update_players', room.players);
    }
  }

  // 3. START GAME
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (!p || !p.isHost) return;

    // Strict Role Priority: Mafia -> Doc -> Det -> Citizen
    const count = room.players.length;
    let roles = [];

    let mafiaCount = count >= 8 ? 2 : 1;
    let docCount = 1;
    let detCount = 1;

    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    for (let i = 0; i < docCount; i++) roles.push('DOCTOR');
    for (let i = 0; i < detCount; i++) roles.push('DETECTIVE');
    while (roles.length < count) roles.push('CITIZEN');

    if (roles.length > count) roles = roles.slice(0, count);

    // Shuffle
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    room.players.forEach((player, i) => {
      player.role = roles[i];
      player.isAlive = true;
      player.hasSelfHealed = false;
    });

    io.to(roomId).emit('game_started', room.players);
    startNightCycle(roomId);
  });

  // === NIGHT CYCLE LOGIC ===
  function startNightCycle(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // تصفية اختيارات الليلة السابقة
    room.mafiaTarget = null;
    room.nurseTarget = null;
    room.detectiveCheck = null;

    // 1. مرحلة النوم وتشغيل الصوتية (Everyone Sleep)
    updatePhase(roomId, PHASES.NIGHT_SLEEP);
    io.to(roomId).emit('play_audio', 'everyone_sleep');

    // 2. الانتقال لدور المافيا بعد انتهاء الصوتية (4.5 ثواني)
    setTimeout(() => {
      updatePhase(roomId, PHASES.NIGHT_MAFIA);
      io.to(roomId).emit('play_audio', 'mafia_wake');
    }, 4500);
  }

  // === PLAYER ACTIONS (NIGHT) ===
  socket.on('player_action', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAlive) return;

    // --- MAFIA ACTION ---
    if (room.phase === PHASES.NIGHT_MAFIA && player.role === 'MAFIA') {
      room.mafiaTarget = targetId;
      // ننتظر قليلاً ثم ننتقل للممرضة
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_NURSE);
        io.to(roomId).emit('play_audio', 'nurse_wake');
      }, 2000);
    }
    // --- DOCTOR ACTION ---
    else if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      if (targetId === player.id && player.hasSelfHealed) return socket.emit('error', 'لا يمكنك معالجة نفسك مرة أخرى');
      if (targetId === player.id) player.hasSelfHealed = true;

      room.nurseTarget = targetId;
      // ننتظر قليلاً ثم ننتقل للشايب
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 2000);
    }
    // --- DETECTIVE ACTION ---
    else if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const target = room.players.find(p => p.id === targetId);
      const res = (target && target.role === 'MAFIA') ? 'MAFIA 😈' : 'CITIZEN 😇';
      socket.emit('investigation_result', res);

      // بعد ظهور النتيجة للشايب، نحسب نتائج الليل
      setTimeout(() => calculateResults(roomId), 3000);
    }
  });

  // === CALCULATE RESULTS (END OF NIGHT) ===
  function calculateResults(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    updatePhase(roomId, PHASES.DAY_WAKE);
    io.to(roomId).emit('play_audio', 'everyone_wake');

    // بعد 4.5 ثواني من الاستيقاظ، نعرض من مات
    setTimeout(() => {
      let msg = "صباح الخير! لم يمت أحد الليلة ✨";
      let audio = "result_fail";

      if (room.mafiaTarget && room.mafiaTarget !== room.nurseTarget) {
        const victim = room.players.find(p => p.id === room.mafiaTarget);
        if (victim) {
          victim.isAlive = false;
          msg = `المافيا قتلت ${victim.name} 🩸`;
          audio = "result_success";
        }
      }

      // إرسال النتيجة وتشغيل الصوتية
      io.to(roomId).emit('day_result', { msg, players: room.players });
      io.to(roomId).emit('play_audio', audio);

      // التحقق من الفوز
      const gameOver = checkWinCondition(roomId);
      if (!gameOver) {
        // ننتقل لمرحلة النقاش (حيث تظهر أزرار الهوست) بعد 5 ثواني من عرض النتيجة
        setTimeout(() => {
          updatePhase(roomId, PHASES.DAY_DISCUSSION);
        }, 5000);
      }
    }, 4500);
  }

  // === HOST DAY ACTIONS (KICK / SKIP) ===
  socket.on('host_action_day', ({ roomId, action, targetId }) => {
    console.log(`Host Action: ${action} in room ${roomId}`);
    const room = rooms[roomId];
    if (!room) return;

    // التأكد أن المرسل هو الهوست
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) {
      console.log('Action denied: Not host');
      return;
    }

    // السماح للهوست بالتحكم فقط في مرحلة النقاش
    // (تم التعديل لضمان استجابة الأزرار)
    if (room.phase !== PHASES.DAY_DISCUSSION) {
      console.log(`Action Ignored: Wrong Phase ${room.phase}`);
      return;
    }

    // 1. خيار التخطي (SKIP) - الانتقال للجولة التالية
    if (action === 'SKIP') {
      console.log('Skipping day -> Starting Night Cycle');
      io.to(roomId).emit('game_message', 'الليل قادم... 🌑');
      // البدء فوراً في دورة الليل (صوتية الجميع ينام)
      startNightCycle(roomId);
    }
    // 2. خيار الإعدام (KICK) من الجولة (تصويت)
    else if (action === 'KICK' && targetId) {
      const victim = room.players.find(p => p.id === targetId);
      if (victim) {
        console.log(`Voting execution: ${victim.name}`);
        victim.isAlive = false; // قتل اللاعب

        io.to(roomId).emit('game_message', `تم إعدام ${victim.name} بتصويت المدينة ⚖️`);
        io.to(roomId).emit('update_players', room.players); // تحديث الواجهة فوراً

        // التحقق من الفوز قبل الانتقال لليل
        const gameOver = checkWinCondition(roomId);
        if (!gameOver) {
          // إذا لم تنته اللعبة، ننتقل لليل بعد ثانية واحدة
          setTimeout(() => startNightCycle(roomId), 1500);
        }
      }
    }
  });

  // === ADMIN KICK (طرد اللاعب من الغرفة نهائياً) ===
  // هذا الزر يجب أن يكون متاحاً للهوست في بطاقة كل لاعب
  socket.on('admin_kick_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    const idx = room.players.findIndex(p => p.id === targetId);
    if (idx !== -1) {
      const removedPlayer = room.players[idx];

      console.log(`Admin Kicking player from room: ${removedPlayer.name}`);

      // 1. إجبار اللاعب المطرود على الخروج
      if (removedPlayer.socketId) {
        io.to(removedPlayer.socketId).emit('force_disconnect');
        // ملاحظة: يجب التعامل مع هذا الحدث في الفرونت إند لإعادته للصفحة الرئيسية
      }

      // 2. حذفه من القائمة
      room.players.splice(idx, 1);

      // 3. تحديث باقي اللاعبين
      io.to(roomId).emit('update_players', room.players);
      io.to(roomId).emit('game_message', `تم طرد ${removedPlayer.name} من الغرفة 🚫`);
    }
  });

  // === HELPER FUNCTIONS ===
  function updatePhase(roomId, phase) {
    if (rooms[roomId]) {
      rooms[roomId].phase = phase;
      io.to(roomId).emit('phase_change', phase);
      console.log(`Room ${roomId} Phase: ${phase}`);
    }
  }

  function checkWinCondition(roomId) {
    const room = rooms[roomId];
    if (!room) return false;

    const mafia = room.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const citizen = room.players.filter(p => p.isAlive && p.role !== 'MAFIA').length;

    if (mafia === 0) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'CITIZENS');
      return true;
    } else if (mafia >= citizen) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'MAFIA');
      return true;
    }
    return false;
  }

  socket.on('disconnect', () => console.log('Disconnected', socket.id));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON ${PORT}`);
});