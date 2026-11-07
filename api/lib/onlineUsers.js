'use strict';

const { isDistributedEnabled, redisClient } = require('./rateLimitStore');
const { multiInstance } = require('./processRole');

// Several web instances without Redis: the heartbeat lands in whichever process
// answered it, so presence lives in the database they share (migration 332).
const inDatabase = () => !isDistributedEnabled() && multiInstance();
const db = () => require('./db').pool;

const onlineMap = new Map();
const keyFor = (tenantId, uid) => `${tenantId}:${uid}`;
const hashKey = tenantId => `mahad:presence:${tenantId}:users`;
const timeKey = tenantId => `mahad:presence:${tenantId}:seen`;

async function setOnlineUser(tenantId, uid, data) {
  const record = {
    name: String(data.name || '').slice(0, 100),
    email: String(data.email || '').slice(0, 320),
    // Where the client is (the tab of their account page) and, in the lecture player, which course.
    page: String(data.page || '').slice(0, 64),
    courseId: String(data.courseId || '').slice(0, 64),
    lastSeen: Date.now(),
  };
  if (inDatabase()) {
    await db().query(
      `INSERT INTO online_presence (tenant_id, uid, name, email, page, course_id, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), page=VALUES(page), course_id=VALUES(course_id), last_seen=VALUES(last_seen)`,
      [tenantId, String(uid).slice(0, 100), record.name, record.email, record.page || null, record.courseId || null, new Date(record.lastSeen)]);
    return;
  }
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
  if (inDatabase()) {
    const [rows] = await db().query(
      'SELECT uid, name, email, page, course_id, last_seen FROM online_presence WHERE tenant_id=? AND last_seen >= ?', [tenantId, new Date(cutoff)]);
    return rows.map(row => ({
      uid: row.uid, name: row.name || '', email: row.email || '', page: row.page || '', courseId: row.course_id || '', lastSeen: new Date(row.last_seen).getTime(),
    }));
  }
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
  if (inDatabase()) {
    db().query('DELETE FROM online_presence WHERE last_seen < ? LIMIT 5000', [new Date(cutoff)]).catch(() => {});
  }
  for (const [key, data] of onlineMap.entries()) {
    if (data.lastSeen < cutoff) onlineMap.delete(key);
  }
}

module.exports = { cleanupMemoryPresence, listOnlineUsers, onlineMap, setOnlineUser };
