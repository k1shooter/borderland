const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./lib/config');
const { createId, now, sha256 } = require('./lib/helpers');
const storage = require('./lib/storage/repository');
const {
  createSession,
  getView,
  submit,
  submitInput,
  tick,
  autoSubmitBots,
  adminSkip,
} = require('./lib/engines');
const { takeRateLimit } = require('./lib/services/rateLimit');
const {
  nextRoomVersion,
  storeRoomEvent,
  getRoomEventsSince,
  bindUserRoom,
  unbindUserRoom,
  getUserRoom,
} = require('./lib/services/roomStateStore');
const { initChainQueue, enqueueDeathRecord } = require('./lib/services/chainQueue');
const {
  createNonceMessage,
  verifySignature,
  verifySiweSignature,
} = require('./lib/services/siweService');

const PORT = config.port;
const JWT_SECRET = config.jwtSecret;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

const gamesCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'shared', 'gameCatalog.json'), 'utf8')
);
const rulebookMarkdown = fs.readFileSync(
  path.join(__dirname, 'docs', 'GAME_RULEBOOK.md'),
  'utf8'
);

const rooms = new Map();
const userRoomIndex = new Map();
const socketContext = new Map();
let ticking = false;

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return null;
  }
}

function findGame(cardCode) {
  return gamesCatalog.find((game) => game.code === cardCode) || gamesCatalog[0];
}

function hashIp(reqOrSocket) {
  const raw =
    reqOrSocket.headers?.['x-forwarded-for'] ||
    reqOrSocket.handshake?.headers?.['x-forwarded-for'] ||
    reqOrSocket.socket?.remoteAddress ||
    reqOrSocket.handshake?.address ||
    '';
  return raw ? sha256(String(raw)) : '';
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    canBypassDeath: !!user.canBypassDeath,
    ownedCards: user.ownedCards || [],
  };
}

function roomSummary(room) {
  const card = findGame(room.cardCode);
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    cardCode: room.cardCode,
    cardName: card.name,
    status: room.status,
    version: room.version || 0,
    players: room.players.map((player) => ({
      id: player.id,
      username: player.username,
      ready: !!player.ready,
      isBot: !!player.isBot,
      connected: !!player.connected,
    })),
    minPlayers: card.players.min,
    maxPlayers: card.players.max,
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
    version: room.version || 0,
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
    serverNow: now(),
    deadlineAt: sessionView?.deadlineAt || null,
  };
}

function buildRoomPatch(room) {
  return {
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      username: player.username,
      ready: !!player.ready,
      alive: player.alive !== false,
      connected: !!player.connected,
      isBot: !!player.isBot,
    })),
    chat: room.chat.slice(-20),
    session: room.session
      ? {
          phase: room.session.phase,
          phaseId: room.session.phaseId,
          status: room.session.status,
          round: room.session.round,
          deadlineAt: room.session.deadline,
          result: room.session.result || null,
        }
      : null,
  };
}

async function emitRooms() {
  io.emit('rooms:update', Array.from(rooms.values()).map(roomSummary));
}

async function emitRoom(room) {
  const previousVersion = room.version || 0;
  room.version = await nextRoomVersion(room.id);
  const patch = buildRoomPatch(room);
  await storeRoomEvent(room.id, room.version, patch);

  room.players.forEach((player) => {
    if (!player.socketId) return;
    const snapshot = buildRoomSnapshot(room, player.id);
    io.to(player.socketId).emit('room:update', {
      ...snapshot,
      version: room.version,
      phaseId: snapshot.session?.phaseId || 0,
      serverNow: now(),
      deadlineAt: snapshot.session?.deadlineAt || null,
    });
    if (previousVersion > 0 && room.version > previousVersion) {
      io.to(player.socketId).emit('room:delta', {
        fromVersion: previousVersion,
        toVersion: room.version,
        patch,
      });
    }
  });
  await emitRooms();
}

function addSystemMessage(room, text) {
  room.chat.push({
    id: createId('msg'),
    user: 'SYSTEM',
    text,
    at: now(),
    system: true,
  });
  if (room.chat.length > 200) room.chat.shift();
}

async function checkRateLimit(scope, id, limit, windowMs) {
  const result = await takeRateLimit(scope, id, limit, windowMs);
  if (!result.allowed) throw new Error('rate limited');
}

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'auth required' });
    const user = await storage.getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'user not found' });
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.message || 'auth failed' });
  }
}

function clampBots(count, cardCode) {
  const game = findGame(cardCode);
  return Math.max(0, Math.min(parseInt(count, 10) || 0, game.players.max));
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
    });
  }
}

async function createRoom({ owner, cardCode, name, addBots = 0 }) {
  const game = findGame(cardCode);
  const room = {
    id: createId('room'),
    name: name || `${game.code} - ${game.name}`,
    hostId: owner.id,
    cardCode: game.code,
    status: 'waiting',
    version: 0,
    players: [
      {
        id: owner.id,
        username: owner.username,
        socketId: owner.socketId,
        ready: false,
        alive: true,
        isBot: false,
        connected: true,
      },
    ],
    chat: [],
    session: null,
    processedResult: false,
  };
  rooms.set(room.id, room);
  userRoomIndex.set(owner.id, room.id);
  await bindUserRoom(owner.id, room.id);
  if (addBots > 0) fillBots(room, addBots);
  addSystemMessage(room, `${owner.username} created the room.`);
  await emitRoom(room);
  return room;
}

async function removeUserFromRoom(userId) {
  const roomId = userRoomIndex.get(userId) || (await getUserRoom(userId));
  if (!roomId) return;
  const room = rooms.get(roomId);
  userRoomIndex.delete(userId);
  await unbindUserRoom(userId);
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== userId);
  addSystemMessage(room, `${userId} left`);
  if (!room.players.length) {
    rooms.delete(room.id);
    return;
  }
  if (room.hostId === userId) room.hostId = room.players[0].id;
  await emitRoom(room);
}

async function joinRoom(roomId, ctx) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('room not found');

  const currentRoomId = userRoomIndex.get(ctx.user.id) || (await getUserRoom(ctx.user.id));
  if (currentRoomId && currentRoomId !== roomId) {
    await removeUserFromRoom(ctx.user.id);
  }

  const game = findGame(room.cardCode);
  if (room.players.length >= game.players.max) throw new Error('room is full');

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
    };
    room.players.push(player);
    addSystemMessage(room, `${ctx.user.username} joined.`);
  } else {
    player.socketId = ctx.socket.id;
    player.connected = true;
  }

  userRoomIndex.set(ctx.user.id, room.id);
  await bindUserRoom(ctx.user.id, room.id);
  await emitRoom(room);
  return room;
}

function updateRoomPlayerSocket(room, userId, socketId, connected) {
  const player = room.players.find((p) => p.id === userId);
  if (!player) return;
  player.socketId = socketId;
  player.connected = connected;
}

function canStartRoom(room, requesterId) {
  if (room.hostId !== requesterId) return 'only host can start';
  const game = findGame(room.cardCode);
  if (room.players.length < game.players.min) return `need at least ${game.players.min} players`;
  const notReady = room.players.filter(
    (player) => !player.isBot && !player.ready && player.id !== requesterId
  );
  if (notReady.length) return 'all players must be ready';
  return null;
}

async function startRoom(room) {
  const game = findGame(room.cardCode);
  room.status = 'running';
  room.players.forEach((player) => {
    player.ready = false;
    player.alive = true;
  });
  room.session = createSession(
    game,
    room.players.map((player) => ({
      id: player.id,
      username: player.username,
      isBot: player.isBot,
    }))
  );
  room.processedResult = false;
  addSystemMessage(room, `${game.code} ${game.name} started.`);
  autoSubmitBots(room.session);
  await emitRoom(room);
}

async function processRoomResult(room) {
  if (!room.session || room.session.status !== 'complete' || room.processedResult) return;
  const winners = room.session.result?.winners || [];
  const losers = room.session.players
    ? room.session.players.map((p) => p.id).filter((id) => !winners.includes(id))
    : room.players.map((p) => p.id).filter((id) => !winners.includes(id));

  for (const player of room.players) {
    if (player.isBot) continue;
    const user = await storage.getUserById(player.id);
    if (!user) continue;
    if (winners.includes(player.id)) {
      await storage.awardCard(user, room.cardCode);
    } else {
      const { record } = await storage.markDead(user, {
        cardCode: room.cardCode,
        roomId: room.id,
        walletAddress: user.walletAddress || '',
        reason: 'ELIMINATED',
      });
      if (record) {
        enqueueDeathRecord(record).catch(() => {});
        if (player.socketId) {
          io.to(player.socketId).emit('auth:dead', {
            reason: 'ACCOUNT_DEAD',
            deathId: record.id,
          });
        }
      }
    }
  }

  await storage.recordGameHistory({
    roomId: room.id,
    cardCode: room.cardCode,
    winners,
    losers,
    summary: room.session.result?.summary || '',
  });

  room.status = 'finished';
  room.processedResult = true;
  addSystemMessage(room, room.session.result?.summary || 'game finished');
  await emitRoom(room);
}

async function handleRegister(req, res) {
  try {
    await checkRateLimit('register', hashIp(req) || 'anon', 12, 10 * 60 * 1000);
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: 'username/password invalid' });
    }
    const lock = await storage.deathLockReason({ username });
    if (lock) return res.status(403).json({ error: lock, deathLockReason: lock });

    const user = await storage.createUser({ username, password });
    const token = signToken(user);
    return res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'register failed' });
  }
}

async function handleLogin(req, res) {
  try {
    await checkRateLimit('login', hashIp(req) || 'anon', 30, 10 * 60 * 1000);
    const { username, password } = req.body || {};
    const user = await storage.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password || '', user.passwordHash || '')) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const lock = !user.canBypassDeath
      ? await storage.deathLockReason({ username: user.username, userId: user.id })
      : null;
    if (lock) return res.status(403).json({ error: lock, deathLockReason: lock });
    if (user.status === 'DEAD' && !user.canBypassDeath) {
      return res.status(403).json({ error: 'ACCOUNT_DEAD', deathLockReason: 'ACCOUNT_DEAD' });
    }

    const updated = await storage.touchUser(user, req.body?.deviceId);
    const token = signToken(updated);
    return res.json({ token, user: sanitizeUser(updated) });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'login failed' });
  }
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', handleRegister);
app.post('/api/register', handleRegister);
app.post('/api/auth/login', handleLogin);
app.post('/api/login', handleLogin);

app.post('/api/auth/siwe/nonce', async (req, res) => {
  try {
    await checkRateLimit('siwe-nonce', hashIp(req) || 'anon', 40, 10 * 60 * 1000);
    const { walletAddress, chainId } = req.body || {};
    const domain = req.headers.host || 'localhost';
    const uri = `${req.protocol}://${req.headers.host || 'localhost'}`;
    const payload = await createNonceMessage({ walletAddress, chainId, domain, uri });
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'siwe nonce failed' });
  }
});

app.post('/api/auth/siwe/verify', async (req, res) => {
  try {
    await checkRateLimit('siwe-verify', hashIp(req) || 'anon', 40, 10 * 60 * 1000);
    const { message, signature, walletAddress } = req.body || {};
    const { user } = await verifySignature({ message, signature, walletAddress });
    const lock = !user.canBypassDeath
      ? await storage.deathLockReason({ username: user.username, userId: user.id })
      : null;
    if (lock) return res.status(403).json({ error: lock, deathLockReason: lock });
    const token = signToken(user);
    return res.json({ token, user: sanitizeUser(user), walletLinked: true });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'siwe verify failed' });
  }
});

app.post('/api/auth/wallet/link/nonce', authMiddleware, async (req, res) => {
  try {
    const { walletAddress, chainId } = req.body || {};
    const domain = req.headers.host || 'localhost';
    const uri = `${req.protocol}://${req.headers.host || 'localhost'}`;
    const payload = await createNonceMessage({ walletAddress, chainId, domain, uri });
    return res.json({ nonce: payload.nonce, message: payload.message });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'wallet link nonce failed' });
  }
});

app.post('/api/auth/wallet/link/verify', authMiddleware, async (req, res) => {
  try {
    const { message, signature } = req.body || {};
    const verified = await verifySiweSignature({ message, signature });
    const existing = await storage.getUserByWallet(verified.walletAddress, verified.chainId);
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: 'wallet already linked' });
    }
    await storage.linkWallet(req.user.id, verified.walletAddress, verified.chainId, true);
    return res.json({ ok: true, walletAddress: verified.walletAddress });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'wallet link verify failed' });
  }
});

app.get('/api/bootstrap', authMiddleware, async (req, res) => {
  try {
    const user = await storage.getUserById(req.user.id);
    const board = await storage.leaderboard(gamesCatalog);
    return res.json({
      user: sanitizeUser(user),
      games: gamesCatalog,
      rooms: Array.from(rooms.values()).map(roomSummary),
      leaderboard: board,
      rulebookMarkdown,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'bootstrap failed' });
  }
});

app.get('/api/games', (_req, res) => res.json(gamesCatalog));

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const board = await storage.leaderboard(gamesCatalog);
    return res.json(board);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'leaderboard failed' });
  }
});

app.get('/api/rooms/:id/state', authMiddleware, async (req, res) => {
  try {
    const room = rooms.get(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    const inRoom = room.players.some((player) => player.id === req.user.id);
    if (!inRoom) return res.status(403).json({ error: 'not in room' });

    const sinceVersion = Math.max(0, parseInt(req.query.sinceVersion, 10) || 0);
    if (sinceVersion > 0 && sinceVersion < (room.version || 0)) {
      const events = await getRoomEventsSince(room.id, sinceVersion);
      if (events.length > 0) {
        return res.json({
          delta: events.map((event) => ({
            version: event.version,
            patch: event.snapshot,
          })),
          version: room.version,
        });
      }
    }

    return res.json({
      snapshot: buildRoomSnapshot(room, req.user.id),
      version: room.version || 0,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'state fetch failed' });
  }
});

app.post('/api/admin/reset-user', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const { username } = req.body || {};
  const user = await storage.resetUserDeath(username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  return res.json({ ok: true, user: sanitizeUser(user) });
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = verifyToken(token);
    if (!payload) return next(new Error('auth required'));
    const user = await storage.getUserById(payload.sub);
    if (!user) return next(new Error('user not found'));

    const lock = !user.canBypassDeath
      ? await storage.deathLockReason({ username: user.username, userId: user.id })
      : null;
    if (lock) return next(new Error(lock));

    socketContext.set(socket.id, {
      socket,
      user,
      ipHash: hashIp(socket),
    });
    return next();
  } catch (error) {
    return next(new Error(error.message || 'auth failed'));
  }
});

io.on('connection', (socket) => {
  const ctx = socketContext.get(socket.id);
  if (!ctx) {
    socket.disconnect();
    return;
  }

  socket.emit('rooms:update', Array.from(rooms.values()).map(roomSummary));
  socket.emit('sync:clock', { serverNow: now(), recvAt: now() });

  socket.on('room:create', async (payload = {}, ack = () => {}) => {
    try {
      await checkRateLimit('room-create', ctx.user.id, 15, 60 * 1000);
      const currentRoomId =
        userRoomIndex.get(ctx.user.id) || (await getUserRoom(ctx.user.id));
      if (currentRoomId) await removeUserFromRoom(ctx.user.id);
      const room = await createRoom({
        owner: {
          id: ctx.user.id,
          username: ctx.user.username,
          socketId: socket.id,
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

  socket.on('room:join', async ({ roomId }, ack = () => {}) => {
    try {
      await checkRateLimit('room-join', ctx.user.id, 40, 60 * 1000);
      const room = await joinRoom(roomId, { user: ctx.user, socket });
      ack({ ok: true, roomId: room.id });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('room:leave', async (_payload, ack = () => {}) => {
    await removeUserFromRoom(ctx.user.id);
    ack({ ok: true });
  });

  socket.on('room:ready', async ({ ready }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: 'room not found' });
    const player = room.players.find((p) => p.id === ctx.user.id);
    if (!player) return ack({ ok: false, error: 'player not found' });
    player.ready = !!ready;
    await emitRoom(room);
    ack({ ok: true });
  });

  socket.on('room:select-card', async ({ cardCode }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: 'room not found' });
    if (room.hostId !== ctx.user.id) return ack({ ok: false, error: 'host only' });
    if (room.status !== 'waiting') return ack({ ok: false, error: 'room must be waiting' });
    room.cardCode = findGame(cardCode).code;
    await emitRoom(room);
    ack({ ok: true });
  });

  socket.on('room:fill-bots', async ({ count }, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: 'room not found' });
    if (ctx.user.role !== 'admin') return ack({ ok: false, error: 'admin only' });
    fillBots(room, clampBots(count, room.cardCode));
    await emitRoom(room);
    ack({ ok: true });
  });

  socket.on('room:start', async (_payload, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, error: 'room not found' });
    const problem = canStartRoom(room, ctx.user.id);
    if (problem) return ack({ ok: false, error: problem });
    await startRoom(room);
    ack({ ok: true });
  });

  socket.on('room:chat', async ({ text }, ack = () => {}) => {
    try {
      await checkRateLimit('chat', ctx.user.id, 40, 60 * 1000);
      const roomId = userRoomIndex.get(ctx.user.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room) return ack({ ok: false, error: 'room not found' });
      const trimmed = String(text || '').trim();
      if (!trimmed) return ack({ ok: false, error: 'message is empty' });
      if (room.session && !room.session.chatEnabled) {
        return ack({ ok: false, error: 'chat is disabled for this phase' });
      }
      room.chat.push({
        id: createId('msg'),
        user: ctx.user.username,
        userId: ctx.user.id,
        text: trimmed.slice(0, 400),
        at: now(),
      });
      await emitRoom(room);
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('game:input', async (payload = {}, ack = () => {}) => {
    try {
      await checkRateLimit('game-input', ctx.user.id, 500, 60 * 1000);
      const roomId = userRoomIndex.get(ctx.user.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !room.session) return ack({ ok: false, error: 'no running game' });
      submitInput(room.session, ctx.user.id, payload);
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('game:submit', async (payload = {}, ack = () => {}) => {
    try {
      await checkRateLimit('game-submit', ctx.user.id, 80, 60 * 1000);
      const roomId = userRoomIndex.get(ctx.user.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !room.session) return ack({ ok: false, error: 'no running game' });
      submit(room.session, ctx.user.id, payload);
      autoSubmitBots(room.session);
      await processRoomResult(room);
      await emitRoom(room);
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, error: error.message });
    }
  });

  socket.on('game:admin-skip', async (_payload, ack = () => {}) => {
    const roomId = userRoomIndex.get(ctx.user.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room || !room.session) return ack({ ok: false, error: 'no running game' });
    if (ctx.user.role !== 'admin') return ack({ ok: false, error: 'admin only' });
    adminSkip(room.session);
    autoSubmitBots(room.session);
    await processRoomResult(room);
    addSystemMessage(room, 'admin skipped current deadline');
    await emitRoom(room);
    return ack({ ok: true });
  });

  socket.on('disconnect', async () => {
    socketContext.delete(socket.id);
    const roomId = userRoomIndex.get(ctx.user.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    updateRoomPlayerSocket(room, ctx.user.id, null, false);
    await emitRoom(room);
  });
});

setInterval(() => {
  io.emit('sync:clock', { serverNow: now(), recvAt: now() });
}, 5000);

setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    for (const room of rooms.values()) {
      if (!room.session || room.session.status === 'complete') continue;
      const before = JSON.stringify({
        phaseId: room.session.phaseId,
        status: room.session.status,
        deadline: room.session.deadline,
        logLen: room.session.log.length,
        subCount: Object.keys(room.session.submissions || {}).length,
      });
      tick(room.session);
      autoSubmitBots(room.session);
      await processRoomResult(room);
      const after = JSON.stringify({
        phaseId: room.session.phaseId,
        status: room.session.status,
        deadline: room.session.deadline,
        logLen: room.session.log.length,
        subCount: Object.keys(room.session.submissions || {}).length,
      });
      if (before !== after) {
        await emitRoom(room);
      }
    }
  } finally {
    ticking = false;
  }
}, 1000);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  await storage.bootstrapAdmin();
  initChainQueue({ withWorker: false });
  server.listen(PORT, () => {
    console.log(`BORDERLAND webapp listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
