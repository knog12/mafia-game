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
    methods: ["GET", "POST"]
  }
});

// === STATE ===
const rooms = {}; // { roomId: { id, hostId, players: [], phase, ... } }

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

// === HELPERS ===
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// === SOCKET ===
io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

  // 1. CREATE ROOM
  socket.on('create_room', ({ playerName, playerId }) => {
    if (!playerId) return socket.emit('error', 'No Player ID');

    const roomId = uuidv4().substring(0, 4).toUpperCase();

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
    socket.emit('room_created', roomId);
    socket.emit('joined_room', roomId);
    io.to(roomId).emit('update_players', rooms[roomId].players);
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  // 2. JOIN ROOM (Robust Persistence)
  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'الغرفة غير موجودة');
    if (!playerId) return socket.emit('error', 'No Player ID');

    // Check if player exists (Reconnection)
    const existingPlayer = room.players.find(p => p.id === playerId);

    if (existingPlayer) {
      // Reconnect logic
      existingPlayer.socketId = socket.id;
      if (playerName) existingPlayer.name = playerName; // Update name if provided

      socket.join(roomId);
      socket.emit('joined_room', roomId);
      socket.emit('player_reconnected', {
        player: existingPlayer,
        players: room.players,
        phase: room.phase
      });
      io.to(roomId).emit('update_players', room.players);
      console.log(`Player ${existingPlayer.name} reconnected to ${roomId}`);
    } else {
      // New Player logic
      if (room.phase !== PHASES.LOBBY) {
        return socket.emit('error', 'اللعبة بدأت بالفعل');
      }

      // Prevent Duplicate Sockets (rare edge case)
      const isSocketResused = room.players.some(p => p.socketId === socket.id);
      if (isSocketResused) return;

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
      socket.emit('joined_room', roomId);
      io.to(roomId).emit('update_players', room.players);
      console.log(`Player ${playerName} joined ${roomId}`);
    }
  });

  // 3. START GAME
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Validate Host
    // We trust the sender if they have a player in the room that is marked as host, 
    // AND their current socket matches.
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    if (room.players.length < 3) {
      // return socket.emit('error', 'Need 3+ players'); 
      // (Optional: enforce min players)
    }

    // Assign Roles
    const playersCount = room.players.length;
    let mafiaCount = playersCount < 8 ? 1 : 2;

    let roles = [];
    for (let i = 0; i < mafiaCount; i++) roles.push('MAFIA');
    roles.push('DOCTOR');
    roles.push('DETECTIVE');
    while (roles.length < playersCount) roles.push('CITIZEN');

    roles = shuffleArray(roles);

    room.players.forEach((p, i) => {
      p.role = roles[i];
      p.isAlive = true;
      p.hasSelfHealed = false;
    });

    io.to(roomId).emit('game_started', room.players);
    startNightCycle(roomId);
  });

  // === NIGHT CYCLE MANAGMENT ===
  function startNightCycle(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Reset Night Actions
    room.mafiaTarget = null;
    room.nurseTarget = null;
    room.detectiveCheck = null;

    updatePhase(roomId, PHASES.NIGHT_SLEEP);
    io.to(roomId).emit('play_audio', 'everyone_sleep');

    setTimeout(() => {
      updatePhase(roomId, PHASES.NIGHT_MAFIA);
      io.to(roomId).emit('play_audio', 'mafia_wake');
    }, 4500); // 4.5s delay for sleep audio
  }

  // === PLAYER ACTION ===
  socket.on('player_action', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAlive) return;

    // Mafia Action
    if (room.phase === PHASES.NIGHT_MAFIA && player.role === 'MAFIA') {
      room.mafiaTarget = targetId;
      // Move to Nurse after short delay to allow mafia to sync
      // We can use a timeout on the server to transition automatically, 
      // or wait for the first mafia vote. Simple version: first vote triggers transition.
      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_NURSE);
        io.to(roomId).emit('play_audio', 'nurse_wake');
      }, 2000);
    }

    // Nurse Action
    if (room.phase === PHASES.NIGHT_NURSE && player.role === 'DOCTOR') {
      if (targetId === player.id) {
        if (player.hasSelfHealed) return socket.emit('error', 'Self-heal used already');
        player.hasSelfHealed = true;
      }
      room.nurseTarget = targetId;

      setTimeout(() => {
        updatePhase(roomId, PHASES.NIGHT_DETECTIVE);
        io.to(roomId).emit('play_audio', 'detective_wake');
      }, 2000);
    }

    // Detective Action
    if (room.phase === PHASES.NIGHT_DETECTIVE && player.role === 'DETECTIVE') {
      const target = room.players.find(p => p.id === targetId);
      const isMafia = target && target.role === 'MAFIA';
      socket.emit('investigation_result', isMafia ? 'MAFIA 😈' : 'CITIZEN 😇');

      setTimeout(() => {
        calculateResults(roomId);
      }, 3000); // Time to read result
    }
  });

  // === CALCULATION & DAY ===
  function calculateResults(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    updatePhase(roomId, PHASES.DAY_WAKE);

    // 1. Play Wake Audio
    io.to(roomId).emit('play_audio', 'everyone_wake');

    // 2. Strict Delay (4.5s) BEFORE sending results
    setTimeout(() => {
      let msg = "صباح الخير يا مدينة!";
      let audioToPlay = "";
      let victim = null;

      if (room.mafiaTarget && room.mafiaTarget !== room.nurseTarget) {
        victim = room.players.find(p => p.id === room.mafiaTarget);
        if (victim) {
          victim.isAlive = false;
          msg = `للأسف... المافيا قتلت ${victim.name} 🩸`;
          audioToPlay = 'result_success'; // Sad/Dramatic
        }
      } else {
        msg = "الحمدلله! لم يمت أحد الليلة ✨";
        audioToPlay = 'result_fail'; // Happy/Safe
      }

      io.to(roomId).emit('day_result', { msg, players: room.players });
      io.to(roomId).emit('play_audio', audioToPlay);

      checkWinCondition(roomId);

      // Transition to Discussion (Host Control Mode)
      if (room.phase !== PHASES.GAME_OVER) {
        setTimeout(() => {
          updatePhase(roomId, PHASES.DAY_DISCUSSION);
        }, 5000); // Time to see result popup
      }

    }, 4500); // <-- THE CRITICAL DELAY
  }

  // === HOST ONLY DAY ACTIONS (No Public Vote) ===
  socket.on('host_action_day', ({ roomId, action, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return; // Security Check

    if (room.phase !== PHASES.DAY_DISCUSSION) return;

    if (action === 'SKIP') {
      io.to(roomId).emit('game_message', 'الهوست قرر تخطي اليوم ⏭️');
      startNightCycle(roomId);
    } else if (action === 'KICK' && targetId) {
      const victim = room.players.find(p => p.id === targetId);
      if (victim) {
        victim.isAlive = false;
        io.to(roomId).emit('game_message', `حكم الهوست بالإعدام على: ${victim.name} ⚖️`);
        io.to(roomId).emit('update_players', room.players);
        checkWinCondition(roomId);

        // Wait briefly then night
        if (room.phase !== PHASES.GAME_OVER) {
          setTimeout(() => startNightCycle(roomId), 4000);
        }
      }
    }
  });

  // === ADMIN KICK (Any Phase) ===
  socket.on('admin_kick_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isHost) return;

    const idx = room.players.findIndex(p => p.id === targetId);
    if (idx !== -1) {
      const p = room.players[idx];
      io.to(p.socketId).emit('force_disconnect'); // Kick client side
      room.players.splice(idx, 1); // Remove from array
      io.to(roomId).emit('update_players', room.players);
      io.to(roomId).emit('game_message', `تم طرد ${p.name} من الغرفة 🚫`);
    }
  });

  // === UTILS ===
  function updatePhase(roomId, phase) {
    if (rooms[roomId]) {
      rooms[roomId].phase = phase;
      io.to(roomId).emit('phase_change', phase);
    }
  }

  function checkWinCondition(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const mafiaCount = room.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const citizenCount = room.players.filter(p => p.isAlive && p.role !== 'MAFIA').length;

    if (mafiaCount === 0) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'CITIZENS');
    } else if (mafiaCount >= citizenCount) {
      updatePhase(roomId, PHASES.GAME_OVER);
      io.to(roomId).emit('game_over', 'MAFIA');
    }
  }

  socket.on('disconnect', () => {
    // We do NOT remove players on disconnect to allow persistence
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON ${PORT}`);
});
