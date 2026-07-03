const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
const $ = (id) => document.getElementById(id);
const canvas = $('field');
const ctx = canvas.getContext('2d');
let clientKey = localStorage.getItem('pbKey');
if (!clientKey) { clientKey = String(Date.now()) + Math.random(); localStorage.setItem('pbKey', clientKey); }

let ws, state, you = null, keys = {}, myTeam = 'spectators';
let lastRoom = '', lastRooms = '', lastPlayers = '', lastScore = '0:0', lastRunning = false;
let pending = false, audioCtx = null, musicOn = false, musicTimer = null, beat = 0, celebrationUntil = 0;

function txt(id, value) { const el = $(id); if (el && el.textContent !== String(value)) el.textContent = value; }
function show(view) { $('lobbyView').classList.toggle('active', view === 'lobby'); $('gameView').classList.toggle('active', view === 'game'); }
function log(message, cls = 'hint') { const el = $('msg'); if (!el) return; el.textContent = message; el.className = cls + ' share'; }
function send(message) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ ...message, clientKey })); }
function selectedDuration() { return Number(($('gameDuration')?.value || $('duration')?.value || 300)); }
function audio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); return audioCtx; }
function tone(freq, duration = 0.12, volume = 0.04, type = 'triangle') { const ac = audio(); const osc = ac.createOscillator(); const gain = ac.createGain(); osc.type = type; osc.frequency.value = freq; gain.gain.value = volume; osc.connect(gain); gain.connect(ac.destination); osc.start(); gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration); osc.stop(ac.currentTime + duration); }
function whistle() { tone(1300, 0.14, 0.07, 'sine'); setTimeout(() => tone(1800, 0.16, 0.06, 'sine'), 120); }
function cheer() { celebrationUntil = performance.now() + 1600; [523,659,784,988,784,659,988].forEach((n,i)=>setTimeout(()=>tone(n,.08,.04,'square'),i*55)); for(let i=0;i<10;i++)setTimeout(()=>tone(160+Math.random()*280,.05,.025,'sawtooth'),i*35); $('goalBanner').classList.remove('show'); void $('goalBanner').offsetWidth; $('goalBanner').classList.add('show'); }
function musicStep() { const notes=[392,494,587,494,440,523,659,523]; tone(notes[beat%notes.length],.12,.028,'triangle'); if(beat%4===0)tone(110,.08,.04,'sine'); beat++; }
function toggleMusic() { musicOn=!musicOn; txt('music',musicOn?'🎵 Music On':'🎵 Music Off'); if(musicOn){musicStep(); musicTimer=setInterval(musicStep,320);} else {clearInterval(musicTimer); musicTimer=null;} }

function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { txt('status','Connected'); send({ type:'list' }); };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      state = message.state; you = message.you;
      handleStateAudio(); roomUi(); roleUi(); roomsUi(message.rooms); scheduleDraw();
      if (state.room) show('game');
    }
    if (message.type === 'rooms') roomsUi(message.rooms);
    if (message.type === 'error') log(message.message, 'error');
  };
  ws.onclose = () => { txt('status','Disconnected - retrying'); setTimeout(connect,2000); };
}

function handleStateAudio() { const score = state.red + ':' + state.blue; if (score !== lastScore && lastScore !== '0:0') cheer(); lastScore = score; if (state.running && !lastRunning) whistle(); lastRunning = state.running; }
function roomUi() { if (!state || !state.room || state.room === lastRoom) return; lastRoom = state.room; lastPlayers = ''; txt('currentRoom','Current room: '+state.room); const link = location.origin + location.pathname + '?room=' + state.room; history.replaceState(null,'','?room='+state.room); log('Share this link with your players: '+link,'ok'); if ($('gameDuration')) $('gameDuration').value = String(state.limit || 300); }
function roleUi() { const host = Boolean(you && you.host), team = you && you.team ? you.team : 'not joined'; txt('roleBadge',(host?'Host • ':'Player • ')+team); txt('matchStatus',(state.status || (state.running?'running':'waiting')).toUpperCase()); const controls = $('hostControls'); if (controls) controls.classList.toggle('visible', host); ['start','pause','stop','reset'].forEach(id => { if ($(id)) $(id).disabled = !host; }); txt('hostHelp', host ? 'You are the host. Start, pause, stop and reset are enabled.' : 'Only the room creator can see and use match controls.'); }
function roomsUi(list) { const rooms=list||[]; const key=JSON.stringify(rooms.map(r=>[r.id,r.name,r.players,r.locked,r.running,r.status,r.limit,r.id===lastRoom])); if(key===lastRooms)return; lastRooms=key; $('rooms').innerHTML=rooms.map(room=>`<button type="button" class="roomCard ${room.id===lastRoom?'active':''}" data-room="${room.id}"><div class="roomName">${room.name}</div><div class="roomMeta">${room.id} • ${room.players}/22 ${room.locked?'🔒':''} • ${(room.status || (room.running?'LIVE':'Waiting')).toUpperCase()} • ${Math.floor((room.limit||300)/60)} min</div></button>`).join('')||'<p class="hint">No rooms yet. Create the first one.</p>'; document.querySelectorAll('.roomCard[data-room]').forEach(button=>button.addEventListener('click',()=>$('roomCode').value=button.dataset.room)); }
function playerName() { return $('name').value || 'Player ' + Math.floor(Math.random()*99); }
function createRoom() { myTeam = myTeam === 'spectators' ? 'red' : myTeam; send({ type:'create', name:$('roomName').value, playerName:playerName(), password:$('password').value, team:myTeam, duration:selectedDuration() }); }
function joinRoom() { const raw=$('roomCode').value.trim(); const room=(raw.match(/room=([A-Z0-9]+)/)||[])[1]||raw.toUpperCase(); send({ type:'join', room, playerName:playerName(), password:$('password').value, team:myTeam }); }
function mm(seconds) { return String(Math.floor(seconds/60)).padStart(2,'0') + ':' + String(Math.floor(seconds%60)).padStart(2,'0'); }
function remainingTime() { const limit = state?.limit || selectedDuration(); return Math.max(0, limit - (state?.time || 0)); }
function scheduleDraw(){ if(pending)return; pending=true; requestAnimationFrame(()=>{pending=false; draw();}); }

function drawCrowd(now){ const active=now<celebrationUntil; for(let side=0;side<2;side++){ for(let i=0;i<28;i++){ const x=35+i*33,y=side===0?32:528,b=active?Math.sin(now/70+i)*8:Math.sin(now/400+i)*2; ctx.beginPath(); ctx.fillStyle=i%2?'#ffd166':'#f7fbff'; ctx.arc(x,y+b,4,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#07111d'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-5,y+7+b); ctx.lineTo(x+5,y+7-b); ctx.stroke(); } } }
function drawField(){ const stripeW=70; for(let i=0;i<14;i++){ ctx.fillStyle=i%2?'#17753d':'#1c8446'; ctx.fillRect(i*stripeW,0,stripeW,560); } ctx.strokeStyle='#e9f7ef'; ctx.lineWidth=4; ctx.strokeRect(18,18,944,524); ctx.beginPath(); ctx.moveTo(490,18); ctx.lineTo(490,542); ctx.stroke(); ctx.beginPath(); ctx.arc(490,280,72,0,Math.PI*2); ctx.stroke(); ctx.strokeRect(18,205,90,150); ctx.strokeRect(872,205,90,150); ctx.fillStyle='#0b3a21'; ctx.fillRect(0,205,18,150); ctx.fillRect(962,205,18,150); }
function draw(){ if(!state)return; const now=performance.now(); ctx.clearRect(0,0,980,560); drawField(); drawCrowd(now); Object.values(state.players).forEach(player=>{ if(player.team==='spectators')return; ctx.beginPath(); ctx.shadowColor='#0008'; ctx.shadowBlur=8; ctx.fillStyle=player.team==='red'?'#ff5b5b':'#5ba4ff'; ctx.arc(player.x,player.y,15,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; if(you&&player.id===you.id){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();} ctx.fillStyle='white'; ctx.font='11px Arial'; ctx.textAlign='center'; ctx.fillText(player.name.slice(0,9),player.x,player.y-22); }); ctx.beginPath(); ctx.shadowColor='#0009'; ctx.shadowBlur=12; ctx.fillStyle='white'; ctx.arc(state.ball.x,state.ball.y,9,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; txt('redScore',state.red); txt('blueScore',state.blue); txt('timer',mm(remainingTime())); teamsUi(); }
function teamsUi(){ const players=Object.values(state.players); const key=JSON.stringify(players.map(p=>[p.id,p.name,p.team,p.host]).sort()); if(key===lastPlayers)return; lastPlayers=key; const label=(p,icon)=>icon+' '+p.name+(p.host?' ⭐':'')+(you&&p.id===you.id?' (you)':''); $('redList').innerHTML=players.filter(p=>p.team==='red').map(p=>label(p,'🔴')).join('<br>')||'<span class="hint">Empty</span>'; $('blueList').innerHTML=players.filter(p=>p.team==='blue').map(p=>label(p,'🔵')).join('<br>')||'<span class="hint">Empty</span>'; $('specList').innerHTML=players.filter(p=>p.team==='spectators').map(p=>label(p,'👀')).join('<br>')||'<span class="hint">Empty</span>'; }

$('music').addEventListener('click',toggleMusic); $('create').addEventListener('click',createRoom); $('join').addEventListener('click',joinRoom); $('refresh').addEventListener('click',()=>send({type:'list'})); $('backLobby').addEventListener('click',()=>{send({type:'list'}); show('lobby');}); $('start').addEventListener('click',()=>send({type:'control',action:'start',duration:selectedDuration()})); $('pause').addEventListener('click',()=>send({type:'control',action:'pause'})); $('stop').addEventListener('click',()=>send({type:'control',action:'stop'})); $('reset').addEventListener('click',()=>send({type:'control',action:'reset'})); $('redBtn').addEventListener('click',()=>{myTeam='red';send({type:'team',team:'red'});}); $('blueBtn').addEventListener('click',()=>{myTeam='blue';send({type:'team',team:'blue'});}); $('specBtn').addEventListener('click',()=>{myTeam='spectators';send({type:'team',team:'spectators'});});
addEventListener('keydown',event=>{keys[event.key.toLowerCase()]=true;if(event.code==='Space')event.preventDefault();}); addEventListener('keyup',event=>keys[event.key.toLowerCase()]=false); setInterval(()=>send({type:'input',up:keys.w||keys.arrowup,down:keys.s||keys.arrowdown,left:keys.a||keys.arrowleft,right:keys.d||keys.arrowright,kick:keys[' ']||keys.space}),33);
connect(); const q=new URLSearchParams(location.search); if(q.get('room'))$('roomCode').value=q.get('room');