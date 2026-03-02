CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'ALIVE',
  can_bypass_death BOOLEAN NOT NULL DEFAULT FALSE,
  owned_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  wins INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  linked_at BIGINT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, wallet_address, chain_id),
  UNIQUE (wallet_address, chain_id)
);

CREATE TABLE IF NOT EXISTS death_registry (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  card_code TEXT NOT NULL,
  room_id TEXT NOT NULL,
  wallet_address TEXT,
  died_at BIGINT NOT NULL,
  reason TEXT NOT NULL,
  chain_status TEXT NOT NULL DEFAULT 'pending',
  chain_tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS death_chain_jobs (
  id TEXT PRIMARY KEY,
  death_registry_id TEXT NOT NULL REFERENCES death_registry(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  last_error TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wins INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  cards_count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_history (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  card_code TEXT NOT NULL,
  winners_json JSONB NOT NULL,
  losers_json JSONB NOT NULL,
  summary TEXT NOT NULL,
  finished_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS siwe_nonces (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_death_registry_user ON death_registry(user_id);
CREATE INDEX IF NOT EXISTS idx_death_registry_chain ON death_registry(chain_status);
CREATE INDEX IF NOT EXISTS idx_siwe_nonce_wallet ON siwe_nonces(wallet_address);
CREATE INDEX IF NOT EXISTS idx_siwe_nonce_nonce ON siwe_nonces(nonce);
