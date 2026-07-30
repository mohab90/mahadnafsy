'use strict';

const { isDistributedEnabled, redisClient } = require('./rateLimitStore');

const onlineMap = new Map();
const keyFor = (tenantId, uid) => `${tenantId}:${uid}`;
const hashKey = tenantId => `mahad:presence:${tenantId}:users`;
const timeKey = tenantId => `mahad:presence:${tenantId}:seen`;

async function setOnlineUser(tenantId, uid, data) {
  const record = {
    name: String(data.name || '').slice(0, 100),
    email: String(data.email || '').slice(0, 320),
    lastSeen: Date.now(),
  };
  if (!isDistributedEnabled()) {
    onlineMap.set(keyFor(tenantId, uid), record);
    return;
  }
  const redis = redisClient();
  await redis.pipeline()
    .hset(hashKey(tenantId), uid, JSON.stringify(record))
    .zadd(timeKey(tenantId), record.lastSeen, uid)
    .expire(hashKey(tenantId), 300)
    .expire(timeKey(tenantId), 300)
    .exec();
}

async function listOnlineUsers(tenantId, maxAgeMs = 2 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  if (!isDistributedEnabled()) {
    const users = [];
    for (const [key, data] of onlineMap.entries()) {
      if (!key.startsWith(`${tenantId}:`) || data.lastSeen < cutoff) continue;
      users.push({ uid: key.slice(tenantId.length + 1), ...data });
    }
    return users;
  }
  const redis = redisClient();
  await redis.zremrangebyscore(timeKey(tenantId), '-inf', cutoff);
  const ids = await redis.zrangebyscore(timeKey(tenantId), cutoff, '+inf');
  if (!ids.length) return [];
  const records = await redis.hmget(hashKey(tenantId), ...ids);
  return records.flatMap((raw, index) => {
    if (!raw) return [];
    try { return [{ uid: ids[index], ...JSON.parse(raw) }]; }
    catch { return []; }
  });
}

function cleanupMemoryPresence(maxAgeMs = 5 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, data] of onlineMap.entries()) {
    if (data.lastSeen < cutoff) onlineMap.delete(key);
  }
}

module.exports = { cleanupMemoryPresence, listOnlineUsers, onlineMap, setOnlineUser };
