import { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { v4 as uuidv4 } from 'uuid';

const SERVER_URL = 'http://localhost:3001';

const socket = io(SERVER_URL);

const ROLES_AR = {
  MAFIA: 'مافيا 🕴️',
  DOCTOR: 'ممرضة 💉',
  DETECTIVE: 'شايب 🕵️',
  CITIZEN: 'مواطن 🧑'
};

const sounds = {
  everyone_sleep: new Howl({ src: ['/sounds/everyone_sleep.mp3'] }),
  mafia_wake: new Howl({ src: ['/sounds/mafia_wake.mp3'] }),
  nurse_wake: new Howl({ src: ['/sounds/nurse_wake.mp3'] }),
  detective_wake: new Howl({ src: ['/sounds/detective_wake.mp3'] }),
  kill_success: new Howl({ src: ['/sounds/kill_success.mp3'] }),
  kill_fail: new Howl({ src: ['/sounds/kill_fail.mp3'] })
};

export default function App() {

  const [playerId] = useState(() => {
    let id = localStorage.getItem('playerId');
    if (!id) {
      id = uuidv4();
      localStorage.setItem('playerId', id);
    }
    return id;
  });

  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState('LOGIN');
  const [myRole, setMyRole] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [adminMenu, setAdminMenu] = useState(false);

  const me = players.find(p => p.id === playerId);

  useEffect(() => {

    socket.on('room_joined', room => {
      setRoomId(room.id);
      setPlayers(room.players);
      setPhase(room.phase);
      const myself = room.players.find(p => p.id === playerId);
      if (myself) {
        setIsHost(myself.isHost);
        setMyRole(myself.role);
      }
    });

    socket.on('update_players', list => {
      setPlayers([...list]);
    });

    socket.on('phase', p => setPhase(p));

    socket.on('sound', key => {
      Object.values(sounds).forEach(s => s.stop());
      sounds[key]?.play();
    });

    socket.on('detective_result', res => {
      alert(`نتيجة التحقيق: ${ROLES_AR[res]}`);
    });

    socket.on('game_over', winner => {
      alert(`الفائز: ${winner}`);
      window.location.reload();
    });

    return () => socket.off();

  }, [playerId]);

  // === ACTIONS ===

  const createRoom = () => {
    if (!name) return;
    socket.emit('create_room', { playerName: name, playerId });
  };

  const joinRoom = () => {
    if (!name || !roomId) return;
    socket.emit('join_room', { roomId, playerName: name, playerId });
  };

  const startGame = () => socket.emit('start_game', { roomId });

  const selectPlayer = (targetId) => {
    if (!me || !me.isAlive) return;

    if (phase === 'NIGHT_MAFIA' && me.role === 'MAFIA')
      socket.emit('mafia_pick', { roomId, targetId });

    if (phase === 'NIGHT_NURSE' && me.role === 'DOCTOR')
      socket.emit('nurse_pick', { roomId, playerId, targetId });

    if (phase === 'NIGHT_DETECTIVE' && me.role === 'DETECTIVE')
      socket.emit('detective_pick', { roomId, targetId });
  };

  const hostDecision = (targetId = null) => {
    socket.emit('host_decision', { roomId, targetId });
  };

  // === UI ===

  if (phase === 'LOGIN') {
    return (
      <div style={{ padding: 40 }}>
        <input placeholder="اسمك" onChange={e => setName(e.target.value)} />
        <br /><br />
        <button onClick={createRoom}>إنشاء غرفة</button>
        <br /><br />
        <input placeholder="كود الغرفة" onChange={e => setRoomId(e.target.value.toUpperCase())} />
        <button onClick={joinRoom}>دخول</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>

      {/* ADMIN MENU */}
      {isHost && (
        <div style={{ position: 'fixed', top: 10, left: 10 }}>
          <button onClick={() => setAdminMenu(!adminMenu)}>☰</button>
          {adminMenu && players.filter(p => !p.isHost).map(p => (
            <div key={p.id}>
              {p.name}
              <button onClick={() => hostDecision(p.id)}>طرد</button>
            </div>
          ))}
        </div>
      )}

      {/* HEADER */}
      <h2>الغرفة: {roomId}</h2>
      <h3>الدور: {ROLES_AR[me?.role]}</h3>
      <h4>المرحلة: {phase}</h4>

      {/* LOBBY */}
      {phase === 'LOBBY' && isHost && (
        <button onClick={startGame}>ابدأ اللعبة</button>
      )}

      {/* PLAYERS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {players.map(p => (
          <div
            key={p.id}
            onClick={() => selectPlayer(p.id)}
            style={{
              border: '1px solid #444',
              padding: 10,
              opacity: p.isAlive ? 1 : 0.4,
              cursor: 'pointer'
            }}
          >
            <div style={{ fontSize: 40 }}>{p.isAlive ? p.avatar : '💀'}</div>
            <div>{p.name}</div>
          </div>
        ))}
      </div>

      {/* HOST CONTROLS */}
      {phase === 'DAY_DISCUSSION' && isHost && (
        <div style={{ marginTop: 20 }}>
          <button onClick={() => hostDecision()}>سكب الجولة</button>
        </div>
      )}

    </div>
  );
}
