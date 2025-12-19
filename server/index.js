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
    origin: ["https://mafia-game-dpfv.onrender.com", "https://*.vercel.app", "http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Allow both transports
  allowEIO3: true, // Ensure compatibility
  pingTimeout: 60000,
  pingInterval: 25000
});

// === STATE ===
const rooms = {};

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

const AVATARS = ['👨', '👩', '🕵️', '🤠', '🧙', '🧛', '🤖', '👽', '🤡', '👹', '👮', '👑'];

// === SOCKET ===
io.on('connection', (socket) => {
  console.log('✅ User Connected:', socket.id, '| Transport:', socket.conn.transport.name);

  // 1. CREATE ROOM - matching Al-Hosh pattern
  socket.on('create_room', ({ hostName }, callback) => {
    const roomCode = uuidv4().substring(0, 4).toUpperCase();

    const hostPlayer = {
      id: socket.id,
      socketId: socket.id,
      name: hostName,
      isHost: true,
      role: 'PENDING',
      isAlive: true,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      hasSelfHealed: false
    };

    rooms[roomCode] = {
      id: roomCode,
      hostId: socket.id,
      players: [hostPlayer],
      phase: PHASES.LOBBY,
      mafiaTarget: null,
      nurseTarget: null,
      detectiveCheck: null,
      winner: null
    };

    socket.join(roomCode);

    // Send callback response immediately - like Al-Hosh
    if (callback) callback({ roomCode });

    // Update all players in room - like Al-Hosh
    io.to(roomCode).emit('player_joined', { players: rooms[roomCode].players });

    console.log(`Room ${roomCode} created by ${hostName}`);
  });

  // 2. JOIN ROOM - matching Al-Hosh pattern
  socket.on('join_room', ({ roomCode, playerName }, callback) => {
    const room = rooms[roomCode?.toUpperCase()];
    if (!room) {
      if (callback) callback({ error: 'الغرفة غير موجودة' });
      return;
    }

    if (room.phase !== PHASES.LOBBY) {
      if (callback) callback({ error: 'اللعبة بدأت بالفعل' });
      return;
    }

    const newPlayer = {
      id: socket.id,
      socketId: socket.id,
      name: playerName,
      isHost: false,
      role: 'PENDING',
      isAlive: true,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      hasSelfHealed: false
    };

    room.players.push(newPlayer);
    socket.join(roomCode.toUpperCase());

    // Send callback - like Al-Hosh
    if (callback) callback({ success: true });

    // Update all players - like Al-Hosh
    io.to(roomCode.toUpperCase()).emit('player_joined', { players: room.players });

    console.log(`${playerName} joined room ${roomCode}`);
  });

  // 3. START GAME
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // التحقق من أن الهوست هو من بدأ اللعبة
    // ملاحظة: قمت بإزالة التحقق الصارم من socketId للهوست لمرونة أكثر، واعتمدت على خاصية isHost
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    const count = room.players.length;
    let roles = [];

    let mafiaCount = count >= 8 ? 2 : 1;
    let docCount = 1;
    let detCount = 1;

    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    for (let i = 0; i < docCount; i++) roles.push('DOCTOR');
    for (let i = 0; i < detCount; i++) roles.push('DETECTIVE');
    while (roles.length < count) roles.push('CITIZEN');

    roles = roles.slice(0, count);

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

    // إرسال القائمة المحدثة بالأدوار للجميع
    io.to(roomId).emit('game_started', room.players);
    startNightCycle(roomId);
  });

  // ... (بقية الدوال كما هي في الكود السابق: startNightCycle, player_action, calculateResults, host_action_day, admin_kick_player, updatePhase, checkWinCondition)
  // تأكد من نسخ بقية الدوال من الكود السابق إذا لم تكن موجودة هنا، التغيير الأساسي كان في handleJoin و create_room

  // === NIGHT CYCLE LOGIC ===
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
    }, 4500);
  }

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
    else if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      if (targetId === player.id && player.hasSelfHealed) return socket.emit('error', 'لا يمكنك معالجة نفسك مرة أخرى');
      if (targetId === player.id) player.hasSelfHealed = true;
      room.nurseTarget = targetId;
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 2000);
    }
    else if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const target = room.players.find(p => p.id === targetId);
      const res = (target && target.role === 'MAFIA') ? 'MAFIA 😈' : 'CITIZEN 😇';
      socket.emit('investigation_result', res);
      setTimeout(() => calculateResults(roomId), 3000);
    }
  });

  function calculateResults(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    updatePhase(roomId, PHASES.DAY_WAKE);
    io.to(roomId).emit('play_audio', 'everyone_wake');

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

      io.to(roomId).emit('day_result', { msg, players: room.players });
      io.to(roomId).emit('play_audio', audio);

      const gameOver = checkWinCondition(roomId);
      if (!gameOver) {
        setTimeout(() => {
          updatePhase(roomId, PHASES.DAY_DISCUSSION);
        }, 5000);
      }
    }, 4500);
  }

  socket.on('host_action_day', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    if (room.phase !== PHASES.DAY_DISCUSSION) return;

    if (action === 'SKIP') {
      io.to(roomId).emit('game_message', 'الليل قادم... 🌑');
      startNightCycle(roomId);
    }
    else if (action === 'KICK' && targetId) {
      const victim = room.players.find(p => p.id === targetId);
      if (victim) {
        victim.isAlive = false;
        io.to(roomId).emit('game_message', `تم إعدام ${victim.name} بتصويت المدينة ⚖️`);
        io.to(roomId).emit('update_players', room.players);
        const gameOver = checkWinCondition(roomId);
        if (!gameOver) {
          setTimeout(() => startNightCycle(roomId), 1500);
        }
      }
    }
  });

  socket.on('admin_kick_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    const idx = room.players.findIndex(p => p.id === targetId);
    if (idx !== -1) {
      const removedPlayer = room.players[idx];
      if (removedPlayer.socketId) io.to(removedPlayer.socketId).emit('force_disconnect');
      room.players.splice(idx, 1);
      io.to(roomId).emit('update_players', room.players);
      io.to(roomId).emit('game_message', `تم طرد ${removedPlayer.name} من الغرفة 🚫`);
    }
  });

  function updatePhase(roomId, phase) {
    if (rooms[roomId]) {
      rooms[roomId].phase = phase;
      io.to(roomId).emit('phase_change', phase);
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