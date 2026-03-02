const { loadUsers, loadRegistry } = require('../lib/storage');
const { query } = require('../lib/db/postgres');
const { createId } = require('../lib/helpers');

async function upsertUser(user) {
  await query(
    `INSERT INTO users (id, username, password_hash, role, status, can_bypass_death, owned_cards, wins, deaths, created_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE
     SET username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         can_bypass_death = EXCLUDED.can_bypass_death,
         owned_cards = EXCLUDED.owned_cards,
         wins = EXCLUDED.wins,
         deaths = EXCLUDED.deaths,
         created_at = EXCLUDED.created_at,
         last_seen_at = EXCLUDED.last_seen_at`,
    [
      user.id,
      user.username,
      user.passwordHash,
      user.role || 'player',
      user.status || 'ALIVE',
      !!user.canBypassDeath,
      JSON.stringify(user.ownedCards || []),
      user.wins || 0,
      user.deaths || 0,
      user.createdAt || Date.now(),
      user.lastSeenAt || Date.now(),
    ]
  );
}

async function upsertLeaderboard(user) {
  await query(
    `INSERT INTO leaderboard_stats (user_id, wins, deaths, cards_count, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE
     SET wins = EXCLUDED.wins, deaths = EXCLUDED.deaths, cards_count = EXCLUDED.cards_count, updated_at = EXCLUDED.updated_at`,
    [user.id, user.wins || 0, user.deaths || 0, (user.ownedCards || []).length, Date.now()]
  );
}

async function upsertDeathLog(log) {
  await query(
    `INSERT INTO death_registry (id, user_id, username, card_code, room_id, wallet_address, died_at, reason, chain_status, chain_tx_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      log.id || createId('death'),
      log.userId,
      log.username || '',
      log.cardCode || '',
      log.roomId || '',
      log.walletAddress || null,
      log.diedAt || log.at || Date.now(),
      log.reason || 'ELIMINATED',
      log.chainStatus || 'pending',
      log.chainTxHash || null,
    ]
  );
}

async function main() {
  const users = loadUsers();
  const registry = loadRegistry();
  for (const user of users) {
    await upsertUser(user);
    await upsertLeaderboard(user);
  }
  for (const log of registry.logs || []) {
    await upsertDeathLog(log);
  }
  process.stdout.write(`Imported users=${users.length}, deaths=${(registry.logs || []).length}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
