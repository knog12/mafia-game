// index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

const PHASES = {
  LOBBY: 'LOBBY',
  NIGHT_SLEEP: 'NIGHT_SLEEP',
  NIGHT_MAFIA: 'NIGHT_MAFIA',
  NIGHT_NURSE: 'NIGHT_NURSE',
  NIGHT_DETECTIVE: 'NIGHT_DETECTIVE',
  DAY_RESULT: 'DAY_RESULT',
  DAY_DISCUSSION: 'DAY_DISCUSSION',
  GAME_OVER: 'GAME_OVER'
};

const AVATARS = ['👨', '👩', '🕵️', '🤠', '🧙', '🧛', '🤖', '👽', '🤡', '👹', '👮', '👑'];

io.on('connection', socket => {

  socket.on('create_room', ({ playerName, playerId }) => {
    const roomId = uuidv4().slice(0, 4).toUpperCase();

    const host = {
      id: playerId,
      socketId: socket.id,
      name: playerName,
      isHost: true,
      role: 'PENDING',
      isAlive: true,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      selfHealUsed: false
    };

    rooms[roomId] = {
      id: roomId,
      players: [host],
      phase: PHASES.LOBBY,
      mafiaTarget: null,
      nurseTarget: null,
      detectiveResult: null
    };

    socket.join(roomId);
    io.to(roomId).emit('room_joined', rooms[roomId]);
  });

  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== PHASES.LOBBY) return;

    const player = {
      id: playerId,
      socketId: socket.id,
      name: playerName,
      isHost: false,
      role: 'PENDING',
      isAlive: true,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      selfHealUsed: false
    };

    room.players.push(player);
    socket.join(roomId);
    io.to(roomId).emit('room_joined', room);
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const count = room.players.length;
    const mafiaCount = count >= 9 ? 2 : 1;

    let roles = [
      ...Array(mafiaCount).fill('MAFIA'),
      'DOCTOR',
      'DETECTIVE'
    ];
    while (roles.length < count) roles.push('CITIZEN');
    roles.sort(() => Math.random() - 0.5);

    room.players.forEach((p, i) => p.role = roles[i]);
    startNight(roomId);
  });

  function startNight(roomId) {
    const room = rooms[roomId];
    room.phase = PHASES.NIGHT_SLEEP;
    io.to(roomId).emit('phase', room.phase);
    io.to(roomId).emit('sound', 'everyone_sleep');

    setTimeout(() => {
      room.phase = PHASES.NIGHT_MAFIA;
      io.to(roomId).emit('phase', room.phase);
      io.to(roomId).emit('sound', 'mafia_wake');
    }, 3000);
  }

  socket.on('mafia_pick', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room.mafiaTarget) room.mafiaTarget = targetId;

    setTimeout(() => {
      room.phase = PHASES.NIGHT_NURSE;
      io.to(roomId).emit('phase', room.phase);
      io.to(roomId).emit('sound', 'nurse_wake');
    }, 3000);
  });

  socket.on('nurse_pick', ({ roomId, playerId, targetId }) => {
    const room = rooms[roomId];
    const nurse = room.players.find(p => p.id === playerId);
    if (targetId === playerId && nurse.selfHealUsed) return;
    if (targetId === playerId) nurse.selfHealUsed = true;

    room.nurseTarget = targetId;

    setTimeout(() => {
      room.phase = PHASES.NIGHT_DETECTIVE;
      io.to(roomId).emit('phase', room.phase);
      io.to(roomId).emit('sound', 'detective_wake');
    }, 3000);
  });

  socket.on('detective_pick', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    const target = room.players.find(p => p.id === targetId);
    socket.emit('detective_result', target.role);

    setTimeout(() => resolveNight(roomId), 3000);
  });

  function resolveNight(roomId) {
    const room = rooms[roomId];
    let killed = null;

    if (room.mafiaTarget !== room.nurseTarget) {
      killed = room.players.find(p => p.id === room.mafiaTarget);
      if (killed) killed.isAlive = false;
      io.to(roomId).emit('sound', 'kill_success');
    } else {
      io.to(roomId).emit('sound', 'kill_fail');
    }

    room.phase = PHASES.DAY_DISCUSSION;
    io.to(roomId).emit('phase', room.phase);
    io.to(roomId).emit('update_players', room.players);
  }

  socket.on('host_decision', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (targetId) {
      const p = room.players.find(x => x.id === targetId);
      if (p) p.isAlive = false;
    }
    checkWin(roomId);
    startNight(roomId);
  });

  function checkWin(roomId) {
    const room = rooms[roomId];
    const mafia = room.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const citizens = room.players.filter(p => p.isAlive && p.role !== 'MAFIA').length;
    if (mafia === 0 || mafia >= citizens) {
      room.phase = PHASES.GAME_OVER;
      io.to(roomId).emit('game_over', mafia === 0 ? 'CITIZENS' : 'MAFIA');
    }
  }
});

server.listen(3001, () => console.log('SERVER ON'));
