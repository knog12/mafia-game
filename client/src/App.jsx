import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Howl } from 'howler';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

// **مهم:** ضع رابط سيرفرك هنا
const socket = io('https://mafia-game-dpfv.onrender.com');

// مكتبة الأصوات
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
  // بيانات أساسية
  const [playerId, setPlayerId] = useState(localStorage.getItem('mafia_playerId') || '');
  const [name, setName] = useState(localStorage.getItem('mafia_playerName') || '');

  // حالة اللعبة
  const [view, setView] = useState('LOGIN');
  const [roomId, setRoomId] = useState('');
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [phase, setPhase] = useState('LOBBY');
  const [msg, setMsg] = useState('');
  const [investigation, setInvestigation] = useState(null);

  // حالة قائمة الآدمن
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  useEffect(() => {
    // 1. إعداد الـ UUID للاعب عند البدء
    let storedId = localStorage.getItem('mafia_playerId');
    if (!storedId) {
      storedId = uuidv4();
      localStorage.setItem('mafia_playerId', storedId);
    }
    setPlayerId(storedId);

    // 2. محاولة إعادة الاتصال التلقائية
    const savedRoom = localStorage.getItem('mafia_savedRoom');
    if (savedRoom && storedId && name) {
      console.log('Attempting auto-reconnect:', { savedRoom, name, storedId });
      setRoomId(savedRoom);
      socket.emit('join_room', { roomId: savedRoom, playerName: name, playerId: storedId });
    }

    socket.on('room_created', (id) => {
      setRoomId(id);
      localStorage.setItem('mafia_savedRoom', id);
      setView('LOBBY');
    });

    // **إصلاح مشكلة الدخول**: الانتقال للوبي عند نجاح الانضمام
    socket.on('joined_room', (id) => {
      setRoomId(id);
      localStorage.setItem('mafia_savedRoom', id);
      setView('LOBBY');
    });

    socket.on('update_players', (list) => {
      setPlayers(list);
      // البحث عن نفسي باستخدام playerId الثابت
      const me = list.find(p => p.id === storedId);
      if (me) setMyPlayer(me);
    });

    socket.on('player_reconnected', ({ player, players }) => {
      console.log('Successfully reconnected!');
      setMyPlayer(player);
      setPlayers(players);
      setView(player.phase === 'LOBBY' ? 'LOBBY' : 'GAME');
      if (player.phase !== 'LOBBY') setPhase(player.phase || 'GAME');
    });

    socket.on('game_state_update', ({ phase }) => {
      setPhase(phase);
      if (phase !== 'LOBBY') setView('GAME');
    });

    socket.on('game_started', (list) => {
      setPlayers(list);
      const me = list.find(p => p.id === storedId);
      if (me) setMyPlayer(me);
      setView('GAME');
    });

    socket.on('phase_change', (newPhase) => {
      setPhase(newPhase);
      setInvestigation(null);
    });

    socket.on('play_audio', (key) => {
      if (sounds[key]) sounds[key].play();
    });

    socket.on('day_result', ({ msg, players }) => {
      setMsg(msg);
      setPlayers(players);
      setTimeout(() => setMsg(''), 5000);
    });

    socket.on('game_message', (msg) => {
      setMsg(msg);
      setTimeout(() => setMsg(''), 5000);
    });

    socket.on('investigation_result', (res) => setInvestigation(res));

    socket.on('force_disconnect', () => {
      alert('تم طردك من الغرفة من قبل الهوست.');
      setView('LOGIN');
      setRoomId('');
      localStorage.removeItem('mafia_savedRoom');
    });

    socket.on('game_over', (winner) => {
      setPhase('GAME_OVER');
      setMsg(winner === 'MAFIA' ? 'انتصرت المافيا!' : 'انتصر المواطنون!');
    });

    socket.on('error', (err) => {
      console.error('Socket Error:', err);
      if (err === 'الغرفة غير موجودة' || err.includes('اللعبة بدأت')) {
        localStorage.removeItem('mafia_savedRoom');
        setView('LOGIN');
      }
      alert(err);
    });

    return () => socket.off();
  }, [playerId, name]);

  const handleNameChange = (e) => {
    const newName = e.target.value;
    setName(newName);
    localStorage.setItem('mafia_playerName', newName);
  };

  const createRoom = () => {
    if (!name) return alert('اكتب اسمك أولاً');
    socket.emit('create_room', { playerName: name, playerId });
  };

  const joinRoom = () => {
    if (!name || !roomId) return alert('البيانات ناقصة');
    socket.emit('join_room', { roomId, playerName: name, playerId });
  };

  const startGame = () => {
    if (players.length < 3) return alert('يجب أن يكون الحد الأدنى 3 لاعبين!');
    socket.emit('start_game', { roomId });
  };

  const sendAction = (targetId) => {
    if (!myPlayer || !myPlayer.isAlive) return;
    socket.emit('player_action', { roomId, action: 'USE_ABILITY', targetId });
  };

  const hostDayAction = (action, targetId = null) => {
    socket.emit('host_action_day', { roomId, action, targetId });
  };

  const adminKick = (targetId) => {
    if (confirm('هل أنت متأكد من طرد هذا اللاعب نهائياً من الغرفة؟')) {
      socket.emit('admin_kick_player', { roomId, targetId });
    }
  };

  // --- الرندر ---

  // 1. شاشة الدخول (تصميم الحوش)
  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen bg-[#111827] flex flex-col items-center justify-center p-4 font-sans dir-rtl">
        {/* العنوان */}
        <h1 className="text-6xl font-extrabold mb-12 text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 drop-shadow-lg tracking-wide">
          الحوش
        </h1>

        <div className="bg-[#1f2937] p-8 rounded-2xl shadow-2xl w-full max-w-md border border-[#374151]">

          <div className="mb-6">
            <label className="block text-slate-400 mb-2 text-right">أسمك:</label>
            <input
              className="w-full p-4 rounded-xl bg-[#374151] text-white placeholder-slate-500 text-center focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all border border-slate-600"
              placeholder="اكتب اسمك هنا"
              value={name}
              onChange={handleNameChange}
            />
          </div>

          <button
            onClick={createRoom}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold py-4 rounded-xl mb-6 shadow-lg transform transition active:scale-95 flex justify-center items-center gap-2"
          >
            إنشاء لعبة جديدة 🎮
          </button>

          <div className="w-full h-px bg-slate-600 mb-6"></div>

          <div className="flex gap-3">
            <input
              className="flex-1 p-4 rounded-xl bg-[#374151] text-white placeholder-slate-500 text-center border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono tracking-widest"
              placeholder="CODE"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
            />
            <button
              onClick={joinRoom}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 rounded-xl font-bold py-4 shadow-lg transition active:scale-95"
            >
              دخول
            </button>
          </div>

        </div>

        <p className="mt-8 text-slate-500 text-sm">Mafia Game &copy; 2025</p>
      </div>
    );
  }

  // 2. اللوبي
  if (view === 'LOBBY') {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-4">
        <div className="max-w-2xl mx-auto">
          {myPlayer?.isHost && (
            <div className="absolute top-4 left-4 z-50">
              <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-slate-700 p-2 rounded text-2xl">☰</button>
              {showAdminMenu && (
                <div className="absolute left-0 mt-2 w-64 bg-slate-800 rounded shadow-xl border border-slate-600">
                  <h4 className="p-2 border-b border-slate-600 font-bold text-red-400">طرد اللاعبين (Admin)</h4>
                  {players.filter(p => p.id !== myPlayer.id).map(p => (
                    <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-700">
                      <span>{p.name} {p.avatar}</span>
                      <button onClick={() => adminKick(p.id)} className="text-red-500 text-sm border border-red-500 px-2 py-1 rounded hover:bg-red-900">طرد</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-lg mt-12 border border-slate-700">
            <h2 className="text-xl">رمز الغرفة: <span className="text-green-400 font-mono text-2xl tracking-widest">{roomId}</span></h2>
            <div className="bg-blue-900 px-3 py-1 rounded-full text-sm">اللاعبون: {players.length}</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            {players.map(p => (
              <div key={p.id} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col items-center shadow-md">
                <div className="text-5xl mb-3">{p.avatar}</div>
                <div className="font-bold text-lg">{p.name}</div>
                {p.isHost && <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded mt-1 border border-yellow-500/50">Leader</span>}
              </div>
            ))}
          </div>

          {myPlayer?.isHost && (
            <button onClick={startGame} className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 py-4 rounded-xl text-xl font-bold shadow-lg transform active:scale-95 transition">
              ابدأ اللعبة 🎮
            </button>
          )}
          {!myPlayer?.isHost && <div className="text-center p-8 bg-slate-800/50 rounded-xl border border-slate-700 animate-pulse text-slate-400">في انتظار الهوست لبدء اللعبة...</div>}
        </div>
      </div>
    );
  }

  // 3. اللعبة
  const isNight = phase.includes('NIGHT');
  const myNightTurn = (phase === 'NIGHT_MAFIA' && myPlayer.role === 'MAFIA') ||
    (phase === 'NIGHT_NURSE' && myPlayer.role === 'DOCTOR') ||
    (phase === 'NIGHT_DETECTIVE' && myPlayer.role === 'DETECTIVE');

  const isDayDiscussion = phase === 'DAY_DISCUSSION';
  const myHostTurn = isDayDiscussion && myPlayer.isHost;

  return (
    <div className={`min-h-screen transition-colors duration-1000 ${isNight ? 'bg-black text-slate-300' : 'bg-sky-100 text-slate-800'}`}>

      {/* Admin Menu in Game */}
      {myPlayer?.isHost && (
        <div className="absolute top-20 left-4 z-50">
          <button onClick={() => setShowAdminMenu(!showAdminMenu)} className="bg-black/50 p-2 rounded text-xl text-white">☰</button>
          {showAdminMenu && (
            <div className="absolute left-0 mt-2 w-64 bg-slate-900 text-white rounded shadow-xl border border-slate-600">
              <h4 className="p-2 border-b border-slate-600 font-bold text-red-400">إدارة اللاعبين</h4>
              {players.filter(p => p.id !== myPlayer.id).map(p => (
                <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-800">
                  <span>{p.name}</span>
                  <button onClick={() => adminKick(p.id)} className="text-red-500 text-xs border border-red-500 px-2 py-1 rounded">طرد</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`p-4 shadow-md ${isNight ? 'bg-slate-900' : 'bg-white'} flex justify-between items-center sticky top-0 z-10`}>
        <div>
          <h2 className="text-lg font-bold">أنت: <span className="text-blue-500">{myPlayer.name}</span></h2>
          <p className="text-sm opacity-75">الدور: {myPlayer.role}</p>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold">{phase.replace(/_/g, ' ')}</div>
        </div>
      </div>

      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-24 left-0 right-0 z-50 flex justify-center"
          >
            <div className="bg-yellow-500 text-black px-6 py-3 rounded-full font-bold shadow-xl border-2 border-black">
              {msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4 max-w-4xl mx-auto mt-4 pb-20">

        {isNight && !myNightTurn && myPlayer.isAlive && (
          <div className="fixed inset-0 bg-black z-40 flex flex-col items-center justify-center">
            <div className="text-6xl mb-4">😴</div>
            <h2 className="text-2xl text-slate-500">المدينة نائمة...</h2>
          </div>
        )}

        {investigation && (
          <div className="bg-purple-900 text-white p-4 rounded mb-4 text-center border-2 border-purple-500 animate-bounce">
            🕵️‍♂️ نتيجة التحقيق: {investigation}
          </div>
        )}

        {isDayDiscussion && myPlayer.isHost && (
          <div className="bg-slate-800 text-white p-4 rounded-xl mb-6 border-2 border-red-500 shadow-lg">
            <h3 className="text-center text-xl font-bold mb-4 text-red-400">💀 تحكم الهوست (النهار) 💀</h3>
            <p className="text-center text-sm mb-4 text-slate-300">أنت الحكم. اضغط على أي لاعب لطرده، أو اضغط زر التخطي.</p>

            <button
              onClick={() => hostDayAction('SKIP')}
              className="w-full bg-green-600 hover:bg-green-700 py-3 rounded font-bold text-lg mb-2"
            >
              تخطي اليوم (لا أحد يموت) ⏭️
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {players.map(p => (
            <div
              key={p.id}
              onClick={() => {
                if (myNightTurn) sendAction(p.id);
                if (myHostTurn && p.isAlive) {
                  if (confirm(`هل تريد طرد ${p.name}؟`)) hostDayAction('KICK', p.id);
                }
              }}
              className={`
                relative p-4 rounded-xl border-2 transition-all cursor-pointer
                ${!p.isAlive ? 'bg-red-900 opacity-50 grayscale' : isNight ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}
                ${(myNightTurn || myHostTurn) && p.isAlive && p.id !== myPlayer.id ? 'hover:border-yellow-400 hover:scale-105' : ''}
              `}
            >
              <div className="text-5xl text-center mb-2">{p.isAlive ? p.avatar : '💀'}</div>
              <div className="text-center font-bold">{p.name}</div>
              {!p.isAlive && <div className="absolute inset-0 flex items-center justify-center text-red-500 font-bold text-2xl rotate-12 border-4 border-red-500 rounded-xl">ميت</div>}

              {myHostTurn && p.isAlive && (
                <div className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 text-xs shadow-sm">
                  ❌ طرد
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={`fixed bottom-0 w-full p-4 text-center ${isNight ? 'bg-slate-900 text-slate-400' : 'bg-white text-slate-600'} border-t`}>
        {myPlayer.isAlive ?
          (myNightTurn ? <span className="text-green-500 font-bold text-xl animate-pulse">⚡ دورك الآن! اختر لاعباً</span> :
            myHostTurn ? <span className="text-red-600 font-bold text-xl animate-pulse">🚨 قرارك يا هوست: اطرد أو تخطى</span> :
              "انتظر دورك...")
          : <span className="text-red-500">أنت ميت، يمكنك المشاهدة فقط 👻</span>
        }
      </div>

    </div>
  );
}