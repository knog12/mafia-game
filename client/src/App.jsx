import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

// === CONFIG ===
const SERVER_URL = 'https://mafia-game-dpfv.onrender.com';
const socket = io(SERVER_URL);

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
  const [playerId, setPlayerId] = useState('');
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [view, setView] = useState('LOGIN'); // LOGIN | LOBBY | GAME
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [phase, setPhase] = useState('LOBBY');
  const [msg, setMsg] = useState('');
  const [investigationResult, setInvestigationResult] = useState(null);

  // Admin Menu
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  // === INIT & EFFECTS ===
  useEffect(() => {
    // 1. UUID & LocalStorage Init
    let storedId = localStorage.getItem('mafia_playerId');
    if (!storedId) {
      storedId = uuidv4();
      localStorage.setItem('mafia_playerId', storedId);
    }
    setPlayerId(storedId);

    const storedName = localStorage.getItem('mafia_playerName');
    if (storedName) setName(storedName);

    // 2. Auto-Reconnect
    const savedRoom = localStorage.getItem('mafia_savedRoom');
    if (savedRoom && storedId && storedName) {
      console.log('Auto-reconnecting to:', savedRoom);
      setRoomId(savedRoom);
      socket.emit('join_room', { roomId: savedRoom, playerName: storedName, playerId: storedId });
    }

    // 3. Socket Listeners
    socket.on('room_created', (id) => {
      setRoomId(id);
      localStorage.setItem('mafia_savedRoom', id);
      setView('LOBBY');
    });

    socket.on('joined_room', (id) => {
      setRoomId(id);
      localStorage.setItem('mafia_savedRoom', id);
      setView('LOBBY');
    });

    socket.on('update_players', (list) => {
      setPlayers(list);
      // Update myPlayer reference
      const me = list.find(p => p.id === storedId);
      if (me) setMyPlayer(me);
    });

    socket.on('player_reconnected', ({ player, players: list, phase }) => {
      setMyPlayer(player);
      setPlayers(list);
      setPhase(phase);
      setView(phase === 'LOBBY' ? 'LOBBY' : 'GAME');
      console.log('Restored State:', phase);
    });

    socket.on('game_started', (list) => {
      setPlayers(list);
      const me = list.find(p => p.id === storedId);
      if (me) setMyPlayer(me);
      setView('GAME');
    });

    socket.on('phase_change', (newPhase) => {
      setPhase(newPhase);
      setInvestigationResult(null); // Clear old results
    });

    socket.on('play_audio', (key) => {
      // Basic stop-all to prevent overlap (Server handles main timing, this is backup)
      Object.keys(sounds).forEach(k => sounds[k].stop());
      if (sounds[key]) sounds[key].play();
    });

    socket.on('day_result', ({ msg, players: list }) => {
      setMsg(msg);
      setPlayers(list);
      setTimeout(() => setMsg(''), 6000);
    });

    socket.on('game_message', (txt) => {
      setMsg(txt);
      setTimeout(() => setMsg(''), 4000);
    });

    socket.on('investigation_result', (txt) => {
      setInvestigationResult(txt);
    });

    socket.on('game_over', (winner) => {
      setPhase('GAME_OVER');
      setMsg(`🏆 GAME OVER! Winner: ${winner} 🏆`);
    });

    socket.on('force_disconnect', () => {
      localStorage.removeItem('mafia_savedRoom');
      setRoomId('');
      setView('LOGIN');
      alert('You have been kicked by the Host.');
    });

    socket.on('error', (err) => {
      console.error(err);
      if (err.includes('الغرفة غير موجودة') || err.includes('started')) {
        localStorage.removeItem('mafia_savedRoom');
        setView('LOGIN');
      }
      alert(err);
    });

    return () => socket.off();
  }, [playerId]);

  // === HANDLERS ===
  const handleCreate = () => {
    if (!name) return alert('Name Required');
    localStorage.setItem('mafia_playerName', name);
    socket.emit('create_room', { playerName: name, playerId });
  };

  const handleJoin = () => {
    if (!name || !roomId) return alert('Name & Code Required');
    localStorage.setItem('mafia_playerName', name);
    socket.emit('join_room', { roomId, playerName: name, playerId });
  };

  const handleStart = () => {
    socket.emit('start_game', { roomId });
  };

  const handleAction = (targetId) => {
    if (!myPlayer?.isAlive) return;
    socket.emit('player_action', { roomId, action: 'USE', targetId });
  };

  const handleHostDayAction = (action, targetId = null) => {
    if (!myPlayer?.isHost) return;
    if (confirm('Are you sure?')) {
      socket.emit('host_action_day', { roomId, action, targetId });
    }
  };

  const handleAdminKick = (targetId) => {
    if (confirm('Kick this player permanently?')) {
      socket.emit('admin_kick_player', { roomId, targetId });
    }
  };

  // === RENDER HELPERS ===
  const isNight = phase.includes('NIGHT');
  const isMyTurn = (phase === 'NIGHT_MAFIA' && myPlayer?.role === 'MAFIA') ||
    (phase === 'NIGHT_NURSE' && myPlayer?.role === 'DOCTOR') ||
    (phase === 'NIGHT_DETECTIVE' && myPlayer?.role === 'DETECTIVE');

  const isHostDayTurn = (phase === 'DAY_DISCUSSION' && myPlayer?.isHost);

  // === VIEWS ===

  // 1. LOGIN VIEW
  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 dir-rtl relative overflow-hidden text-white font-sans">
        <div className="absolute inset-0 bg-gradient-radial from-slate-900 to-black z-0" />

        <div className="z-10 w-full max-w-md flex flex-col items-center">
          <h1 className="text-8xl font-black mb-4 text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 drop-shadow-2xl">
            الحوش
          </h1>
          <p className="tracking-[0.4em] text-cyan-300 opacity-80 mb-12 uppercase">Mafia Night</p>

          <div className="w-full bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 p-8 rounded-3xl shadow-2xl">
            <input
              className="w-full bg-slate-800 text-white text-center p-4 rounded-xl mb-4 text-xl border border-slate-700 focus:border-pink-500 focus:outline-none transition-colors"
              placeholder="اسمك المستعار..."
              value={name}
              onChange={e => setName(e.target.value)}
            />

            <button
              onClick={handleCreate}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg shadow-lg hover:brightness-110 active:scale-95 transition-all mb-6"
            >
              🎮 إنشاء غرفة
            </button>

            <div className="border-t border-slate-700 my-4" />

            <div className="flex gap-2">
              <input
                className="flex-1 bg-slate-800 text-center p-4 rounded-xl border border-slate-700 uppercase font-mono tracking-widest text-lg focus:border-cyan-500 focus:outline-none"
                placeholder="CODE"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
              />
              <button
                onClick={handleJoin}
                className="px-8 bg-cyan-600 rounded-xl font-bold hover:bg-cyan-500 active:scale-95 transition-all"
              >
                دخول
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. LOBBY VIEW
  if (view === 'LOBBY') {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 dir-rtl font-sans bg-[url('/bg-pattern.png')]">
        {/* Header */}
        <div className="flex justify-between items-center mb-10">
          <div className="bg-slate-900 px-6 py-3 rounded-full border border-slate-700 shadow-xl flex gap-3 items-center">
            <span className="text-slate-400">ROOM:</span>
            <span className="text-4xl font-mono text-cyan-400 tracking-widest font-black">{roomId}</span>
          </div>

          {myPlayer?.isHost && (
            <div className="relative z-50">
              <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-slate-800 p-3 rounded-xl hover:bg-slate-700 border border-slate-600 text-2xl">
                ≡
              </button>
              <AnimatePresence>
                {showAdminMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="absolute left-0 mt-2 w-64 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-2"
                  >
                    <div className="text-xs text-red-400 font-bold mb-2 px-2 uppercase tracking-wider">Kick Players</div>
                    {players.filter(p => p.id !== myPlayer?.id).map(p => (
                      <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-800 rounded-lg">
                        <span>{p.name}</span>
                        <button onClick={() => handleAdminKick(p.id)} className="bg-red-500/20 text-red-500 px-2 py-1 text-xs rounded border border-red-500/50">Kick</button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Players Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {players.map(p => (
            <motion.div layout key={p.id} className="bg-slate-900/50 backdrop-blur border border-slate-800 p-6 rounded-3xl flex flex-col items-center relative overflow-hidden group">
              <div className="text-7xl mb-4 drop-shadow-lg group-hover:scale-110 transition-transform">{p.avatar}</div>
              <div className="font-bold text-2xl truncate">{p.name}</div>
              {p.isHost && <span className="absolute top-4 right-4 bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-xs border border-yellow-500/50">HOST</span>}
            </motion.div>
          ))}
        </div>

        {/* Start Button */}
        <div className="fixed bottom-10 left-0 w-full flex justify-center px-4">
          {myPlayer?.isHost ? (
            <button onClick={handleStart} className="w-full max-w-lg py-5 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl font-bold text-2xl shadow-2xl shadow-emerald-500/30 hover:scale-105 transition-all">
              START GAME 🚀
            </button>
          ) : (
            <div className="text-slate-500 animate-pulse text-xl">Waiting for Host...</div>
          )}
        </div>
      </div>
    );
  }

  // 3. GAME VIEW
  return (
    <div className={`min-h-screen transition-colors duration-1000 ${isNight ? 'bg-black' : 'bg-slate-900'} text-white overflow-hidden relative font-sans`}>

      {/* Top Bar */}
      <div className="absolute top-0 w-full p-4 z-40 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-start">
        <div>
          <div className="text-sm text-slate-400">Name: <span className="text-white font-bold">{myPlayer?.name}</span></div>
          <div className="text-sm text-slate-400">Role: <span className={`font-bold ${myPlayer?.role === 'MAFIA' ? 'text-red-500' : 'text-cyan-400'}`}>{myPlayer?.role}</span></div>
        </div>

        {/* In-Game Admin Menu */}
        {myPlayer?.isHost && (
          <div className="relative">
            <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-black/50 p-2 rounded text-white text-2xl backdrop-blur">≡</button>
            {showAdminMenu && (
              <div className="absolute left-0 mt-2 w-64 bg-slate-900/95 border border-slate-600 rounded-xl p-2 right-0">
                <div className="text-xs text-red-500 font-bold p-2">KICK MENU</div>
                {players.filter(p => !p.isHost).map(p => (
                  <div key={p.id} className="flex justify-between p-2 hover:bg-slate-800 text-sm">
                    <span>{p.name} {p.isAlive ? '' : '💀'}</span>
                    <button onClick={() => handleAdminKick(p.id)} className="text-red-400 border border-red-900 px-1 rounded">❌</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Phase Indicator */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30">
        <div className="px-6 py-2 rounded-full bg-slate-800/80 backdrop-blur border border-slate-600 font-mono text-sm tracking-widest uppercase">
          {phase.replace('_', ' ')}
        </div>
      </div>

      {/* Notifications */}
      <AnimatePresence>
        {msg && (
          <motion.div initial={{ y: -100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -100, opacity: 0 }} className="fixed top-24 left-0 w-full z-50 flex justify-center pointer-events-none">
            <div className="bg-slate-800 border border-slate-600 text-white px-8 py-4 rounded-2xl shadow-2xl text-xl max-w-lg text-center backdrop-blur-xl">
              {msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Investigation Result Pop-up */}
      {investigationResult && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-purple-900/90 p-10 rounded-3xl border-2 border-purple-500 text-center shadow-[0_0_50px_rgba(168,85,247,0.5)]">
            <div className="text-6xl mb-4">🕵️‍♂️</div>
            <h2 className="text-3xl font-bold mb-2">Investigation Result</h2>
            <div className="text-4xl font-mono bg-black/50 p-4 rounded-xl mt-4">{investigationResult}</div>
          </div>
        </motion.div>
      )}

      {/* Night Overlay */}
      {isNight && !isMyTurn && myPlayer?.isAlive && (
        <div className="fixed inset-0 bg-black/95 z-30 flex flex-col items-center justify-center p-8 text-center text-slate-600">
          <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.7, 0.3] }} transition={{ repeat: Infinity, duration: 3 }} className="text-9xl mb-8">🌑</motion.div>
          <h2 className="text-4xl font-light tracking-widest">NIGHT FALLS</h2>
          <p className="mt-4 text-xl">The city is sleeping...</p>
        </div>
      )}

      {/* Host Controls (Day Only) */}
      {isHostDayTurn && (
        <div className="fixed top-28 w-full z-40 flex justify-center">
          <div className="bg-slate-800/90 border border-red-500/50 p-4 rounded-2xl flex gap-4 backdrop-blur shadow-2xl">
            <div className="text-red-400 font-bold flex items-center px-4 border-r border-slate-600">
              HOST CONTROLS
            </div>
            <button onClick={() => handleHostDayAction('SKIP')} className="bg-green-600 hover:bg-green-500 px-6 py-2 rounded-xl font-bold transition-all">SKIP DAY ⏭️</button>
            <div className="text-slate-400 text-xs flex items-center max-w-xs">
              Select a player below to EXECUTE (Kick)
            </div>
          </div>
        </div>
      )}

      {/* Main Game Grid */}
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
                        relative bg-slate-800 rounded-2xl p-6 flex flex-col items-center transition-all cursor-pointer border-2
                        ${p.isAlive ? 'border-slate-700' : 'border-red-900 bg-slate-900 grayscale opacity-60'}
                        ${(isMyTurn || isHostDayTurn) && p.isAlive && p.id !== myPlayer.id ? 'hover:border-yellow-400 hover:scale-105 hover:shadow-[0_0_20px_rgba(250,204,21,0.3)]' : ''}
                        ${myPlayer.id === p.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900' : ''}
                    `}
          >
            <div className="text-6xl mb-3">{p.isAlive ? p.avatar : '💀'}</div>
            <div className="font-bold text-center truncate w-full">{p.name}</div>
            {!p.isAlive && <div className="absolute inset-0 flex items-center justify-center text-red-600 font-black text-3xl opacity-80 rotate-[-20deg] border-4 border-red-600 rounded-xl">ELIMINATED</div>}

            {isHostDayTurn && p.isAlive && (
              <div className="absolute top-2 right-2 text-red-500 animate-pulse text-xl">☠️</div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Footer Status */}
      <div className="fixed bottom-0 w-full bg-gradient-to-t from-slate-900 to-transparent pt-20 pb-8 text-center z-40 pointer-events-none">
        {myPlayer?.isAlive ? (
          <div className="text-2xl font-bold animate-pulse">
            {isMyTurn ? <span className="text-green-400">⚡ YOUR TURN ⚡</span> :
              isHostDayTurn ? <span className="text-red-400">🚨 HOST DECISION 🚨</span> :
                <span className="text-slate-500">Wait...</span>}
          </div>
        ) : (
          <div className="text-red-500 font-bold text-xl">👻 YOU ARE DEAD</div>
        )}
      </div>

    </div>
  );
}
