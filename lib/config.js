function asBool(value, fallback = false) {
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
}

function asInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  port: asInt(process.env.PORT, 3100),
  jwtSecret: process.env.JWT_SECRET || 'borderland-local-secret',
  readDb: asBool(process.env.READ_DB, !!process.env.DATABASE_URL),
  writeJson: asBool(process.env.WRITE_JSON, true),
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  rpcUrl: process.env.RPC_URL || '',
  deathRegistryAddress: process.env.DEATH_REGISTRY_ADDRESS || '',
  chainId: asInt(process.env.CHAIN_ID, 1),
  siweAllowedChainIds: String(process.env.SIWE_ALLOWED_CHAIN_IDS || '1')
    .split(',')
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value)),
};
