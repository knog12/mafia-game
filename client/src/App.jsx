import { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';


const SERVER_URL = 'https://mafia-game-dpfv.onrender.com';

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: true,
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
  // === STATE ===
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
  const [isConnected, setIsConnected] = useState(socket.connected);

  // === DERIVED ===
  const myPlayer = players.find(p => p.id === playerId) ||
    players.find(p => p.socketId === socket.id) ||
    players.find(p => p.name === name);

  // === EFFECTS ===
  useEffect(() => {
    // مراقبة الاتصال
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    const savedRoom = localStorage.getItem('mafia_savedRoom');
    if (savedRoom && playerId && name && socket.connected) {
      setRoomId(savedRoom);
      socket.emit('reconnect_user', { roomId: savedRoom, playerId, playerName: name });
    }

    socket.on('room_joined', ({ roomId, players, phase }) => {
      console.log("Joined Room:", roomId);
      setRoomId(roomId);
      setPlayers([...players]); // إنشاء مصفوفة جديدة لفرض التحديث
      setPhase(phase);
      setView(phase === 'LOBBY' ? 'LOBBY' : 'GAME');
      localStorage.setItem('mafia_savedRoom', roomId);
    });

    socket.on('update_players', (list) => {
      console.log("Updating Players List:", list);
      setPlayers([...list]); // مهم جداً لرؤية الأعضاء الجدد
    });

    socket.on('game_started', (list) => { setPlayers([...list]); setView('GAME'); });
    socket.on('phase_change', (p) => { setPhase(p); setInvestigationResult(null); });
    socket.on('game_message', (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000); });

    socket.on('play_audio', (key) => {
      if (sounds[key]) {
        Object.values(sounds).forEach(s => s.stop());
        sounds[key].play();
      }
    });

    socket.on('day_result', ({ msg, players }) => {
      setMsg(msg);
      setPlayers(players);
      setTimeout(() => setMsg(''), 6000);
    });

    socket.on('investigation_result', res => setInvestigationResult(res));
    socket.on('game_over', w => { setPhase('GAME_OVER'); setMsg(`الفائز: ${w}`); });

    socket.on('error', err => {
      console.error(err);
      if (err.includes('not found')) {
        setView('LOGIN');
        localStorage.removeItem('mafia_savedRoom');
      }
    });

    socket.on('force_disconnect', () => {
      alert('تم طردك بواسطة الهوست');
      setView('LOGIN');
      localStorage.removeItem('mafia_savedRoom');
    });

    return () => {
      socket.off();
    };
  }, [playerId, name]);

  // === ACTIONS ===
  const createRoom = () => {
    if (!name) return alert('أدخل الاسم');
    if (!socket.connected) return alert('جار الاتصال بالسيرفر... حاول مرة أخرى بعد ثانية');

    localStorage.setItem('mafia_playerName', name);
    console.log("Creating room for:", name);
    socket.emit('create_room', { playerName: name, playerId });
  };

  const joinRoom = () => {
    if (!name || !roomId) return alert('أدخل البيانات');
    if (!socket.connected) return alert('لا يوجد اتصال بالسيرفر');

    const code = roomId.toUpperCase().trim(); // تنظيف الكود
    localStorage.setItem('mafia_playerName', name);
    socket.emit('join_room', { roomId: code, playerName: name, playerId });
  };

  const startGame = () => socket.emit('start_game', { roomId });

  const handleAction = (targetId) => {
    if (myPlayer?.isAlive) {
      socket.emit('player_action', { roomId, action: 'USE', targetId });
    }
  };

  const hostAction = (action, targetId = null) => {
    socket.emit('host_action_day', { roomId, action, targetId });
  };

  const adminKick = (targetId) => {
    if (confirm('هل أنت متأكد من طرد هذا اللاعب؟')) {
      socket.emit('admin_kick_player', { roomId, targetId });
    }
  };

  // === RENDER ===
  const isNight = phase.includes('NIGHT');
  const isMyTurn = (phase === 'NIGHT_MAFIA' && myPlayer?.role === 'MAFIA') ||
    (phase === 'NIGHT_NURSE' && myPlayer?.role === 'DOCTOR') ||
    (phase === 'NIGHT_DETECTIVE' && myPlayer?.role === 'DETECTIVE');
  const isHostDay = phase === 'DAY_DISCUSSION' && myPlayer?.isHost;

  // 1. LOGIN SCREEN
  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 dir-rtl font-sans relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-slate-800 to-slate-950 z-0" />

        <div className="z-10 w-full max-w-md bg-slate-800/50 backdrop-blur-xl p-8 rounded-3xl border border-slate-700 shadow-2xl text-center">
          <h1 className="text-6xl font-black mb-2 bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent drop-shadow-lg">
            الحوش
          </h1>
          <p className="text-slate-400 mb-8 tracking-[0.3em] font-light">MAFIA ONLINE</p>

          {/* مؤشر الاتصال */}
          <div className={`mb-4 text-xs font-bold ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
            {isConnected ? '● متصل بالسيرفر' : '○ غير متصل (تحقق من تشغيل السيرفر)'}
          </div>

          <input
            className="w-full bg-slate-900/80 text-white text-center p-4 rounded-xl mb-4 text-xl border border-slate-700 focus:border-purple-500 focus:outline-none transition-all placeholder:text-slate-600"
            placeholder="اسمك المستعار"
            value={name}
            onChange={e => setName(e.target.value)}
          />

          <button
            onClick={createRoom}
            disabled={!isConnected}
            className={`w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition-all shadow-lg mb-4 ${!isConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            إنشاء غرفة 🧱
          </button>

          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-900/80 text-white text-center p-4 rounded-xl text-lg font-mono uppercase border border-slate-700 focus:border-purple-500 focus:outline-none"
              placeholder="CODE"
              value={roomId}
              onChange={e => setRoomId(e.target.value.toUpperCase())}
            />
            <button
              onClick={joinRoom}
              disabled={!isConnected}
              className={`px-8 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all ${!isConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              دخول
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. LOBBY & GAME COMMON WRAPPER
  return (
    <div className={`min-h-screen transition-colors duration-1000 ${isNight ? 'bg-black' : 'bg-slate-900'} text-white font-sans dir-rtl relative overflow-hidden`}>

      {/* PERMANENT ADMIN MENU */}
      {myPlayer?.isHost && (
        <div className="fixed top-4 left-4 z-50">
          <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-slate-800 p-3 rounded-xl border border-slate-600 text-2xl hover:bg-slate-700 shadow-xl">
            ≡
          </button>
          {showAdminMenu && (
            <div className="absolute top-14 left-0 w-64 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
              <div className="bg-red-500/20 text-red-300 p-2 text-xs font-bold text-center">قائمة الطرد (Admin)</div>
              {players.filter(p => !p.isHost).map(p => (
                <div key={p.id} className="flex justify-between items-center p-3 hover:bg-slate-700 border-b border-slate-700 last:border-0">
                  <span>{p.name}</span>
                  <button onClick={() => adminKick(p.id)} className="text-red-400 bg-red-950/50 px-2 py-1 rounded text-xs hover:bg-red-900">طرد 🚫</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: LOBBY */}
      {view === 'LOBBY' && (
        <div className="max-w-5xl mx-auto p-8 text-center pt-24">
          <div className="inline-block bg-slate-800 px-10 py-5 rounded-full border border-purple-500/30 shadow-[0_0_30px_rgba(168,85,247,0.2)] mb-12">
            <span className="text-slate-400 ml-4">رمز الغرفة:</span>
            <span className="text-5xl font-mono text-purple-400 font-bold tracking-widest">{roomId}</span>
          </div>

          <h3 className="text-slate-400 mb-6">اللاعبون المتواجدون ({players.length})</h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            {players.map(p => (
              <motion.div layout key={p.id} className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700 flex flex-col items-center relative">
                <div className="text-6xl mb-4 grayscale-[0.3] hover:grayscale-0 transition-all cursor-default scale-110">{p.avatar}</div>
                <div className="font-bold text-xl">{p.name}</div>
                {p.isHost && <span className="absolute top-2 right-2 text-yellow-500 text-xs bg-yellow-900/30 px-2 py-0.5 rounded border border-yellow-700">HOST</span>}
              </motion.div>
            ))}
          </div>

          {myPlayer?.isHost ? (
            <button onClick={startGame} className="w-full max-w-md py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl font-bold text-2xl shadow-xl hover:scale-105 active:scale-95 transition-all">
              ابدأ اللعبة 🚀
            </button>
          ) : (
            <div className="text-slate-500 animate-pulse text-xl border border-slate-700 p-4 rounded-xl bg-slate-800/50">
              بانتظار الهوست لبدء اللعبة... ⏳
            </div>
          )}
        </div>
      )}

      {/* VIEW: GAME */}
      {view === 'GAME' && (
        <>
          {/* TOP INFO */}
          <div className="absolute top-0 right-0 w-full p-6 flex justify-between items-start z-40 bg-gradient-to-b from-slate-900/90 to-transparent">
            <div>
              <div className="text-slate-400 text-sm">الملف الشخصي</div>
              <div className="text-2xl font-bold">{myPlayer?.name}</div>
              <div className={`mt-1 font-bold px-3 py-1 rounded inline-block ${myPlayer?.role === 'MAFIA' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
                {ROLES_AR[myPlayer?.role]}
              </div>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 top-8 px-6 py-2 bg-slate-800/80 backdrop-blur rounded-full border border-slate-600 font-bold shadow-lg">
              {phase.replace(/_/g, ' ')}
            </div>
          </div>

          {/* MAIN GRID */}
          <div className="pt-32 px-4 pb-32 grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
            {players.map(p => (
              <motion.div
                layout
                key={p.id}
                onClick={() => {
                  if (isMyTurn && p.isAlive) handleAction(p.id);
                }}
                className={`
                                  relative bg-slate-800 p-6 rounded-2xl flex flex-col items-center border-2 transition-all cursor-pointer
                                  ${!p.isAlive ? 'border-red-900 bg-red-950/20 opacity-50 grayscale' : 'border-slate-700'}
                                  ${isMyTurn && p.isAlive && p.id !== myPlayer?.id ? 'hover:border-purple-500 hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:scale-105' : ''}
                                  ${myPlayer?.id === p.id ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-slate-900' : ''}
                              `}
              >
                <div className="text-7xl mb-4">{p.isAlive ? p.avatar : '💀'}</div>
                <div className="font-bold text-center w-full truncate text-lg">{p.name}</div>

                {/* STATUS BADGES */}
                {!p.isAlive && <div className="absolute inset-0 flex items-center justify-center"><span className="text-red-600 font-black text-4xl -rotate-12 border-4 border-red-600 rounded-xl px-2 opacity-80">ميت</span></div>}

                {/* HOST KICK BUTTON */}
                {isHostDay && p.isAlive && p.id !== myPlayer?.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`هل أنت متأكد من طرد ${p.name}؟`)) {
                        hostAction('KICK', p.id);
                      }
                    }}
                    className="absolute -top-3 -right-3 bg-red-600 text-white w-10 h-10 rounded-full font-bold shadow-lg hover:bg-red-500 hover:scale-110 flex items-center justify-center z-10 border-2 border-slate-900"
                    title="طرد هذا اللاعب"
                  >
                    🔪
                  </button>
                )}
              </motion.div>
            ))}
          </div>

          {/* HOST CONTROLS */}
          {isHostDay && (
            <div className="fixed top-28 left-1/2 -translate-x-1/2 z-50 flex gap-4 w-full justify-center px-4">
              <div className="bg-slate-800/90 backdrop-blur p-4 rounded-2xl border border-red-500/30 flex items-center gap-6 shadow-2xl">
                <div className="flex flex-col">
                  <span className="text-red-400 font-bold text-lg">تحكم الهوست 👑</span>
                  <span className="text-slate-400 text-xs">اختر لاعب للقتل أو اضغط سكب</span>
                </div>
                <div className="h-10 w-px bg-slate-600"></div>
                <button
                  onClick={() => hostAction('SKIP')}
                  className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg text-lg transition-transform active:scale-95"
                >
                  سكب (تخطي) ⏭️
                </button>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          <AnimatePresence>
            {msg && (
              <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="fixed top-24 left-0 w-full flex justify-center z-50 pointer-events-none">
                <div className="bg-gradient-to-r from-orange-600 to-red-600 text-white px-8 py-3 rounded-2xl shadow-2xl font-bold text-xl border-t-2 border-orange-400">
                  {msg}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* INVESTIGATION POPUP */}
          {investigationResult && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-slate-800 p-10 rounded-3xl border border-slate-600 text-center shadow-2xl max-w-sm w-full">
                <div className="text-6xl mb-4">🕵️‍♂️</div>
                <h3 className="text-2xl font-bold mb-4 text-slate-200">نتيجة التحقيق</h3>
                <div className="text-3xl font-black bg-slate-900 p-6 rounded-xl border border-slate-700 mb-6">{investigationResult}</div>
                <button onClick={() => setInvestigationResult(null)} className="text-slate-400 hover:text-white underline">إغلاق</button>
              </div>
            </div>
          )}

          {/* NIGHT OVERLAY */}
          {isNight && !isMyTurn && myPlayer?.isAlive && (
            <div className="fixed inset-0 bg-black/95 z-30 flex flex-col items-center justify-center text-center p-8">
              <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.7, 0.3] }} transition={{ repeat: Infinity, duration: 4 }} className="text-9xl mb-8">🌑</motion.div>
              <h2 className="text-4xl text-slate-700 font-thin tracking-[0.5em] uppercase">المدينة نائمة</h2>
            </div>
          )}

          {/* FOOTER BAR */}
          <div className="fixed bottom-0 w-full bg-gradient-to-t from-slate-950 via-slate-900 to-transparent pt-32 pb-8 text-center z-30 pointer-events-none">
            {isMyTurn ?
              <div className="text-3xl font-black text-green-400 animate-pulse drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]">⚡ دورك الآن! ⚡</div> :
              isHostDay ?
                <div className="text-3xl font-black text-red-400 animate-pulse">🚨 قرار الهوست 🚨</div> :
                <div className="text-xl text-slate-500 font-bold">بانتظار الآخرين...</div>
            }
          </div>
        </>
      )}
    </div>
  );
}