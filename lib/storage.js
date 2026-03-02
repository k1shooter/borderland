const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { sha256, createId, now } = require('./helpers');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    return fallback;
  }
}

function saveJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function loadUsers() {
  return loadJson(USERS_FILE, []);
}

function saveUsers(users) {
  saveJson(USERS_FILE, users);
}

function loadRegistry() {
  return loadJson(REGISTRY_FILE, {
    deadUserIds: {},
    deadUsernames: {},
    deadWallets: {},
    deadIpHashes: {},
    deadFingerprints: {},
    logs: [],
  });
}

function saveRegistry(registry) {
  saveJson(REGISTRY_FILE, registry);
}

function bootstrapAdmin() {
  const users = loadUsers();
  let admin = users.find((user) => user.username === 'admin');
  if (!admin) {
    admin = {
      id: createId('user'),
      username: 'admin',
      passwordHash: bcrypt.hashSync('borderland-admin-2026!', 10),
      role: 'admin',
      status: 'ALIVE',
      canBypassDeath: true,
      walletAddress: '',
      deviceIds: [],
      ownedCards: [],
      wins: 0,
      deaths: 0,
      createdAt: now(),
      lastSeenAt: now(),
    };
    users.push(admin);
    saveUsers(users);
  }
  return admin;
}

function getUserById(id) {
  return loadUsers().find((user) => user.id === id) || null;
}

function getUserByUsername(username) {
  return loadUsers().find((user) => user.username === username) || null;
}

function updateUser(updated) {
  const users = loadUsers();
  const index = users.findIndex((user) => user.id === updated.id);
  if (index >= 0) users[index] = updated;
  else users.push(updated);
  saveUsers(users);
  return updated;
}

function createUser({ username, password, walletAddress, deviceId }) {
  const users = loadUsers();
  if (users.some((user) => user.username === username)) {
    throw new Error('이미 존재하는 아이디입니다.');
  }
  const user = {
    id: createId('user'),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'player',
    status: 'ALIVE',
    canBypassDeath: false,
    walletAddress: walletAddress || '',
    deviceIds: deviceId ? [deviceId] : [],
    ownedCards: [],
    wins: 0,
    deaths: 0,
    createdAt: now(),
    lastSeenAt: now(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function touchUser(user, deviceId) {
  const updated = { ...user, lastSeenAt: now() };
  if (deviceId && !updated.deviceIds.includes(deviceId)) updated.deviceIds.push(deviceId);
  return updateUser(updated);
}

function deathLockReason({ username, walletAddress, ipHash, fingerprint }) {
  const registry = loadRegistry();
  const normalizedUsername = String(username || '');
  const normalizedWallet = String(walletAddress || '').trim().toLowerCase();
  if (registry.deadUsernames[normalizedUsername]) return '이 계정은 이미 사망 처리되었습니다.';
  if (normalizedWallet && registry.deadWallets[normalizedWallet]) return '이 지갑은 이미 사망 처리되었습니다.';
  if (ipHash && registry.deadIpHashes[ipHash]) return '이 IP는 이미 사망 처리되었습니다.';
  if (fingerprint && registry.deadFingerprints[fingerprint]) return '이 기기는 이미 사망 처리되었습니다.';
  return null;
}

function markDead(user, { cardCode, ipHash, fingerprint, walletAddress, roomId }) {
  if (!user || user.canBypassDeath) return user;
  const registry = loadRegistry();
  const updated = {
    ...user,
    status: 'DEAD',
    deaths: (user.deaths || 0) + 1,
    lastSeenAt: now(),
  };
  updateUser(updated);
  registry.deadUserIds[updated.id] = { at: now(), cardCode, roomId };
  registry.deadUsernames[updated.username] = { at: now(), cardCode, roomId };
  if (walletAddress) registry.deadWallets[String(walletAddress).trim().toLowerCase()] = { at: now(), cardCode, roomId };
  if (ipHash) registry.deadIpHashes[ipHash] = { at: now(), cardCode, roomId };
  if (fingerprint) registry.deadFingerprints[fingerprint] = { at: now(), cardCode, roomId };
  registry.logs.push({
    userId: updated.id,
    username: updated.username,
    cardCode,
    roomId,
    ipHash,
    fingerprint,
    walletAddress: walletAddress || '',
    at: now(),
  });
  saveRegistry(registry);
  return updated;
}

function awardCard(user, cardCode) {
  if (!user || user.canBypassDeath) return user;
  const ownedCards = Array.isArray(user.ownedCards) ? [...user.ownedCards] : [];
  if (!ownedCards.includes(cardCode)) ownedCards.push(cardCode);
  const updated = {
    ...user,
    ownedCards,
    wins: (user.wins || 0) + 1,
    lastSeenAt: now(),
  };
  updateUser(updated);
  return updated;
}

function resetUserDeath(username) {
  const users = loadUsers();
  const registry = loadRegistry();
  const user = users.find((item) => item.username === username);
  if (!user) return null;
  user.status = 'ALIVE';
  updateUser(user);
  delete registry.deadUserIds[user.id];
  delete registry.deadUsernames[user.username];
  if (user.walletAddress) delete registry.deadWallets[String(user.walletAddress).trim().toLowerCase()];
  saveRegistry(registry);
  return user;
}

function leaderboard(gamesCatalog) {
  const users = loadUsers().filter((user) => user.role !== 'admin');
  return users
    .map((user) => ({
      username: user.username,
      status: user.status,
      cards: (user.ownedCards || []).length,
      wins: user.wins || 0,
      deaths: user.deaths || 0,
      lastSeenAt: user.lastSeenAt || 0,
      ownedCards: (user.ownedCards || []).map((code) => {
        const card = gamesCatalog.find((g) => g.code === code);
        return card ? `${card.code} ${card.name}` : code;
      }),
    }))
    .sort((a, b) =>
      (b.cards - a.cards) ||
      (b.wins - a.wins) ||
      (a.deaths - b.deaths) ||
      (b.lastSeenAt - a.lastSeenAt) ||
      a.username.localeCompare(b.username));
}

module.exports = {
  bootstrapAdmin,
  loadUsers,
  saveUsers,
  loadRegistry,
  saveRegistry,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  touchUser,
  deathLockReason,
  markDead,
  awardCard,
  leaderboard,
  resetUserDeath,
};
