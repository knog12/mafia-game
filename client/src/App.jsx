import { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

// === CONFIG ===
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL, {
  transports: ['polling', 'websocket'], // Try polling first, then upgrade to websocket
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 60000, // 60 seconds for Render cold start
});

// === CONSTANTS ===
const ROLES_AR = {
  MAFIA: 'المافيا 🕴️',
  DOCTOR: 'الممرضة 💉',
  DETECTIVE: 'الشايب 👴',
  CITIZEN: 'مواطن 🏘️',
  PENDING: 'جاري التوزيع...'
};

// === SOUNDS ===
const sounds = {
  everyone_sleep: new Howl({ src: ['/sounds/everyone_sleep.mp3'] }),
  mafia_wake: new Howl({ src: ['/sounds/mafia_wake.mp3'] }),
  nurse_wake: new Howl({ src: ['/sounds/nurse_wake.mp3'] }),
  detective_wake: new Howl({ src: ['/sounds/detective_wake.mp3'] }),
  everyone_wake: new Howl({ src: ['/sounds/everyone_wake.mp3'] }),
  result_success: new Howl({ src: ['/sounds/result_success.mp3'] }),
  result_fail: new Howl({ src: ['/sounds/result_fail.mp3'] }),
};

export default function App() {
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
  const [view, setView] = useState('LOGIN');
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState('LOBBY');
  const [msg, setMsg] = useState('');
  const [investigationResult, setInvestigationResult] = useState(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const myPlayer = players.find(p => p.id === playerId) ||
    players.find(p => p.name === name);

  useEffect(() => {
    const savedRoom = localStorage.getItem('mafia_savedRoom');
    if (savedRoom && playerId && name) {
      setRoomId(savedRoom);
      socket.emit('reconnect_user', { roomId: savedRoom, playerId, playerName: name });
    }

    socket.on('room_joined', ({ roomId, players, phase }) => {
      setIsCreating(false);
      setRoomId(roomId);
      setPlayers([...players]);
      setPhase(phase);
      setView(phase === 'LOBBY' ? 'LOBBY' : 'GAME');
      localStorage.setItem('mafia_savedRoom', roomId);
    });

    socket.on('update_players', (list) => setPlayers([...list]));
    socket.on('game_started', (list) => { setPlayers([...list]); setView('GAME'); });
    socket.on('phase_change', (p) => { setPhase(p); setInvestigationResult(null); });
    socket.on('game_message', (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000); });
    socket.on('play_audio', (key) => { if (sounds[key]) { Object.values(sounds).forEach(s => s.stop()); sounds[key].play(); } });
    socket.on('day_result', ({ msg, players }) => { setMsg(msg); setPlayers(players); setTimeout(() => setMsg(''), 6000); });
    socket.on('investigation_result', res => setInvestigationResult(res));
    socket.on('game_over', w => { setPhase('GAME_OVER'); setMsg(`انتهت اللعبة! الفائز: ${w === 'MAFIA' ? 'المافيا' : 'المواطنون'}`); });
    socket.on('error', err => { setIsCreating(false); alert(err); if (err.includes('not found')) setView('LOGIN'); });
    socket.on('force_disconnect', () => { alert('تم طردك'); setView('LOGIN'); localStorage.removeItem('mafia_savedRoom'); });

    return () => socket.off();
  }, [playerId, name]);

  const handleCreate = () => {
    if (!name) return alert('أدخل الاسم');
    setIsCreating(true);
    localStorage.setItem('mafia_playerName', name);
    socket.emit('create_room', { playerName: name, playerId });
  };

  const handleJoin = () => {
    if (!name || !roomId) return alert('أدخل البيانات');
    localStorage.setItem('mafia_playerName', name);
    socket.emit('join_room', { roomId: roomId.toUpperCase().trim(), playerName: name, playerId });
  };

  const startGame = () => socket.emit('start_game', { roomId });
  const handleAction = (targetId) => { if (myPlayer?.isAlive) socket.emit('player_action', { roomId, action: 'USE', targetId }); };
  const hostAction = (action, targetId = null) => socket.emit('host_action_day', { roomId, action, targetId });
  const adminKick = (targetId) => socket.emit('admin_kick_player', { roomId, targetId });

  const isNight = phase.includes('NIGHT');
  const isMyTurn = (phase === 'NIGHT_MAFIA' && myPlayer?.role === 'MAFIA') ||
    (phase === 'NIGHT_NURSE' && myPlayer?.role === 'DOCTOR') ||
    (phase === 'NIGHT_DETECTIVE' && myPlayer?.role === 'DETECTIVE');
  const isHostDay = phase === 'DAY_DISCUSSION' && myPlayer?.isHost;

  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen bg-lime-500 flex items-center justify-center p-4 dir-rtl relative overflow-hidden font-sans">
        <div className="z-10 w-full max-w-md bg-white/20 backdrop-blur-md p-8 rounded-3xl shadow-2xl border border-white/30 text-center">
          <h1 className="text-7xl font-black mb-2 text-white drop-shadow-xl">الحوش</h1>
          <p className="text-lime-100 mb-8 font-bold opacity-90 uppercase tracking-widest">MAFIA ONLINE</p>
          <input className="w-full bg-black/30 text-white text-center p-4 rounded-xl mb-4 text-xl placeholder-white/70 font-bold border-none outline-none focus:ring-2 focus:ring-white" placeholder="اسمك المستعار" value={name} onChange={e => setName(e.target.value)} />
          <button onClick={handleCreate} disabled={isCreating} className="w-full py-4 bg-lime-600 hover:bg-lime-700 text-white rounded-xl font-bold text-lg shadow-lg mb-4 border-b-4 border-lime-800 transition-all active:scale-95">{isCreating ? '...جاري الاتصال بالسيرفر' : 'إنشاء غرفة جديدة 🎮'}</button>
          <div className="flex gap-2">
            <input className="flex-1 bg-black/30 text-white text-center p-4 rounded-xl placeholder-white/70 font-mono text-lg uppercase" placeholder="CODE" value={roomId} onChange={e => setRoomId(e.target.value)} />
            <button onClick={handleJoin} className="bg-sky-600 hover:bg-sky-700 text-white px-6 rounded-xl font-bold shadow-lg border-b-4 border-sky-800 active:scale-95 transition-all">دخول</button>
          </div>
          <p className="mt-8 text-lime-900 font-bold opacity-60 text-xs">ملاحظة: قد يستغرق الاتصال بالسيرفر حتى 60 ثانية عند أول اتصال</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-1000 ${isNight ? 'bg-black' : 'bg-slate-900'} text-white font-sans dir-rtl relative overflow-hidden`}>
      {myPlayer?.isHost && (
        <div className="fixed top-6 left-6 z-50">
          <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-slate-800 p-3 rounded-xl border border-slate-600 text-2xl shadow-lg">≡</button>
          {showAdminMenu && (
            <div className="absolute top-14 left-0 w-64 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-2">
              <div className="text-red-400 font-bold text-xs p-2 uppercase">قائمة الطرد</div>
              {players.filter(p => !p.isHost).map(p => (
                <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-800 rounded">
                  <span>{p.name}</span>
                  <button onClick={() => adminKick(p.id)} className="text-red-500 bg-red-500/10 px-2 py-1 rounded text-xs">طرد</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'LOBBY' && (
        <div className="max-w-4xl mx-auto text-center mt-20 p-6">
          <div className="inline-block bg-slate-800 px-8 py-4 rounded-full border border-purple-500/30 shadow-xl mb-12">
            <span className="text-slate-400 ml-4">رمز الغرفة:</span>
            <span className="text-4xl font-mono text-purple-400 font-bold tracking-widest">{roomId}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {players.map(p => (
              <motion.div layout key={p.id} className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700 flex flex-col items-center">
                <div className="text-6xl mb-4 transform hover:scale-110 transition-transform">{p.avatar}</div>
                <div className="font-bold text-xl">{p.name}</div>
                {p.isHost && <span className="bg-yellow-500/20 text-yellow-400 text-xs px-2 py-1 rounded-full mt-2 border border-yellow-500/50">LEADER</span>}
              </motion.div>
            ))}
          </div>
          <div className="fixed bottom-10 left-0 w-full flex justify-center px-4">
            {myPlayer?.isHost ? (
              <button onClick={startGame} className="w-full max-w-md py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl font-bold text-2xl shadow-xl hover:scale-105 transition-transform">ابدأ اللعبة 🚀</button>
            ) : (
              <div className="text-slate-500 font-bold animate-pulse text-xl bg-slate-900/50 px-6 py-3 rounded-full border border-slate-800">بانتظار الهوست...</div>
            )}
          </div>
        </div>
      )}

      {view === 'GAME' && (
        <>
          <div className="absolute top-0 w-full p-6 flex justify-between items-start z-40 bg-gradient-to-b from-black/80 to-transparent">
            <div>
              <div className="text-slate-400 text-sm">الملف الشخصي</div>
              <div className="text-2xl font-bold text-cyan-300">{myPlayer?.name}</div>
              <div className={`mt-1 font-bold ${myPlayer?.role === 'MAFIA' ? 'text-red-500' : 'text-green-400'}`}>{ROLES_AR[myPlayer?.role]}</div>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 top-6 px-6 py-2 bg-slate-800/80 rounded-full border border-slate-600 font-bold shadow-lg">{phase.replace(/_/g, ' ')}</div>
          </div>

          <div className="pt-32 px-4 pb-32 grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
            {players.map(p => (
              <motion.div layout key={p.id} onClick={() => isMyTurn && p.isAlive && handleAction(p.id)}
                className={`relative bg-slate-800 p-6 rounded-2xl flex flex-col items-center border-2 transition-all cursor-pointer ${!p.isAlive ? 'border-red-900 bg-red-950/30 grayscale opacity-60' : 'border-slate-700'} ${isMyTurn && p.isAlive && p.id !== myPlayer?.id ? 'hover:border-purple-500 hover:scale-105' : ''} ${myPlayer?.id === p.id ? 'ring-2 ring-purple-500' : ''}`}>
                <div className="text-7xl mb-4">{p.isAlive ? p.avatar : '💀'}</div>
                <div className="font-bold text-center w-full truncate">{p.name}</div>
                {!p.isAlive && <div className="absolute inset-0 flex items-center justify-center text-red-600 font-black text-3xl opacity-80 border-4 border-red-600 rounded-xl -rotate-12">ميت</div>}
                {isHostDay && p.isAlive && p.id !== myPlayer?.id && (
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(`إعدام ${p.name}؟`)) hostAction('KICK', p.id); }} className="absolute -top-3 -right-3 bg-red-600 text-white w-10 h-10 rounded-full font-bold shadow-lg flex items-center justify-center border-2 border-slate-900">🔪</button>
                )}
              </motion.div>
            ))}
          </div>

          {isHostDay && (
            <div className="fixed top-28 left-1/2 -translate-x-1/2 z-50 flex gap-4 w-full justify-center px-4">
              <div className="bg-slate-800/90 backdrop-blur p-4 rounded-2xl border border-red-500/30 flex items-center gap-6 shadow-2xl">
                <button onClick={() => hostAction('SKIP')} className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white px-8 py-3 rounded-xl font-bold text-lg">تخطي اليوم ⏭️</button>
              </div>
            </div>
          )}

          <AnimatePresence>
            {msg && (
              <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="fixed top-24 left-0 w-full flex justify-center z-50 pointer-events-none">
                <div className="bg-red-600 text-white px-8 py-3 rounded-2xl shadow-2xl font-bold text-xl">{msg}</div>
              </motion.div>
            )}
          </AnimatePresence>

          {investigationResult && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-slate-800 p-10 rounded-3xl border border-slate-600 text-center shadow-2xl">
                <div className="text-6xl mb-4">🕵️‍♂️</div>
                <div className="text-3xl font-black bg-slate-900 p-6 rounded-xl border border-slate-700 mb-6">{investigationResult}</div>
                <button onClick={() => setInvestigationResult(null)} className="text-slate-400 underline">إغلاق</button>
              </div>
            </div>
          )}

          {isNight && !isMyTurn && myPlayer?.isAlive && (
            <div className="fixed inset-0 bg-black/95 z-30 flex flex-col items-center justify-center text-center p-8">
              <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.7, 0.3] }} transition={{ repeat: Infinity, duration: 4 }} className="text-9xl mb-8">🌑</motion.div>
              <h2 className="text-4xl text-slate-700 tracking-[0.5em] uppercase">المدينة نائمة</h2>
            </div>
          )}

          <div className="fixed bottom-0 w-full bg-gradient-to-t from-slate-900 to-transparent pt-32 pb-8 text-center z-30 pointer-events-none">
            {isMyTurn ? (
              <div className="text-3xl font-black text-green-400 animate-pulse">⚡ دورك الآن! ⚡</div>
            ) : isHostDay ? (
              <div className="text-3xl font-black text-red-400 animate-pulse">🚨 قرار الهوست 🚨</div>
            ) : (
              <div className="text-xl text-slate-500 font-bold">بانتظار الآخرين...</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}