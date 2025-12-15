import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { motion, AnimatePresence } from 'framer-motion';

// الاتصال بالسيرفر
const socket = io('https://mafia-game-dpfv.onrender.com');

// مكتبة الأصوات (تأكد من وجود ملفات الصوت لاحقاً أو استبدلها بروابط)
const sounds = {
  everyone_sleep: new Howl({ src: ['/sounds/sleep.mp3'] }),
  mafia_wake: new Howl({ src: ['/sounds/mafia.mp3'] }),
  nurse_wake: new Howl({ src: ['/sounds/nurse.mp3'] }),
  detective_wake: new Howl({ src: ['/sounds/detective.mp3'] }),
  everyone_wake: new Howl({ src: ['/sounds/wake.mp3'] }),
  result_success: new Howl({ src: ['/sounds/kill.mp3'] }),
  result_fail: new Howl({ src: ['/sounds/safe.mp3'] })
};

export default function App() {
  const [view, setView] = useState('LOGIN'); // LOGIN, LOBBY, GAME
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [phase, setPhase] = useState('LOBBY');
  const [timer, setTimer] = useState(0);
  const [msg, setMsg] = useState('');
  const [investigation, setInvestigation] = useState(null);

  useEffect(() => {
    socket.on('room_created', (id) => {
      setRoomId(id);
      setView('LOBBY');
    });

    socket.on('update_players', (list) => {
      setPlayers(list);
      const me = list.find(p => p.id === socket.id);
      if (me) setMyPlayer(me);
    });

    socket.on('game_state_update', ({ phase }) => {
      setPhase(phase);
      if (phase !== 'LOBBY') setView('GAME');
    });

    socket.on('game_started', (list) => {
      setPlayers(list);
      const me = list.find(p => p.id === socket.id);
      if (me) setMyPlayer(me);
      setView('GAME');
    });

    socket.on('phase_change', (newPhase) => {
      setPhase(newPhase);
      setInvestigation(null); // تصفية نتيجة التحقيق
    });

    socket.on('play_audio', (key) => {
      if (sounds[key]) sounds[key].play();
    });

    socket.on('day_result', ({ msg, players }) => {
      setMsg(msg);
      setPlayers(players);
      setTimeout(() => setMsg(''), 5000);
    });

    socket.on('timer_update', (t) => setTimer(t));

    socket.on('investigation_result', (res) => setInvestigation(res));

    socket.on('game_over', (winner) => {
      setPhase('GAME_OVER');
      setMsg(winner === 'MAFIA' ? 'انتصرت المافيا!' : 'انتصر المواطنون!');
    });

    return () => socket.off();
  }, []);

  const createRoom = () => {
    if (!name) return alert('اكتب اسمك أولاً');
    socket.emit('create_room', { playerName: name });
  };

  const joinRoom = () => {
    if (!name || !roomId) return alert('البيانات ناقصة');
    socket.emit('join_room', { roomId, playerName: name });
    setView('LOBBY');
  };

  const startGame = () => {
    socket.emit('start_game', { roomId });
  };

  const sendAction = (targetId) => {
    if (!myPlayer.isAlive) return;
    if (phase === 'DAY_VOTING') {
      socket.emit('vote_player', { roomId, targetId });
    } else {
      socket.emit('player_action', { roomId, action: 'USE_ABILITY', targetId });
    }
  };

  // --- شاشات اللعبة ---

  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <h1 className="text-4xl font-bold mb-8 text-red-500 tracking-wider">MAFIA ONLINE</h1>
        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
          <input
            className="w-full p-3 mb-4 rounded bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="أدخل اسمك"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button onClick={createRoom} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded mb-3 transition">إنشاء غرفة جديدة</button>

          <div className="flex gap-2">
            <input
              className="flex-1 p-3 rounded bg-slate-700 text-white placeholder-slate-400"
              placeholder="رمز الغرفة"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
            />
            <button onClick={joinRoom} className="bg-blue-600 hover:bg-blue-700 px-6 rounded font-bold transition">دخول</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'LOBBY') {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-lg">
            <h2 className="text-xl">رمز الغرفة: <span className="text-green-400 font-mono text-2xl tracking-widest">{roomId}</span></h2>
            <div className="bg-blue-900 px-3 py-1 rounded-full text-sm">اللاعبون: {players.length}</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            {players.map(p => (
              <div key={p.id} className="bg-slate-800 p-4 rounded border border-slate-700 flex flex-col items-center">
                <div className="w-12 h-12 bg-slate-600 rounded-full mb-2 flex items-center justify-center text-xl">👤</div>
                <span className="font-bold">{p.name}</span>
                {p.isHost && <span className="text-xs text-yellow-400 mt-1">HOST</span>}
              </div>
            ))}
          </div>

          {myPlayer?.isHost && (
            <button onClick={startGame} className="w-full bg-green-600 hover:bg-green-700 py-4 rounded-xl text-xl font-bold shadow-lg transform active:scale-95 transition">
              ابدأ اللعبة 🎮
            </button>
          )}
          {!myPlayer?.isHost && <p className="text-center text-slate-400 animate-pulse">في انتظار الهوست لبدء اللعبة...</p>}
        </div>
      </div>
    );
  }

  // --- داخل اللعبة ---

  const isNight = phase.includes('NIGHT');
  const myTurn = (phase === 'NIGHT_MAFIA' && myPlayer.role === 'MAFIA') ||
    (phase === 'NIGHT_NURSE' && myPlayer.role === 'DOCTOR') ||
    (phase === 'NIGHT_DETECTIVE' && myPlayer.role === 'DETECTIVE') ||
    phase === 'DAY_VOTING';

  return (
    <div className={`min-h-screen transition-colors duration-1000 ${isNight ? 'bg-black text-slate-300' : 'bg-sky-100 text-slate-800'}`}>

      {/* شاشة المعلومات العلوية */}
      <div className={`p-4 shadow-md ${isNight ? 'bg-slate-900' : 'bg-white'} flex justify-between items-center sticky top-0 z-10`}>
        <div>
          <h2 className="text-lg font-bold">أنت: <span className="text-blue-500">{myPlayer.name}</span></h2>
          <p className="text-sm opacity-75">الدور: {myPlayer.role}</p>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold">{phase.replace(/_/g, ' ')}</div>
          {timer > 0 && <div className="text-red-500 font-mono text-2xl">{timer}s</div>}
        </div>
      </div>

      {/* رسائل النظام */}
      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-20 left-0 right-0 z-50 flex justify-center"
          >
            <div className="bg-yellow-500 text-black px-6 py-3 rounded-full font-bold shadow-xl border-2 border-black">
              {msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* منطقة اللعب */}
      <div className="p-4 max-w-4xl mx-auto mt-4">

        {/* شاشة الليل المظلمة لغير أصحاب الدور */}
        {isNight && !myTurn && myPlayer.isAlive && (
          <div className="fixed inset-0 bg-black z-40 flex flex-col items-center justify-center">
            <div className="text-6xl mb-4">😴</div>
            <h2 className="text-2xl text-slate-500">المدينة نائمة...</h2>
          </div>
        )}

        {/* نتيجة التحقيق للشايب */}
        {investigation && (
          <div className="bg-purple-900 text-white p-4 rounded mb-4 text-center border-2 border-purple-500 animate-bounce">
            🕵️‍♂️ نتيجة التحقيق: {investigation}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {players.map(p => (
            <div
              key={p.id}
              onClick={() => sendAction(p.id)}
              className={`
                        relative p-4 rounded-xl border-2 transition-all cursor-pointer
                        ${!p.isAlive ? 'bg-red-900 opacity-50 grayscale' : isNight ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}
                        ${myTurn && p.isAlive && p.id !== myPlayer.id ? 'hover:border-yellow-400 hover:scale-105' : ''}
                        ${phase === 'DAY_VOTING' && 'hover:bg-red-50'}
                    `}
            >
              <div className="text-4xl text-center mb-2">{p.isAlive ? (p.avatar < 5 ? '👨' : '👩') : '💀'}</div>
              <div className="text-center font-bold">{p.name}</div>
              {!p.isAlive && <div className="absolute inset-0 flex items-center justify-center text-red-500 font-bold text-2xl rotate-12 border-4 border-red-500 rounded-xl">ميت</div>}
            </div>
          ))}
        </div>
      </div>

      {/* شريط الحالة السفلي */}
      <div className={`fixed bottom-0 w-full p-4 text-center ${isNight ? 'bg-slate-900 text-slate-400' : 'bg-white text-slate-600'} border-t`}>
        {myPlayer.isAlive ?
          (myTurn ? <span className="text-green-500 font-bold text-xl animate-pulse">⚡ دورك الآن! اختر لاعباً</span> : "انتظر دورك...")
          : <span className="text-red-500">أنت ميت، يمكنك المشاهدة فقط 👻</span>
        }
      </div>

    </div>
  );
}