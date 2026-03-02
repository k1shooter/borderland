const bcrypt = require('bcryptjs');
const { query, transaction, getPool } = require('../db/postgres');
const config = require('../config');
const { createId, now, sha256 } = require('../helpers');
const jsonStorage = require('../storage');

function normalizeWallet(walletAddress) {
  return String(walletAddress || '').trim().toLowerCase();
}

function toUserRow(row) {
  if (!row) return null;
  const wallets = Array.isArray(row.wallets) ? row.wallets : [];
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    canBypassDeath: !!row.can_bypass_death,
    walletAddress: wallets[0] || '',
    wallets,
    deviceIds: Array.isArray(row.device_ids) ? row.device_ids : [],
    ownedCards: Array.isArray(row.owned_cards) ? row.owned_cards : [],
    wins: row.wins || 0,
    deaths: row.deaths || 0,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function isDbEnabled() {
  return !!(config.readDb && config.databaseUrl && getPool());
}

async function bootstrapAdmin() {
  if (!(await isDbEnabled())) return jsonStorage.bootstrapAdmin();
  const existing = await query('SELECT * FROM users WHERE username = $1', ['admin']);
  if (existing.rows[0]) return toUserRow(existing.rows[0]);
  const admin = {
    id: createId('user'),
    username: 'admin',
    passwordHash: bcrypt.hashSync('borderland-admin-2026!', 10),
    role: 'admin',
    status: 'ALIVE',
    canBypassDeath: true,
    ownedCards: [],
    wins: 0,
    deaths: 0,
    createdAt: now(),
    lastSeenAt: now(),
  };
  await query(
    `INSERT INTO users (id, username, password_hash, role, status, can_bypass_death, owned_cards, wins, deaths, created_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      admin.id,
      admin.username,
      admin.passwordHash,
      admin.role,
      admin.status,
      admin.canBypassDeath,
      JSON.stringify(admin.ownedCards),
      admin.wins,
      admin.deaths,
      admin.createdAt,
      admin.lastSeenAt,
    ]
  );
  await query(
    `INSERT INTO leaderboard_stats (user_id, wins, deaths, cards_count, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id)
     DO UPDATE SET wins = EXCLUDED.wins, deaths = EXCLUDED.deaths, cards_count = EXCLUDED.cards_count, updated_at = EXCLUDED.updated_at`,
    [admin.id, 0, 0, 0, now()]
  );
  return admin;
}

async function getUserById(id) {
  if (!(await isDbEnabled())) return jsonStorage.getUserById(id);
  const res = await query(
    `SELECT u.*, (
        SELECT COALESCE(jsonb_agg(uw.wallet_address), '[]'::jsonb)
        FROM user_wallets uw WHERE uw.user_id = u.id
      ) AS wallets
      FROM users u
      WHERE u.id = $1`,
    [id]
  );
  return toUserRow(res.rows[0]);
}

async function getUserByUsername(username) {
  if (!(await isDbEnabled())) return jsonStorage.getUserByUsername(username);
  const res = await query(
    `SELECT u.*, (
        SELECT COALESCE(jsonb_agg(uw.wallet_address), '[]'::jsonb)
        FROM user_wallets uw WHERE uw.user_id = u.id
      ) AS wallets
      FROM users u
      WHERE u.username = $1`,
    [username]
  );
  return toUserRow(res.rows[0]);
}

async function getUserByWallet(walletAddress, chainId = 1) {
  if (!(await isDbEnabled())) return jsonStorage.getUserByWallet(walletAddress);
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return null;
  const res = await query(
    `SELECT u.*, (
        SELECT COALESCE(jsonb_agg(uw2.wallet_address), '[]'::jsonb)
        FROM user_wallets uw2 WHERE uw2.user_id = u.id
      ) AS wallets
      FROM user_wallets uw
      JOIN users u ON u.id = uw.user_id
      WHERE uw.wallet_address = $1 AND uw.chain_id = $2`,
    [wallet, parseInt(chainId, 10) || 1]
  );
  return toUserRow(res.rows[0]);
}

async function createUser({ username, password, walletAddress, deviceId }) {
  if (!(await isDbEnabled()))
    return jsonStorage.createUser({ username, password, walletAddress, deviceId });
  const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rowCount) throw new Error('already exists');
  const user = {
    id: createId('user'),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'player',
    status: 'ALIVE',
    canBypassDeath: false,
    ownedCards: [],
    wins: 0,
    deaths: 0,
    createdAt: now(),
    lastSeenAt: now(),
  };
  await query(
    `INSERT INTO users (id, username, password_hash, role, status, can_bypass_death, owned_cards, wins, deaths, created_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      user.id,
      user.username,
      user.passwordHash,
      user.role,
      user.status,
      user.canBypassDeath,
      JSON.stringify(user.ownedCards),
      user.wins,
      user.deaths,
      user.createdAt,
      user.lastSeenAt,
    ]
  );
  await query(
    `INSERT INTO leaderboard_stats (user_id, wins, deaths, cards_count, updated_at) VALUES ($1,$2,$3,$4,$5)`,
    [user.id, 0, 0, 0, now()]
  );
  if (walletAddress) {
    await linkWallet(user.id, walletAddress, config.chainId, false);
  }
  return await getUserById(user.id);
}

async function touchUser(user, deviceId) {
  if (!(await isDbEnabled())) return jsonStorage.touchUser(user, deviceId);
  await query('UPDATE users SET last_seen_at = $1 WHERE id = $2', [now(), user.id]);
  return await getUserById(user.id);
}

async function deathLockReason({ username, userId }) {
  if (!(await isDbEnabled())) return jsonStorage.deathLockReason({ username, userId });
  if (userId) {
    const byId = await query('SELECT 1 FROM death_registry WHERE user_id = $1 LIMIT 1', [userId]);
    if (byId.rowCount) return 'ACCOUNT_DEAD';
  }
  if (username) {
    const byUsername = await query('SELECT 1 FROM death_registry WHERE username = $1 LIMIT 1', [
      username,
    ]);
    if (byUsername.rowCount) return 'ACCOUNT_DEAD';
  }
  return null;
}

async function markDead(user, { cardCode, walletAddress, roomId, reason } = {}) {
  if (!(await isDbEnabled())) return jsonStorage.markDead(user, { cardCode, walletAddress, roomId, reason });
  if (!user || user.canBypassDeath) return { user, record: null };
  const deathId = createId('death');
  const diedAt = now();
  const normalizedWallet = normalizeWallet(walletAddress || user.walletAddress || '');
  await transaction(async (client) => {
    await client.query(
      'UPDATE users SET status = $1, deaths = deaths + 1, last_seen_at = $2 WHERE id = $3',
      ['DEAD', diedAt, user.id]
    );
    await client.query(
      `INSERT INTO death_registry (id, user_id, username, card_code, room_id, wallet_address, died_at, reason, chain_status, chain_tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        deathId,
        user.id,
        user.username,
        cardCode || '',
        roomId || '',
        normalizedWallet || null,
        diedAt,
        reason || 'ELIMINATED',
        'pending',
        null,
      ]
    );
    await client.query(
      `INSERT INTO leaderboard_stats (user_id, wins, deaths, cards_count, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id)
       DO UPDATE SET deaths = leaderboard_stats.deaths + 1, updated_at = EXCLUDED.updated_at`,
      [user.id, user.wins || 0, (user.deaths || 0) + 1, (user.ownedCards || []).length, diedAt]
    );
  });
  const updated = await getUserById(user.id);
  return {
    user: updated,
    record: {
      id: deathId,
      userId: user.id,
      username: user.username,
      cardCode: cardCode || '',
      roomId: roomId || '',
      walletAddress: normalizedWallet || '',
      diedAt,
      reason: reason || 'ELIMINATED',
      chainStatus: 'pending',
      chainTxHash: null,
    },
  };
}

async function setDeathChainStatus(deathId, status, txHash, lastError) {
  if (!(await isDbEnabled()))
    return jsonStorage.setDeathChainStatus(deathId, status, txHash, lastError);
  await query(
    `UPDATE death_registry
      SET chain_status = $2,
          chain_tx_hash = COALESCE($3, chain_tx_hash)
      WHERE id = $1`,
    [deathId, status || 'pending', txHash || null]
  );
  await query(
    `INSERT INTO death_chain_jobs (id, death_registry_id, status, attempts, tx_hash, last_error, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      createId('job'),
      deathId,
      status || 'pending',
      1,
      txHash || null,
      lastError || null,
      now(),
    ]
  );
}

async function awardCard(user, cardCode) {
  if (!(await isDbEnabled())) return jsonStorage.awardCard(user, cardCode);
  if (!user || user.canBypassDeath) return user;
  const ownedCards = Array.isArray(user.ownedCards) ? [...user.ownedCards] : [];
  if (!ownedCards.includes(cardCode)) ownedCards.push(cardCode);
  const updatedAt = now();
  await query(
    `UPDATE users
      SET owned_cards = $2,
          wins = wins + 1,
          last_seen_at = $3
      WHERE id = $1`,
    [user.id, JSON.stringify(ownedCards), updatedAt]
  );
  await query(
    `INSERT INTO leaderboard_stats (user_id, wins, deaths, cards_count, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id)
     DO UPDATE SET wins = EXCLUDED.wins, cards_count = EXCLUDED.cards_count, updated_at = EXCLUDED.updated_at`,
    [user.id, (user.wins || 0) + 1, user.deaths || 0, ownedCards.length, updatedAt]
  );
  return await getUserById(user.id);
}

async function resetUserDeath(username) {
  if (!(await isDbEnabled())) return jsonStorage.resetUserDeath(username);
  const user = await getUserByUsername(username);
  if (!user) return null;
  await transaction(async (client) => {
    await client.query('UPDATE users SET status = $1 WHERE id = $2', ['ALIVE', user.id]);
    await client.query('DELETE FROM death_registry WHERE user_id = $1', [user.id]);
  });
  return await getUserById(user.id);
}

async function linkWallet(userId, walletAddress, chainId = 1, verified = true) {
  if (!(await isDbEnabled()))
    return jsonStorage.linkWallet(userId, walletAddress, chainId, verified);
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return null;
  const linkedAt = now();
  await query(
    `INSERT INTO user_wallets (user_id, wallet_address, chain_id, linked_at, verified)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_id, wallet_address, chain_id)
      DO UPDATE SET linked_at = EXCLUDED.linked_at, verified = EXCLUDED.verified`,
    [userId, wallet, parseInt(chainId, 10) || 1, linkedAt, !!verified]
  );
  return await getUserById(userId);
}

async function createSiweNonce({ walletAddress, chainId, message, nonce, expiresAt }) {
  if (!(await isDbEnabled()))
    return jsonStorage.createSiweNonce({ walletAddress, chainId, message, nonce, expiresAt });
  const row = {
    id: createId('siwe'),
    walletAddress: normalizeWallet(walletAddress),
    chainId: parseInt(chainId, 10) || 1,
    message: String(message || ''),
    nonce: String(nonce || ''),
    expiresAt: expiresAt || now() + 5 * 60 * 1000,
  };
  await query(
    `INSERT INTO siwe_nonces (id, wallet_address, nonce, message, chain_id, expires_at, used_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.id, row.walletAddress, row.nonce, row.message, row.chainId, row.expiresAt, null]
  );
  return row;
}

async function consumeSiweNonce({ walletAddress, nonce }) {
  if (!(await isDbEnabled())) return jsonStorage.consumeSiweNonce({ walletAddress, nonce });
  const wallet = normalizeWallet(walletAddress);
  const read = await query(
    `SELECT * FROM siwe_nonces
      WHERE wallet_address = $1 AND nonce = $2 AND used_at IS NULL AND expires_at >= $3
      ORDER BY expires_at DESC
      LIMIT 1`,
    [wallet, nonce, now()]
  );
  if (!read.rows[0]) return null;
  await query('UPDATE siwe_nonces SET used_at = $2 WHERE id = $1', [read.rows[0].id, now()]);
  return {
    id: read.rows[0].id,
    walletAddress: read.rows[0].wallet_address,
    nonce: read.rows[0].nonce,
    message: read.rows[0].message,
    chainId: read.rows[0].chain_id,
    expiresAt: read.rows[0].expires_at,
  };
}

async function leaderboard(gamesCatalog) {
  if (!(await isDbEnabled())) return jsonStorage.leaderboard(gamesCatalog);
  const res = await query(
    `SELECT u.id, u.username, u.status, u.owned_cards, u.wins, u.deaths, u.last_seen_at,
            (SELECT COUNT(*) FROM death_registry dr WHERE dr.user_id = u.id) AS chain_deaths
     FROM users u
     WHERE u.role <> 'admin'`
  );
  return res.rows
    .map((row) => {
      const ownedCards = Array.isArray(row.owned_cards) ? row.owned_cards : [];
      return {
        username: row.username,
        status: row.status,
        cards: ownedCards.length,
        wins: row.wins || 0,
        deaths: row.deaths || 0,
        lastSeenAt: row.last_seen_at || 0,
        chainDeaths: parseInt(row.chain_deaths, 10) || 0,
        ownedCards: ownedCards.map((code) => {
          const card = gamesCatalog.find((game) => game.code === code);
          return card ? `${card.code} ${card.name}` : code;
        }),
      };
    })
    .sort(
      (a, b) =>
        b.cards - a.cards ||
        b.wins - a.wins ||
        a.deaths - b.deaths ||
        b.lastSeenAt - a.lastSeenAt ||
        a.username.localeCompare(b.username)
    );
}

async function recordGameHistory({ roomId, cardCode, winners, losers, summary }) {
  if (!(await isDbEnabled())) return null;
  const id = createId('game');
  await query(
    `INSERT INTO game_history (id, room_id, card_code, winners_json, losers_json, summary, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      roomId || '',
      cardCode || '',
      JSON.stringify(winners || []),
      JSON.stringify(losers || []),
      summary || '',
      now(),
    ]
  );
  return id;
}

function hashAccount(userId) {
  return `0x${sha256(userId)}`;
}

module.exports = {
  bootstrapAdmin,
  getUserById,
  getUserByUsername,
  getUserByWallet,
  createUser,
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
  recordGameHistory,
  hashAccount,
};
