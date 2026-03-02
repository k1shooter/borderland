const { getRedis } = require('../db/redis');

const localCounters = new Map();

function localTake(key, limit, windowMs) {
  const now = Date.now();
  const existing = localCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    localCounters.set(key, { count: 1, expiresAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  existing.count += 1;
  if (existing.count > limit) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: Math.max(0, limit - existing.count) };
}

async function takeRateLimit(scope, id, limit, windowMs) {
  const key = `rate:${scope}:${id}`;
  const redis = getRedis();
  if (!redis) return localTake(key, limit, windowMs);
  const tx = redis.multi();
  tx.incr(key);
  tx.pexpire(key, windowMs, 'NX');
  const result = await tx.exec();
  const current = parseInt(result[0][1], 10);
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
  };
}

module.exports = {
  takeRateLimit,
};
