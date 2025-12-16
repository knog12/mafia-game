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

// Unicode Avatars to ensure they render everywhere
const AVATARS = ['👨', '👩', '🕵️', '🤠', '🧙', '🧛', '🤖', '👽', '🤡', '👹', '👮', '👑'];

// === SOCKET ===
io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

  // 1. CREATE ROOM
  socket.on('create_room', ({ playerName, playerId }) => {
    if (!playerId) return socket.emit('error', 'No Player ID');

    // Create unique Room ID
    const roomId = uuidv4().substring(0, 4).toUpperCase();

    // Check if this player is already hosting (Clean up old rooms if necessary, but for now just make new one)

    // Create Host object
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

    // Emit special event for the creator
    socket.emit('room_joined', {
      roomId,
      players: rooms[roomId].players,
      phase: PHASES.LOBBY
    });

    console.log(`Room ${roomId} created by ${playerName}`);
  });

  // 2. JOIN ROOM (Robust Persistence)
  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    handleJoinLogic(socket, roomId, playerName, playerId);
  });

  // 3. RECONNECT (Same logic as join, but explicit intent)
  socket.on('reconnect_user', ({ roomId, playerName, playerId }) => {
    handleJoinLogic(socket, roomId, playerName, playerId);
  });

  function handleJoinLogic(socket, roomId, playerName, playerId) {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'الغرفة غير موجودة');
    if (!playerId) return socket.emit('error', 'No Player ID');

    // 1. Try Match by ID
    let existingPlayerIndex = room.players.findIndex(p => p.id === playerId);

    // 2. Fallback: Try Match by Name (if ID not found but Name exists)
    // This fixes the issue where a Host refreshes, gets a new ID, and loses Host powers.
    if (existingPlayerIndex === -1 && playerName) {
      existingPlayerIndex = room.players.findIndex(p => p.name === playerName);
      if (existingPlayerIndex !== -1) {
        console.log(`Recovered session for ${playerName} by Name Match.`);
      }
    }

    if (existingPlayerIndex !== -1) {
      // === RECONNECT CASE ===
      const player = room.players[existingPlayerIndex];
      player.socketId = socket.id; // Update Socket
      // Update ID to the new one if we matched by name, so future matches work by ID
      if (player.id !== playerId) {
        player.id = playerId;
      }

      socket.join(roomId);

      // Send success to the USER
      socket.emit('room_joined', {
        roomId,
        players: room.players,
        phase: room.phase
      });

      // Update EVERYONE
      io.to(roomId).emit('update_players', room.players);
      console.log(`Player ${player.name} reconnected (Updated Socket)`);

    } else {
      // === NEW PLAYER CASE ===
      if (room.phase !== PHASES.LOBBY) {
        return socket.emit('error', 'اللعبة بدأت بالفعل');
      }

      const newPlayer = {
        id: playerId,
        socketId: socket.id,
        name: playerName,
        isHost: false, // New players are never host unless logic changes
        role: 'PENDING',
        isAlive: true,
        avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
        hasSelfHealed: false
      };

      room.players.push(newPlayer);
      socket.join(roomId);

      // Send success to the USER
      socket.emit('room_joined', {
        roomId,
        players: room.players,
        phase: room.phase
      });

      // Update EVERYONE
      io.to(roomId).emit('update_players', room.players);
      console.log(`Player ${playerName} joined ${roomId}`);
    }
  }

  // 4. START GAME
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Validate Host
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    // Role Distro
    const playersCount = room.players.length;
    let roles = [];

    // STRICT PRIORITY: Mafia -> Doc -> Detective -> Citizen
    let mafiaCount = playersCount >= 8 ? 2 : 1;
    let doctorCount = 1;
    let detectiveCount = 1;

    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    for (let i = 0; i < doctorCount; i++) roles.push('DOCTOR');
    for (let i = 0; i < detectiveCount; i++) roles.push('DETECTIVE');

    // Fill remainder with Citizen
    while (roles.length < playersCount) {
      roles.push('CITIZEN');
    }

    // Trim if we have too many roles (e.g. 2 players but need 3 special roles)
    if (roles.length > playersCount) roles = roles.slice(0, playersCount);

    // Shuffle
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

  // NIGHT LOGIC
  function startNightCycle(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.mafiaTarget = null; room.nurseTarget = null; room.detectiveCheck = null;

    updatePhase(roomId, PHASES.NIGHT_SLEEP);
    io.to(roomId).emit('play_audio', 'everyone_sleep');

    setTimeout(() => {
      updatePhase(roomId, PHASES.NIGHT_MAFIA);
      io.to(roomId).emit('play_audio', 'mafia_wake');
    }, 4500);
  }

  // PLAYER ACTION
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
      if (targetId === player.id) {
        if (player.hasSelfHealed) return socket.emit('error', 'Healed self once already');
        player.hasSelfHealed = true;
      }
      room.nurseTarget = targetId;
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 2000);
    }
    else if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const target = room.players.find(p => p.id === targetId);
      const isMafia = target && target.role === 'MAFIA';
      socket.emit('investigation_result', isMafia ? 'MAFIA 😈' : 'CITIZEN 😇');

      setTimeout(() => {
        calculateResults(roomId);
      }, 3000);
    }
  });

  // CALC RESULTS
  function calculateResults(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    updatePhase(roomId, PHASES.DAY_WAKE);

    io.to(roomId).emit('play_audio', 'everyone_wake');

    setTimeout(() => {
      let msg = "صباح الخير!";
      let audio = "result_fail";

      if (room.mafiaTarget && room.mafiaTarget !== room.nurseTarget) {
        const victim = room.players.find(p => p.id === room.mafiaTarget);
        if (victim) {
          victim.isAlive = false;
          msg = `المافيا قامت بقتل ${victim.name} 🩸`;
          audio = "result_success";
        }
      } else {
        msg = "لم يمت أحد الليلة ✨";
      }

      io.to(roomId).emit('day_result', { msg, players: room.players });
      io.to(roomId).emit('play_audio', audio);

      checkWinCondition(roomId);

      if (room.phase !== PHASES.GAME_OVER) {
        setTimeout(() => {
          updatePhase(roomId, PHASES.DAY_DISCUSSION);
        }, 5000);
      }
    }, 4500);
  }

  // HOST DAY ACTIONS
  socket.on('host_action_day', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    if (action === 'SKIP') {
      io.to(roomId).emit('game_message', 'تم تخطي اليوم ⏭️');
      setTimeout(() => startNightCycle(roomId), 2000);
    } else if (action === 'KICK' && targetId) {
      const victim = room.players.find(p => p.id === targetId);
      if (victim) {
        victim.isAlive = false;
        io.to(roomId).emit('game_message', `تم إعدام ${victim.name} ⚖️`);
        io.to(roomId).emit('update_players', room.players);
        checkWinCondition(roomId);

        if (room.phase !== PHASES.GAME_OVER) {
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
    const room = rooms[roomId]; if (!room) return;
    const mafia = room.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const citizen = room.players.filter(p => p.isAlive && p.role !== 'MAFIA').length;

    if (mafia === 0) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'CITIZENS');
    } else if (mafia >= citizen) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'MAFIA');
    }
  }

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON ${PORT}`);
});
