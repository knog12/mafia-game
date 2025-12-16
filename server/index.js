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
    credentials: true,
    allowedHeaders: ["my-custom-header"],
    transports: ['websocket', 'polling']
  },
  allowEIO3: true
});

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

io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

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
    socket.emit('room_joined', {
      roomId,
      players: rooms[roomId].players,
      phase: PHASES.LOBBY
    });
  });

  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    handleJoinLogic(socket, roomId, playerName, playerId);
  });

  socket.on('reconnect_user', ({ roomId, playerName, playerId }) => {
    handleJoinLogic(socket, roomId, playerName, playerId);
  });

  function handleJoinLogic(socket, roomId, playerName, playerId) {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'الغرفة غير موجودة');
    if (!playerId) return socket.emit('error', 'No Player ID');

    let existingPlayerIndex = room.players.findIndex(p => p.id === playerId);
    if (existingPlayerIndex === -1 && playerName) {
      existingPlayerIndex = room.players.findIndex(p => p.name === playerName);
    }

    if (existingPlayerIndex !== -1) {
      const player = room.players[existingPlayerIndex];
      player.socketId = socket.id;
      if (player.id !== playerId) player.id = playerId;
      socket.join(roomId);
      socket.emit('room_joined', { roomId, players: room.players, phase: room.phase });
      io.to(roomId).emit('update_players', room.players);
    } else {
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

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    const playersCount = room.players.length;
    let roles = [];
    let mafiaCount = playersCount >= 8 ? 2 : 1;
    let doctorCount = 1;
    let detectiveCount = 1;

    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    for (let i = 0; i < doctorCount; i++) roles.push('DOCTOR');
    for (let i = 0; i < detectiveCount; i++) roles.push('DETECTIVE');
    while (roles.length < playersCount) roles.push('CITIZEN');
    if (roles.length > playersCount) roles = roles.slice(0, playersCount);

    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
    roles = shuffle(roles);

    room.players.forEach((p, i) => {
      p.role = roles[i];
      p.isAlive = true;
      p.hasSelfHealed = false;
    });

    io.to(roomId).emit('game_started', room.players);
    startNightCycle(roomId);
  });

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
    } else if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      if (targetId === player.id) {
        if (player.hasSelfHealed) return socket.emit('error', 'Healed self once already');
        player.hasSelfHealed = true;
      }
      room.nurseTarget = targetId;
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 2000);
    } else if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const target = room.players.find(p => p.id === targetId);
      const isMafia = target && target.role === 'MAFIA';
      socket.emit('investigation_result', isMafia ? 'MAFIA 😈' : 'CITIZEN 😇');
      setTimeout(() => calculateResults(roomId), 3000);
    }
  });

  function calculateResults(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    updatePhase(roomId, PHASES.DAY_WAKE);
    io.to(roomId).emit('play_audio', 'everyone_wake');

    setTimeout(() => {
      let msg = "لم يمت أحد الليلة ✨";
      let audio = "result_fail";
      if (room.mafiaTarget && room.mafiaTarget !== room.nurseTarget) {
        const victim = room.players.find(p => p.id === room.mafiaTarget);
        if (victim) {
          victim.isAlive = false;
          msg = `المافيا قامت بقتل ${victim.name} 🩸`;
          audio = "result_success";
        }
      }
      io.to(roomId).emit('day_result', { msg, players: room.players });
      io.to(roomId).emit('play_audio', audio);

      const isOver = checkWinCondition(roomId);
      if (!isOver) {
        setTimeout(() => updatePhase(roomId, PHASES.DAY_DISCUSSION), 5000);
      }
    }, 4500);
  }

  // الجزء المعدل لحل مشكلة توقف الهوست
  socket.on('host_action_day', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== PHASES.DAY_DISCUSSION) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    if (action === 'SKIP') {
      io.to(roomId).emit('game_message', 'تم تخطي اليوم ⏭️');
      setTimeout(() => startNightCycle(roomId), 2000);
    } else if (action === 'KICK' && targetId) {
      const victim = room.players.find(p => p.id === targetId);
      if (victim && victim.isAlive) {
        victim.isAlive = false;
        io.to(roomId).emit('game_message', `تم إعدام ${victim.name} ⚖️`);
        io.to(roomId).emit('update_players', room.players);

        const isOver = checkWinCondition(roomId);
        if (!isOver) {
          setTimeout(() => startNightCycle(roomId), 4000);
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
      const p = room.players[idx];
      io.to(p.socketId).emit('force_disconnect');
      room.players.splice(idx, 1);
      io.to(roomId).emit('update_players', room.players);
      io.to(roomId).emit('game_message', `تم طرد ${p.name}`);
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
    const alivePlayers = room.players.filter(p => p.isAlive);
    const mafia = alivePlayers.filter(p => p.role === 'MAFIA').length;
    const citizen = alivePlayers.filter(p => p.role !== 'MAFIA').length;

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

  socket.on('disconnect', () => console.log('socket disconnected', socket.id));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`SERVER RUNNING ON ${PORT}`));