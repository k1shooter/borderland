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
  } catch (_error) {
    return fallback;
  }
}

function saveJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeWallet(walletAddress) {
  return String(walletAddress || '').trim().toLowerCase();
}

function loadUsers() {
  return loadJson(USERS_FILE, []);
}

function saveUsers(users) {
  saveJson(USERS_FILE, users);
}

function loadRegistry() {
  const raw = loadJson(REGISTRY_FILE, {
    deadUserIds: {},
    deadUsernames: {},
    logs: [],
    siweNonces: [],
    wallets: {},
  });
  return {
    deadUserIds:
      raw && typeof raw.deadUserIds === 'object' ? raw.deadUserIds : {},
    deadUsernames:
      raw && typeof raw.deadUsernames === 'object' ? raw.deadUsernames : {},
    logs: Array.isArray(raw?.logs) ? raw.logs : [],
    siweNonces: Array.isArray(raw?.siweNonces) ? raw.siweNonces : [],
    wallets: raw && typeof raw.wallets === 'object' ? raw.wallets : {},
  };
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
      wallets: [],
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

function getUserByWallet(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return null;
  return (
    loadUsers().find((user) => {
      const mainWallet = normalizeWallet(user.walletAddress);
      const wallets = Array.isArray(user.wallets)
        ? user.wallets.map((value) => normalizeWallet(value))
        : [];
      return mainWallet === wallet || wallets.includes(wallet);
    }) || null
  );
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
    throw new Error('already exists');
  }
  const normalizedWallet = normalizeWallet(walletAddress);
  const user = {
    id: createId('user'),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'player',
    status: 'ALIVE',
    canBypassDeath: false,
    walletAddress: normalizedWallet,
    wallets: normalizedWallet ? [normalizedWallet] : [],
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
  if (deviceId && !updated.deviceIds.includes(deviceId))
    updated.deviceIds.push(deviceId);
  return updateUser(updated);
}

function deathLockReason({ username, userId }) {
  const registry = loadRegistry();
  const normalizedUsername = String(username || '').trim();
  if (userId && registry.deadUserIds[userId]) return 'ACCOUNT_DEAD';
  if (normalizedUsername && registry.deadUsernames[normalizedUsername])
    return 'ACCOUNT_DEAD';
  return null;
}

function markDead(user, { cardCode, walletAddress, roomId, reason } = {}) {
  if (!user || user.canBypassDeath) return { user, record: null };
  const registry = loadRegistry();
  const updated = {
    ...user,
    status: 'DEAD',
    deaths: (user.deaths || 0) + 1,
    lastSeenAt: now(),
  };
  updateUser(updated);
  const deathId = createId('death');
  registry.deadUserIds[updated.id] = {
    id: deathId,
    at: now(),
    cardCode,
    roomId,
    reason: reason || 'ELIMINATED',
  };
  registry.deadUsernames[updated.username] = {
    id: deathId,
    at: now(),
    cardCode,
    roomId,
    reason: reason || 'ELIMINATED',
  };
  const record = {
    id: deathId,
    userId: updated.id,
    username: updated.username,
    cardCode: cardCode || '',
    roomId: roomId || '',
    walletAddress: normalizeWallet(walletAddress || updated.walletAddress || ''),
    diedAt: now(),
    reason: reason || 'ELIMINATED',
    chainStatus: 'pending',
    chainTxHash: null,
  };
  registry.logs.push(record);
  saveRegistry(registry);
  return { user: updated, record };
}

function setDeathChainStatus(deathId, status, txHash, lastError) {
  const registry = loadRegistry();
  const index = registry.logs.findIndex((item) => item.id === deathId);
  if (index === -1) return null;
  registry.logs[index] = {
    ...registry.logs[index],
    chainStatus: status || registry.logs[index].chainStatus,
    chainTxHash: txHash || registry.logs[index].chainTxHash || null,
    chainError: lastError || null,
    chainUpdatedAt: now(),
  };
  saveRegistry(registry);
  return registry.logs[index];
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
  saveRegistry(registry);
  return user;
}

function linkWallet(userId, walletAddress, chainId = 1, verified = true) {
  const user = getUserById(userId);
  if (!user) return null;
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet) return null;
  const wallets = Array.isArray(user.wallets) ? [...user.wallets] : [];
  if (!wallets.includes(normalizedWallet)) wallets.push(normalizedWallet);
  const updated = updateUser({
    ...user,
    walletAddress: normalizedWallet,
    wallets,
    walletChainId: chainId,
    walletVerified: !!verified,
    lastSeenAt: now(),
  });
  const registry = loadRegistry();
  registry.wallets[normalizedWallet] = {
    userId,
    linkedAt: now(),
    chainId,
    verified: !!verified,
  };
  saveRegistry(registry);
  return updated;
}

function createSiweNonce({ walletAddress, chainId, message, nonce, expiresAt }) {
  const registry = loadRegistry();
  const row = {
    id: createId('siwe'),
    walletAddress: normalizeWallet(walletAddress),
    chainId: parseInt(chainId, 10) || 1,
    message: String(message || ''),
    nonce: String(nonce || ''),
    expiresAt: expiresAt || now() + 5 * 60 * 1000,
    usedAt: null,
    createdAt: now(),
  };
  registry.siweNonces.push(row);
  registry.siweNonces = registry.siweNonces.slice(-5000);
  saveRegistry(registry);
  return row;
}

function consumeSiweNonce({ walletAddress, nonce }) {
  const registry = loadRegistry();
  const normalizedWallet = normalizeWallet(walletAddress);
  const found = registry.siweNonces.find(
    (item) =>
      item.walletAddress === normalizedWallet &&
      item.nonce === nonce &&
      !item.usedAt &&
      item.expiresAt >= now()
  );
  if (!found) return null;
  found.usedAt = now();
  saveRegistry(registry);
  return found;
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
      chainDeaths: loadRegistry().logs.filter((item) => item.userId === user.id)
        .length,
      ownedCards: (user.ownedCards || []).map((code) => {
        const card = gamesCatalog.find((g) => g.code === code);
        return card ? `${card.code} ${card.name}` : code;
      }),
    }))
    .sort(
      (a, b) =>
        b.cards - a.cards ||
        b.wins - a.wins ||
        a.deaths - b.deaths ||
        b.lastSeenAt - a.lastSeenAt ||
        a.username.localeCompare(b.username)
    );
}

function hashAccount(userId) {
  return `0x${sha256(userId)}`;
}

module.exports = {
  bootstrapAdmin,
  loadUsers,
  saveUsers,
  loadRegistry,
  saveRegistry,
  getUserById,
  getUserByUsername,
  getUserByWallet,
  createUser,
  updateUser,
  touchUser,
  deathLockReason,
  markDead,
  setDeathChainStatus,
  awardCard,
  leaderboard,
  resetUserDeath,
  linkWallet,
  createSiweNonce,
  consumeSiweNonce,
  hashAccount,
};
