const { getRedis } = require('../db/redis');

const localRoomVersions = new Map();
const localRoomEvents = new Map();
const localUserRoom = new Map();

function pushEventLocal(roomId, event) {
  const key = roomId;
  const list = localRoomEvents.get(key) || [];
  list.push(event);
  while (list.length > 50) list.shift();
  localRoomEvents.set(key, list);
}

async function nextRoomVersion(roomId) {
  const redis = getRedis();
  if (!redis) {
    const version = (localRoomVersions.get(roomId) || 0) + 1;
    localRoomVersions.set(roomId, version);
    return version;
  }
  return redis.incr(`room:${roomId}:version`);
}

async function storeRoomEvent(roomId, version, snapshot) {
  const event = { version, snapshot, at: Date.now() };
  const redis = getRedis();
  if (!redis) {
    pushEventLocal(roomId, event);
    return;
  }
  const key = `room:${roomId}:events`;
  await redis.rpush(key, JSON.stringify(event));
  await redis.ltrim(key, -50, -1);
}

async function getRoomEventsSince(roomId, sinceVersion) {
  const redis = getRedis();
  if (!redis) {
    return (localRoomEvents.get(roomId) || []).filter((item) => item.version > sinceVersion);
  }
  const key = `room:${roomId}:events`;
  const list = await redis.lrange(key, 0, -1);
  return list
    .map((item) => {
      try {
        return JSON.parse(item);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .filter((item) => item.version > sinceVersion);
}

async function bindUserRoom(userId, roomId) {
  const redis = getRedis();
  if (!redis) {
    localUserRoom.set(userId, roomId);
    return;
  }
  await redis.set(`user:${userId}:room`, roomId);
}

async function unbindUserRoom(userId) {
  const redis = getRedis();
  if (!redis) {
    localUserRoom.delete(userId);
    return;
  }
  await redis.del(`user:${userId}:room`);
}

async function getUserRoom(userId) {
  const redis = getRedis();
  if (!redis) return localUserRoom.get(userId) || null;
  return (await redis.get(`user:${userId}:room`)) || null;
}

module.exports = {
  nextRoomVersion,
  storeRoomEvent,
  getRoomEventsSince,
  bindUserRoom,
  unbindUserRoom,
  getUserRoom,
};
