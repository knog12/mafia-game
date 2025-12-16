import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

// === CONFIG ===
// Ensure this matches your server URL exactly.
const SERVER_URL = 'https://mafia-game-dpfv.onrender.com';
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true
});

// === SOUNDS ===
const sounds = {
  everyone_sleep: new Howl({ src: ['/sounds/everyone_sleep.mp3'] }),
  mafia_wake: new Howl({ src: ['/sounds/mafia_wake.mp3'] }),
  nurse_wake: new Howl({ src: ['/sounds/nurse_wake.mp3'] }),
  detective_wake: new Howl({ src: ['/sounds/detective_wake.mp3'] }),
  everyone_wake: new Howl({ src: ['/sounds/everyone_wake.mp3'] }),
  result_success: new Howl({ src: ['/sounds/result_success.mp3'] }),
  result_fail: new Howl({ src: ['/sounds/result_fail.mp3'] })
};

export default function App() {
  // === STATE ===
  // Initialize playerId from localStorage immediately to prevent sync issues
  const [playerId] = useState(() => {
    let stored = localStorage.getItem('mafia_playerId');
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem('mafia_playerId', stored);
    }
    return stored;
  });

  const [name, setName] = useState(() => localStorage.getItem('mafia_playerName') || '');
  const [roomId, setRoomId] = useState('');
  const [view, setView] = useState('LOGIN'); // LOGIN | LOBBY | GAME
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState('LOBBY');
  const [msg, setMsg] = useState('');
  const [investigationResult, setInvestigationResult] = useState(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  // Derived State for "My Player"
  // ROBUST MATCHING: Try ID -> Try SocketID -> Try Name
  const myPlayer = players.find(p => p.id === playerId) ||
    players.find(p => p.socketId === socket.id) ||
    players.find(p => p.name === name);

  // Sync ID if we found myself but IDs mismatch (Legacy Server Support)
  useEffect(() => {
    if (myPlayer && myPlayer.id !== playerId) {
      console.log('Syncing Protocol ID:', myPlayer.id);
      // We do NOT setPlayerId here to avoid loop, just rely on myPlayer derived check
      // Or we could update localStorage if we trust the server ID more.
    }
  }, [myPlayer, playerId]);

  // === EFFECTS ===
  useEffect(() => {
    // 0. Connection Status
    const onConnect = () => console.log('Connected to Server:', socket.id);
    const onDisconnect = () => console.log('Disconnected from Server');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // 1. Auto-Reconnect Attempt
    const savedRoom = localStorage.getItem('mafia_savedRoom');
    if (savedRoom && playerId && name) {
      console.log('Reconnecting to room:', savedRoom);
      setRoomId(savedRoom);
      socket.emit('reconnect_user', { roomId: savedRoom, playerId, playerName: name });
    }

    // 2. Event Listeners
    // NEW Server Event
    socket.on('room_joined', ({ roomId, players, phase }) => {
      console.log('Joined Room (New Protocol):', roomId);
      setRoomId(roomId);
      setPlayers(players);
      const nextView = (phase === 'LOBBY') ? 'LOBBY' : 'GAME';
      setView(nextView);
      setPhase(phase);
      localStorage.setItem('mafia_savedRoom', roomId);
    });

    // OLD Server Event (Backward Compatibility)
    socket.on('joined_room', (id) => {
      console.log('Joined Room (Legacy Protocol):', id);
      setRoomId(id);
      localStorage.setItem('mafia_savedRoom', id);
      setView('LOBBY');
      // The old server sends 'update_players' separately, which we already handle below
    });

    socket.on('room_created', (id) => {
      // Also handle room_created just in case
      console.log('Room Created:', id);
      setRoomId(id);
      localStorage.setItem('mafia_savedRoom', id);
      setView('LOBBY');
    });

    socket.on('update_players', (list) => {
      console.log('Players Updated:', list);
      setPlayers(list);
    });

    socket.on('game_started', (list) => {
      setPlayers(list);
      setView('GAME');
    });

    socket.on('phase_change', (newPhase) => {
      setPhase(newPhase);
      setInvestigationResult(null);
    });

    socket.on('game_message', (txt) => {
      setMsg(txt);
      setTimeout(() => setMsg(''), 4000);
    });

    socket.on('play_audio', (key) => {
      if (sounds[key]) {
        Object.values(sounds).forEach(s => s.stop());
        sounds[key].play();
      }
    });

    socket.on('day_result', ({ msg, players: list }) => {
      setMsg(msg);
      setPlayers(list);
      setTimeout(() => setMsg(''), 6000);
    });

    socket.on('investigation_result', (res) => {
      setInvestigationResult(res);
    });

    socket.on('game_over', (winner) => {
      setPhase('GAME_OVER');
      setMsg(`انتهت اللعبة! الفائز: ${winner === 'MAFIA' ? 'المافيا 😈' : 'المواطنين 😇'}`);
    });

    socket.on('error', (err) => {
      console.error('Socket Error:', err);
      if (err.includes('not found') || err.includes('started')) {
        localStorage.removeItem('mafia_savedRoom');
        setView('LOGIN');
        setRoomId('');
      }
      alert(err);
    });

    socket.on('force_disconnect', () => {
      alert('تم طردك من قبل الهوست');
      localStorage.removeItem('mafia_savedRoom');
      setView('LOGIN');
      setRoomId('');
    });

    return () => {
      socket.off();
    };
  }, [playerId]);

  // === HANDLERS ===
  const handleCreate = () => {
    if (!name) return alert('الرجاء كتابة الاسم');
    localStorage.setItem('mafia_playerName', name);
    socket.emit('create_room', { playerName: name, playerId });
  };

  const handleJoin = () => {
    if (!name || !roomId) return alert('الرجاء كتابة الاسم ورمز الغرفة');
    localStorage.setItem('mafia_playerName', name);
    socket.emit('join_room', { roomId, playerName: name, playerId });
  };

  const handleStart = () => {
    socket.emit('start_game', { roomId });
  };

  const handleAction = (targetId) => {
    if (myPlayer?.isAlive) {
      socket.emit('player_action', { roomId, action: 'USE', targetId });
    }
  };

  const handleHostDayAction = (action, targetId = null) => {
    if (!myPlayer?.isHost) return;
    socket.emit('host_action_day', { roomId, action, targetId });
  };

  const handleAdminKick = (targetId) => {
    socket.emit('admin_kick_player', { roomId, targetId });
  };

  // === HELPERS ===
  const isNight = phase.includes('NIGHT');
  const isMyTurn = (phase === 'NIGHT_MAFIA' && myPlayer?.role === 'MAFIA') ||
    (phase === 'NIGHT_NURSE' && myPlayer?.role === 'DOCTOR') ||
    (phase === 'NIGHT_DETECTIVE' && myPlayer?.role === 'DETECTIVE');
  const isHostDayTurn = (phase === 'DAY_DISCUSSION' && myPlayer?.isHost);

  // === VIEWS ===

  // 1. LOGIN
  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen bg-lime-500 flex items-center justify-center p-4 dir-rtl relative overflow-hidden text-white font-sans">
        <div className="absolute inset-0 bg-gradient-radial from-lime-400 to-green-600 z-0" />

        <div className="z-10 w-full max-w-md flex flex-col items-center">
          <h1 className="text-7xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-br from-white to-lime-200 drop-shadow-xl">
            الحوش
          </h1>
          <p className="text-lime-100 mb-8 tracking-widest uppercase font-bold opacity-90">Mafia Online</p>

          <div className="bg-white/20 backdrop-blur-md p-8 rounded-3xl shadow-2xl w-full border border-white/30">
            <input
              className="w-full bg-black/30 text-white text-center p-4 rounded-xl mb-4 text-xl placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-lime-300 transition-all font-bold"
              placeholder="اسمك المستعار"
              value={name}
              onChange={e => setName(e.target.value)}
            />

            <button
              onClick={handleCreate}
              className="w-full py-4 bg-lime-600 hover:bg-lime-700 text-white rounded-xl font-bold text-lg shadow-lg transform active:scale-95 transition-all mb-4 border-b-4 border-lime-800"
            >
              إنشاء غرفة جديدة 🎮
            </button>

            <div className="flex gap-2">
              <input
                className="flex-1 bg-black/30 text-white text-center p-4 rounded-xl placeholder-white/70 font-mono text-lg uppercase focus:outline-none focus:ring-2 focus:ring-lime-300 transition-all"
                placeholder="CODE"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
              />
              <button
                onClick={handleJoin}
                className="bg-sky-600 hover:bg-sky-700 text-white px-6 rounded-xl font-bold shadow-lg border-b-4 border-sky-800 active:scale-95 transition-all"
              >
                دخول
              </button>
            </div>
          </div>

          <p className="mt-8 text-lime-900 font-bold opacity-60 text-sm">v4.0 Fixed</p>
        </div>
      </div>
    );
  }

  // 2. LOBBY
  if (view === 'LOBBY') {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-6 font-sans dir-rtl">
        {/* Admin Menu (Host Only) */}
        {myPlayer?.isHost && (
          <div className="absolute top-6 left-6 z-50">
            <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-xl border border-slate-600 text-2xl shadow-lg">
              ≡
            </button>
            {showAdminMenu && (
              <div className="absolute mt-2 left-0 w-64 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-2 z-50">
                <div className="text-red-400 font-bold text-xs p-2 uppercase">قائمة الطرد</div>
                {players.filter(p => !p.isHost).map(p => (
                  <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-800 rounded">
                    <span>{p.name}</span>
                    <button onClick={() => handleAdminKick(p.id)} className="text-red-500 bg-red-500/10 px-2 py-1 rounded text-xs">طرد</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="max-w-4xl mx-auto text-center mt-10">
          <div className="inline-block bg-slate-800 px-8 py-4 rounded-full border border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.2)] mb-8">
            <span className="text-slate-400">رمز الغرفة:</span>
            <span className="text-4xl font-mono ml-4 text-cyan-400 font-bold tracking-widest">{roomId}</span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {players.map(p => (
              <motion.div layout key={p.id} className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700 flex flex-col items-center">
                <div className="text-6xl mb-4 transform hover:scale-110 transition-transform cursor-default">
                  {p.avatar}
                </div>
                <div className="font-bold text-xl">{p.name}</div>
                {p.isHost && <span className="bg-yellow-500/20 text-yellow-400 text-xs px-2 py-1 rounded-full mt-2 border border-yellow-500/50">LEADER</span>}
              </motion.div>
            ))}
          </div>

          <div className="fixed bottom-10 left-0 w-full flex justify-center px-4">
            {myPlayer?.isHost ? (
              <button onClick={handleStart} className="w-full max-w-md py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl font-bold text-2xl shadow-xl hover:scale-105 transition-transform flex items-center justify-center gap-2">
                <span>ابدأ اللعبة</span>
                <span>🚀</span>
              </button>
            ) : (
              <div className="text-slate-500 font-bold animate-pulse text-xl bg-slate-900/50 px-6 py-3 rounded-full border border-slate-800">
                بانتظار الهوست...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. GAME
  return (
    <div className={`min-h-screen transition-colors duration-2000 ${isNight ? 'bg-black' : 'bg-slate-900'} text-white font-sans relative overflow-hidden dir-rtl`}>

      {/* Top Info */}
      <div className="absolute top-0 w-full p-4 flex justify-between items-start z-40 bg-gradient-to-b from-black/80 to-transparent">
        <div>
          <div>الاسم: <span className="font-bold text-cyan-300">{myPlayer?.name}</span></div>
          <div>الدور: <span className={`font-bold ${myPlayer?.role === 'MAFIA' ? 'text-red-500' : 'text-green-400'}`}>{myPlayer?.role}</span></div>
        </div>

        {/* Game Phase Badge */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-6 py-2 bg-slate-800/80 backdrop-blur rounded-full border border-slate-600 font-bold">
          {phase.replace(/_/g, ' ')}
        </div>

        {/* In-Game Admin Menu */}
        {myPlayer?.isHost && (
          <div className="relative">
            <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-black/40 p-2 rounded text-2xl">≡</button>
            {showAdminMenu && (
              <div className="absolute left-0 mt-2 w-56 bg-slate-900 border border-slate-600 rounded-lg p-2">
                {players.filter(p => !p.isHost).map(p => (
                  <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-800">
                    <span className="text-sm">{p.name}</span>
                    <button onClick={() => handleAdminKick(p.id)} className="text-red-400 text-xs border border-red-500/30 px-2 py-1 rounded">طرد</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages Toast */}
      <AnimatePresence>
        {msg && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="fixed top-24 left-0 w-full flex justify-center z-50 pointer-events-none">
            <div className="bg-gradient-to-r from-orange-600 to-red-600 text-white px-8 py-3 rounded-2xl shadow-2xl font-bold text-xl border-2 border-orange-400">
              {msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Investigation Result */}
      {investigationResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-indigo-900 p-8 rounded-3xl border-2 border-indigo-400 text-center shadow-[0_0_50px_rgba(99,102,241,0.5)]">
            <div className="text-6xl mb-4">🕵️‍♂️</div>
            <h3 className="text-2xl font-bold mb-2 text-indigo-200">نتيجة التحقيق</h3>
            <div className="text-3xl font-black bg-black/40 p-4 rounded-xl">{investigationResult}</div>
            <button onClick={() => setInvestigationResult(null)} className="mt-6 text-sm text-indigo-300">إغلاق</button>
          </div>
        </div>
      )}

      {/* Night Overlay */}
      {isNight && !isMyTurn && myPlayer?.isAlive && (
        <div className="fixed inset-0 bg-black/95 z-30 flex flex-col items-center justify-center text-center p-8">
          <motion.div animate={{ scale: [1, 1.05, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 4 }} className="text-9xl mb-6">🌑</motion.div>
          <h2 className="text-3xl text-slate-500 font-light tracking-[0.2em]">المدينة نائمة</h2>
        </div>
      )}

      {/* Host Controls */}
      {isHostDayTurn && (
        <div className="fixed top-32 w-full flex justify-center z-40">
          <div className="bg-slate-800/90 backdrop-blur p-4 rounded-2xl border border-red-500/50 flex items-center gap-4 shadow-2xl">
            <div className="text-red-400 font-bold px-2 border-l border-slate-600 pl-4">تحكم الهوست</div>
            <div className="text-xs text-slate-400">اختر لاعب للإعدام</div>
            <button onClick={() => handleHostDayAction('SKIP')} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg font-bold">تخطي اليوم ⏭️</button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="pt-32 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 pb-32 max-w-5xl mx-auto">
        {players.map(p => (
          <motion.div
            layout
            key={p.id}
            onClick={() => {
              if (isMyTurn && p.isAlive) handleAction(p.id);
              if (isHostDayTurn && p.isAlive) handleHostDayAction('KICK', p.id);
            }}
            className={`
                        relative bg-slate-800 p-6 rounded-2xl flex flex-col items-center border-2 cursor-pointer transition-all
                        ${!p.isAlive ? 'border-red-900 bg-red-950/30 grayscale opacity-60' : 'border-slate-700'}
                        ${(isMyTurn || isHostDayTurn) && p.isAlive && p.id !== myPlayer?.id ? 'hover:border-yellow-400 hover:scale-105 hover:shadow-[0_0_15px_rgba(250,204,21,0.4)]' : ''}
                        ${myPlayer?.id === p.id ? 'ring-2 ring-cyan-500 ring-offset-2 ring-offset-slate-900' : ''}
                    `}
          >
            <div className="text-6xl mb-3">{p.isAlive ? p.avatar : '💀'}</div>
            <div className="font-bold text-center w-full truncate">{p.name}</div>
            {isHostDayTurn && p.isAlive && <div className="absolute top-2 right-2 text-red-500 animate-pulse text-xl">☠️</div>}
            {!p.isAlive && <div className="absolute inset-0 flex items-center justify-center text-red-600 font-black text-3xl opacity-80 border-4 border-red-600 rounded-xl -rotate-12">ميت</div>}
          </motion.div>
        ))}
      </div>

      {/* Footer Status */}
      <div className="fixed bottom-0 w-full bg-gradient-to-t from-slate-900 to-transparent pt-20 pb-8 text-center z-40 pointer-events-none">
        {myPlayer?.isAlive ? (
          <div className="text-2xl font-bold animate-pulse">
            {isMyTurn ? <span className="text-green-400">⚡ دورك الآن! ⚡</span> :
              isHostDayTurn ? <span className="text-red-400">🚨 قرارك يا هوست 🚨</span> :
                <span className="text-slate-500">انتظر دورك...</span>}
          </div>
        ) : (
          <div className="text-red-500 font-bold text-xl">👻 أنت ميت</div>
        )}
      </div>

    </div>
  );
}
