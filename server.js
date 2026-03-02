const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const { createId, sha256, now } = require('./lib/helpers');
const {
  bootstrapAdmin,
  getUserById,
  getUserByUsername,
  createUser,
  touchUser,
  deathLockReason,
  markDead,
  awardCard,
  leaderboard,
  resetUserDeath,
} = require('./lib/storage');
const { createSession, getView, submit, tick } = require('./lib/engines');

const PORT = process.env.PORT || 3100;
const JWT_SECRET = process.env.JWT_SECRET || 'borderland-local-secret';
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gamesCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared', 'gameCatalog.json'), 'utf-8'));
const rulebookMarkdown = fs.readFileSync(path.join(__dirname, 'docs', 'GAME_RULEBOOK.md'), 'utf-8');

bootstrapAdmin();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const userRoomIndex = new Map();
const socketContext = new Map();

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function findGame(cardCode) {
  return gamesCatalog.find((game) => game.code === cardCode) || gamesCatalog[0];
}

function hashIp(reqOrSocket) {
  const raw = reqOrSocket.headers?.['x-forwarded-for']
    || reqOrSocket.handshake?.headers?.['x-forwarded-for']
    || reqOrSocket.socket?.remoteAddress
    || reqOrSocket.handshake?.address
    || '';
  return raw ? sha256(raw) : '';
}

function makeFingerprint({ ipHash, deviceId, userAgent, walletAddress }) {
  return sha256([ipHash, deviceId || '', userAgent || '', walletAddress || ''].join('|'));
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: '인증이 필요합니다.' });
  const user = getUserById(payload.sub);
  if (!user) return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
  req.user = user;
  next();
}

function roomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    cardCode: room.cardCode,
    cardName: findGame(room.cardCode)?.name,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      username: player.username,
      ready: !!player.ready,
      isBot: !!player.isBot,
      connected: !!player.connected,
    })),
    minPlayers: findGame(room.cardCode).players.min,
    maxPlayers: findGame(room.cardCode).players.max,
  };
}

function buildRoomSnapshot(room, viewerId) {
  const sessionView = room.session ? getView(room.session, viewerId) : null;
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    cardCode: room.cardCode,
    card: findGame(room.cardCode),
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      username: player.username,
      ready: !!player.ready,
      alive: player.alive !== false,
      isBot: !!player.isBot,
      connected: !!player.connected,
    })),
    chat: room.chat.slice(-50),
    session: sessionView,
  };
}

function emitRooms() {
  io.emit('rooms:update', Array.from(rooms.values()).map(roomSummary));
}

function emitRoom(room) {
  room.players.forEach((player) => {
    if (player.socketId) {
      io.to(player.socketId).emit('room:update', buildRoomSnapshot(room, player.id));
    }
  });
  emitRooms();
}

function addSystemMessage(room, text) {
  room.chat.push({ id: createId('msg'), user: 'SYSTEM', text, at: now(), system: true });
  if (room.chat.length > 200) room.chat.shift();
}

function createRoom({ owner, cardCode, name, addBots = 0 }) {
  const game = findGame(cardCode);
  const room = {
    id: createId('room'),
    name: name || `${game.code} - ${game.name}`,
    hostId: owner.id,
    cardCode: game.code,
    status: 'waiting',
    players: [{
      id: owner.id,
      username: owner.username,
      socketId: owner.socketId,
      ready: false,
      alive: true,
      isBot: false,
      connected: true,
      ipHash: owner.ipHash,
      fingerprint: owner.fingerprint,
      walletAddress: owner.walletAddress || '',
    }],
    chat: [],
    session: null,
    processedResult: false,
  };
  rooms.set(room.id, room);
  userRoomIndex.set(owner.id, room.id);
  if (addBots > 0) fillBots(room, addBots);
  addSystemMessage(room, `${owner.username} 님이 방을 만들었습니다.`);
  emitRoom(room);
  return room;
}

function fillBots(room, desiredCount) {
  const game = findGame(room.cardCode);
  const needed = Math.min(desiredCount, game.players.max - room.players.length);
  for (let i = 0; i < needed; i += 1) {
    room.players.push({
      id: createId('bot'),
      username: `BOT-${Math.floor(Math.random() * 900 + 100)}`,
      socketId: null,
      ready: true,
      alive: true,
      isBot: true,
      connected: true,
      ipHash: '',
      fingerprint: '',
      walletAddress: '',
    });
  }
}

function removeUserFromRoom(userId) {
  const roomId = userRoomIndex.get(userId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) {
    userRoomIndex.delete(userId);
    return;
  }
  room.players = room.players.filter((player) => player.id !== userId);
  userRoomIndex.delete(userId);
  addSystemMessage(room, `${userId} 퇴장`);
  if (!room.players.length) {
    rooms.delete(room.id);
  } else {
    if (room.hostId === userId) room.hostId = room.players[0].id;
    emitRoom(room);
  }
}

function joinRoom(roomId, ctx) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방이 존재하지 않습니다.');
  if (userRoomIndex.has(ctx.user.id)) {
    const currentRoomId = userRoomIndex.get(ctx.user.id);
    if (currentRoomId !== roomId) removeUserFromRoom(ctx.user.id);
  }
  const game = findGame(room.cardCode);
  if (room.players.length >= game.players.max) throw new Error('방이 가득 찼습니다.');
  let player = room.players.find((item) => item.id === ctx.user.id);
  if (!player) {
    player = {
      id: ctx.user.id,
      username: ctx.user.username,
      socketId: ctx.socket.id,
      ready: false,
      alive: true,
      isBot: false,
      connected: true,
      ipHash: ctx.ipHash,
      fingerprint: ctx.fingerprint,
      walletAddress: ctx.user.walletAddress || '',
    };
    room.players.push(player);
    addSystemMessage(room, `${ctx.user.username} 입장`);
  } else {
    player.socketId = ctx.socket.id;
    player.connected = true;
  }
  userRoomIndex.set(ctx.user.id, room.id);
  emitRoom(room);
  return room;
}

function updateRoomPlayerSocket(room, userId, socketId, connected) {
  const player = room.players.find((p) => p.id === userId);
  if (player) {
    player.socketId = socketId;
    player.connected = connected;
  }
}

function canStartRoom(room, requesterId) {
  if (room.hostId !== requesterId) return '방장만 시작할 수 있습니다.';
  const game = findGame(room.cardCode);
  if (room.players.length < game.players.min) return `최소 ${game.players.min}명이 필요합니다.`;
  const notReady = room.players.filter((player) => !player.isBot && !player.ready && player.id !== requesterId);
  if (notReady.length) return '모든 플레이어가 준비 상태여야 합니다.';
  return null;
}

function startRoom(room) {
  const game = findGame(room.cardCode);
  room.status = 'running';
  room.players.forEach((player) => { player.ready = false; player.alive = true; });
  room.session = createSession(game, room.players.map((player) => ({
    id: player.id,
    username: player.username,
    isBot: player.isBot,
  })));
  room.processedResult = false;
  addSystemMessage(room, `${game.code} ${game.name} 시작`);
  emitRoom(room);
}

function processRoomResult(room) {
  if (!room.session || room.session.status !== 'complete' || room.processedResult) return;
  const winners = room.session.result?.winners || [];
  room.players.forEach((player) => {
    if (player.isBot) return;
    const user = getUserById(player.id);
    if (!user) return;
    if (winners.includes(player.id)) {
      awardCard(user, room.cardCode);
    } else {
      markDead(user, {
        cardCode: room.cardCode,
        ipHash: player.ipHash,
        fingerprint: player.fingerprint,
        walletAddress: player.walletAddress,
        roomId: room.id,
      });
      if (player.socketId) io.to(player.socketId).emit('auth:dead', { reason: `${room.cardCode} 탈락` });
    }
  });
  room.status = 'finished';
  room.processedResult = true;
  addSystemMessage(room, room.session.result.summary);
  emitRoom(room);
}

app.post('/api/register', (req, res) => {
  try {
    const { username, password, deviceId, walletAddress } = req.body || {};
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: '아이디와 비밀번호를 확인해주세요.' });
    }
    const ipHash = hashIp(req);
    const fingerprint = makeFingerprint({
      ipHash,
      deviceId,
      userAgent: req.headers['user-agent'],
      walletAddress,
    });
    const lock = deathLockReason({ username, walletAddress, ipHash, fingerprint });
    if (lock) return res.status(403).json({ error: lock });
    const user = createUser({ username, password, walletAddress, deviceId });
    const token = signToken(user);
    res.json({ token, user: { username: user.username, role: user.role, status: user.status } });
  } catch (error) {
    res.status(400).json({ error: error.message || '회원가입 실패' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password, deviceId, walletAddress } = req.body || {};
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash || '')) {
    return res.status(401).json({ error: '로그인 정보가 올바르지 않습니다.' });
  }
  const ipHash = hashIp(req);
  const fingerprint = makeFingerprint({
    ipHash,
    deviceId,
    userAgent: req.headers['user-agent'],
    walletAddress: walletAddress || user.walletAddress,
  });
  const lock = !user.canBypassDeath ? deathLockReason({ username, walletAddress: walletAddress || user.walletAddress, ipHash, fingerprint }) : null;
  if (lock) return res.status(403).json({ error: lock });
  if (user.status === 'DEAD' && !user.canBypassDeath) {
    return res.status(403).json({ error: '이 계정은 사망 처리되었습니다.' });
  }
  const updated = touchUser(user, deviceId);
  const token = signToken(updated);
  res.json({
    token,
    user: { id: updated.id, username: updated.username, role: updated.role, status: updated.status, canBypassDeath: !!updated.canBypassDeath },
  });
});

app.get('/api/bootstrap', authMiddleware, (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      canBypassDeath: !!user.canBypassDeath,
      ownedCards: user.ownedCards || [],
    },
    games: gamesCatalog,
    rooms: Array.from(rooms.values()).map(roomSummary),
    leaderboard: leaderboard(gamesCatalog),
    rulebookMarkdown,
  });
});

app.get('/api/games', (_req, res) => res.json(gamesCatalog));
app.get('/api/leaderboard', (_req, res) => res.json(leaderboard(gamesCatalog)));

app.post('/api/admin/reset-user', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '어드민 전용입니다.' });
  const { username } = req.body || {};
  const user = resetUserDeath(username);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  res.json({ ok: true, user: { username: user.username, status: user.status } });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const deviceId = socket.handshake.auth?.deviceId;
  const payload = verifyToken(token);
  if (!payload) return next(new Error('auth required'));
  const user = getUserById(payload.sub);
  if (!user) return next(new Error('user not found'));
  const ipHash = hashIp(socket);
  const fingerprint = makeFingerprint({
    ipHash,
    deviceId,
    userAgent: socket.handshake.headers['user-agent'],
    walletAddress: user.walletAddress,
  });
  const lock = !user.canBypassDeath ? deathLockReason({ username: user.username, walletAddress: user.walletAddress, ipHash, fingerprint }) : null;
  if (lock) return next(new Error(lock));
  socketContext.set(socket.id, {
    socket,
    user,
    deviceId,
    ipHash,
    fingerprint,
  });
  next();
});

io.on('connection', (socket) => {
  const ctx = socketContext.get(socket.id);
  if (!ctx) {
    socket.disconnect();
    return;
  }

  socket.emit('rooms:update', Array.from(rooms.values()).map(roomSummary));

  socket.on('room:create', (payload = {}, ack = () => {}) => {
    try {
      const room = createRoom({
        owner: {
          id: ctx.user.id,
          username: ctx.user.username,
          socketId: socket.id,
          ipHash: ctx.ipHash,
          fingerprint: ctx.fingerprint,
          walletAddress: ctx.user.walletAddress,
        },
        cardCode: payload.cardCode,
        name: payload.name,
        addBots: ctx.user.role === 'admin' ? clampBots(payload.addBots, payload.cardCode) : 0,
      });
      ack({ ok: true, roomId: room.id });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', ({ roomId }, ack = () => {}) => {
    try {
      const room = joinRoom(roomId, { user: ctx.user, socket, ipHash: ctx.ipHash, fingerprint: ctx.fingerprint });
      ack({ ok: true, roomId: room.id });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('room:leave', (_payload, ack = () => {}) => {
    removeUserFromRoom(ctx.user.id);
    ack({ ok: true });
  });

  socket.on('room:ready', ({ ready }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: '방에 없습니다.' });
    const player = room.players.find((p) => p.id === ctx.user.id);
    if (!player) return ack({ ok: false, error: '플레이어를 찾을 수 없습니다.' });
    player.ready = !!ready;
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('room:select-card', ({ cardCode }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: '방이 없습니다.' });
    if (room.hostId !== ctx.user.id) return ack({ ok: false, error: '방장만 변경할 수 있습니다.' });
    if (room.status !== 'waiting') return ack({ ok: false, error: '대기 중인 방만 변경할 수 있습니다.' });
    room.cardCode = findGame(cardCode).code;
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('room:fill-bots', ({ count }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: '방이 없습니다.' });
    if (ctx.user.role !== 'admin') return ack({ ok: false, error: '어드민만 가능합니다.' });
    fillBots(room, clampBots(count, room.cardCode));
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('room:start', (_payload, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: '방이 없습니다.' });
    const problem = canStartRoom(room, ctx.user.id);
    if (problem) return ack({ ok: false, error: problem });
    startRoom(room);
    ack({ ok: true });
  });

  socket.on('room:chat', ({ text }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: '방이 없습니다.' });
    const trimmed = String(text || '').trim();
    if (!trimmed) return ack({ ok: false, error: '메시지가 비어 있습니다.' });
    if (room.session && !room.session.chatEnabled) return ack({ ok: false, error: '현재 채팅이 비활성화되어 있습니다.' });
    room.chat.push({ id: createId('msg'), user: ctx.user.username, userId: ctx.user.id, text: trimmed.slice(0, 400), at: now() });
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('game:submit', (payload = {}, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room || !room.session) return ack({ ok: false, error: '진행 중인 게임이 없습니다.' });
    submit(room.session, ctx.user.id, payload);
    emitRoom(room);
    processRoomResult(room);
    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    socketContext.delete(socket.id);
    const roomId = userRoomIndex.get(ctx.user.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    updateRoomPlayerSocket(room, ctx.user.id, null, false);
    emitRoom(room);
  });
});

function clampBots(count, cardCode) {
  const game = findGame(cardCode);
  const safe = Math.max(0, Math.min(parseInt(count, 10) || 0, game.players.max));
  return safe;
}

setInterval(() => {
  rooms.forEach((room) => {
    if (room.session && room.session.status !== 'complete') {
      const before = JSON.stringify({
        phase: room.session.phase,
        status: room.session.status,
        result: room.session.result,
        logLen: room.session.log.length,
      });
      tick(room.session);
      processRoomResult(room);
      const after = JSON.stringify({
        phase: room.session.phase,
        status: room.session.status,
        result: room.session.result,
        logLen: room.session.log.length,
      });
      if (before !== after) emitRoom(room);
    }
  });
}, 1000);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`BORDERLAND webapp listening on http://localhost:${PORT}`);
});
