const Redis = require('ioredis');
const config = require('../config');

let redis = null;

function getRedis() {
  if (!config.redisUrl) return null;
  if (!redis) redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  return redis;
}

module.exports = {
  getRedis,
};
