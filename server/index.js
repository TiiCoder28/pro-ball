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
const clean = (value, fallback = '') => String(value || fallback).trim().slice(0, 32);

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

function stateMessage(room, ws) {
  const player = ws.playerId ? room.state.players[ws.playerId] : null;
  return {
    type: 'state',
    state: room.state,
    rooms: roomList(),
    field: FIELD,
    you: player ? { id: player.id, host: Boolean(player.host), team: player.team, room: room.id } : null
  };
}

function broadcast(room) {
  for (const client of room.clients) send(client, stateMessage(room, client));
}

function createRoom(name, password) {
  const id = code();
  const state = makeState();
  state.room = id;
  const room = {
    id,
    name: clean(name, `Room ${id}`),
    password: clean(password),
    state,
    clients: new Set(),
    clientKeys: new Map(),
    interval: null
  };
  rooms.set(id, room);
  return room;
}

function startLoop(room) {
  if (room.interval) return;
  room.interval = setInterval(() => {
    step(room.state);
    broadcast(room);
  }, 1000 / 30);
}

function closeEmptyRoom(room) {
  if (!room || room.clients.size > 0) return;
  clearInterval(room.interval);
  rooms.delete(room.id);
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room || !ws.playerId) return;
  delete room.state.players[ws.playerId];
  room.clients.delete(ws);
  if (ws.clientKey) room.clientKeys.delete(ws.clientKey);
  const hadHost = !Object.values(room.state.players).some((p) => p.host);
  const nextPlayer = Object.values(room.state.players)[0];
  if (hadHost && nextPlayer) nextPlayer.host = true;
  ws.room = null;
  ws.playerId = null;
  broadcast(room);
  closeEmptyRoom(room);
}

function assignTeam(player, team, room) {
  const safeTeam = ['red', 'blue', 'spectators'].includes(team) ? team : 'spectators';
  const count = Object.values(room.state.players).filter((p) => p.team === safeTeam).length;
  if (safeTeam === 'red' && count >= 11) return false;
  if (safeTeam === 'blue' && count >= 11) return false;
  player.team = safeTeam;
  if (safeTeam !== 'spectators') Object.assign(player, spawn(safeTeam, count));
  return true;
}

function joinRoom(ws, room, message, host = false) {
  const clientKey = clean(message.clientKey, `${Date.now()}-${Math.random()}`);
  const existing = room.clientKeys.get(clientKey);
  if (existing && existing !== ws) {
    send(existing, { type: 'error', message: 'You joined this room again from the same browser, so the older connection was removed.' });
    existing.close(4000, 'duplicate client');
  }

  if (Object.keys(room.state.players).length >= FIELD.maxPlayers) return send(ws, { type: 'error', message: 'Room is full' });

  const player = makePlayer(`${Date.now()}-${Math.random()}`, clean(message.playerName, 'Player'), 'spectators', host);
  assignTeam(player, message.team || 'spectators', room);
  room.state.players[player.id] = player;
  room.clients.add(ws);
  room.clientKeys.set(clientKey, ws);
  ws.room = room;
  ws.playerId = player.id;
  ws.clientKey = clientKey;
  startLoop(room);
  broadcast(room);
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.playerId = null;
  ws.clientKey = null;
  send(ws, { type: 'rooms', rooms: roomList() });

  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.type === 'list') return send(ws, { type: 'rooms', rooms: roomList() });

    if (message.type === 'create') {
      leaveRoom(ws);
      const room = createRoom(message.name, message.password);
      joinRoom(ws, room, message, true);
      return;
    }

    if (message.type === 'join') {
      const room = rooms.get(String(message.room || '').toUpperCase());
      if (!room) return send(ws, { type: 'error', message: 'Room not found' });
      if (room.password && room.password !== clean(message.password)) return send(ws, { type: 'error', message: 'Wrong password' });
      leaveRoom(ws);
      joinRoom(ws, room, message, false);
      return;
    }

    const room = ws.room;
    const me = room && ws.playerId ? room.state.players[ws.playerId] : null;
    if (!room || !me) return;

    if (message.type === 'input') {
      Object.assign(me, {
        up: Boolean(message.up),
        down: Boolean(message.down),
        left: Boolean(message.left),
        right: Boolean(message.right),
        kick: Boolean(message.kick)
      });
      return;
    }

    if (message.type === 'team') {
      if (!assignTeam(me, message.team, room)) return send(ws, { type: 'error', message: 'That team is full' });
      broadcast(room);
      return;
    }

    if (message.type === 'control') {
      if (!me.host) return send(ws, { type: 'error', message: 'Only the room host can use those controls.' });
      if (message.action === 'start') room.state.running = true;
      if (message.action === 'pause') room.state.running = false;
      if (message.action === 'reset') {
        room.state.red = 0;
        room.state.blue = 0;
        room.state.time = 0;
        resetPositions(room.state);
      }
      broadcast(room);
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

server.listen(port, '0.0.0.0', () => console.log(`Pro Ball server running on http://localhost:${port}`));
