import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { FIELD, makePlayer, makeState, spawn, step, resetPositions } from './physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');
const port = process.env.PORT || 3000;
const rooms = new Map();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = path.normalize(requested).replace(/^\.\.(\/|\\|$)/, '');
    const filePath = path.join(publicDir, safePath);
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
    res.end(data);
  } catch {
    const data = await readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const roomList = () => [...rooms.entries()].map(([id, room]) => ({
  id,
  name: room.name,
  players: Object.keys(room.state.players).length,
  locked: Boolean(room.password),
  running: room.state.running
}));

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  const payload = JSON.stringify(message);
  for (const client of room.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function stateMessage(room) {
  return { type: 'state', state: room.state, rooms: roomList(), field: FIELD };
}

function createRoom(name, password) {
  const id = code();
  const state = makeState();
  state.room = id;
  const room = { id, name: name || `Room ${id}`, password: password || '', state, clients: new Set(), interval: null };
  rooms.set(id, room);
  return room;
}

function startLoop(room) {
  if (room.interval) return;
  room.interval = setInterval(() => {
    step(room.state);
    broadcast(room, stateMessage(room));
  }, 1000 / 30);
}

function closeEmptyRoom(room) {
  if (room.clients.size > 0) return;
  clearInterval(room.interval);
  rooms.delete(room.id);
}

function assignTeam(player, team, room) {
  const safeTeam = ['red', 'blue', 'spectators'].includes(team) ? team : 'spectators';
  const count = Object.values(room.state.players).filter((p) => p.team === safeTeam).length;
  if (safeTeam === 'red' && count >= 11) return false;
  if (safeTeam === 'blue' && count >= 11) return false;
  player.team = safeTeam;
  Object.assign(player, spawn(safeTeam, count));
  return true;
}

wss.on('connection', (ws) => {
  let room = null;
  let me = null;
  send(ws, { type: 'rooms', rooms: roomList() });

  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.type === 'list') return send(ws, { type: 'rooms', rooms: roomList() });

    if (message.type === 'create') {
      room = createRoom(message.name, message.password);
      me = makePlayer(`${Date.now()}-${Math.random()}`, String(message.playerName || 'Player'), 'spectators', true);
      assignTeam(me, message.team || 'spectators', room);
      room.state.players[me.id] = me;
      room.clients.add(ws);
      startLoop(room);
      broadcast(room, stateMessage(room));
      return;
    }

    if (message.type === 'join') {
      room = rooms.get(String(message.room || '').toUpperCase());
      if (!room) return send(ws, { type: 'error', message: 'Room not found' });
      if (room.password && room.password !== message.password) return send(ws, { type: 'error', message: 'Wrong password' });
      if (Object.keys(room.state.players).length >= FIELD.maxPlayers) return send(ws, { type: 'error', message: 'Room is full' });
      me = makePlayer(`${Date.now()}-${Math.random()}`, String(message.playerName || 'Player'), 'spectators', false);
      assignTeam(me, message.team || 'spectators', room);
      room.state.players[me.id] = me;
      room.clients.add(ws);
      startLoop(room);
      broadcast(room, stateMessage(room));
      return;
    }

    if (!room || !me) return;

    if (message.type === 'input') {
      Object.assign(me, { up: Boolean(message.up), down: Boolean(message.down), left: Boolean(message.left), right: Boolean(message.right), kick: Boolean(message.kick) });
    }

    if (message.type === 'team') {
      if (!assignTeam(me, message.team, room)) return send(ws, { type: 'error', message: 'That team is full' });
      broadcast(room, stateMessage(room));
    }

    if (message.type === 'control' && me.host) {
      if (message.action === 'start') room.state.running = true;
      if (message.action === 'pause') room.state.running = false;
      if (message.action === 'reset') {
        room.state.red = 0;
        room.state.blue = 0;
        room.state.time = 0;
        resetPositions(room.state);
      }
      broadcast(room, stateMessage(room));
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    delete room.state.players[me.id];
    room.clients.delete(ws);
    broadcast(room, stateMessage(room));
    closeEmptyRoom(room);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`Pro Ball server running on http://localhost:${port}`));
