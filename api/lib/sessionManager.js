'use strict';

const inMemorySessions = new Map();

function getRedisClient() {
  try {
    return require('./redis').redisClient || null;
  } catch (err) {
    return null;
  }
}

function rememberInMemory(userId, token, expiresInSeconds) {
  const key = String(userId);
  const current = inMemorySessions.get(key) || new Map();
  current.set(token, Date.now() + (Number(expiresInSeconds) || 86400 * 30) * 1000);
  inMemorySessions.set(key, current);
}

function cleanupExpired(userId) {
  const sessions = inMemorySessions.get(String(userId));
  if (!sessions) return sessions;
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) sessions.delete(token);
  }
  return sessions;
}

async function registerSession(userId, token, expiresInSeconds) {
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.sadd(`sessions:${userId}`, token);
    await redisClient.expire(`sessions:${userId}`, expiresInSeconds || 86400 * 30);
    return;
  }
  rememberInMemory(userId, token, expiresInSeconds);
}

async function isSessionActive(userId, token) {
  const redisClient = getRedisClient();
  if (redisClient) {
    const isMember = await redisClient.sismember(`sessions:${userId}`, token);
    return isMember === 1;
  }
  const sessions = cleanupExpired(userId);
  return !sessions || sessions.size === 0 || sessions.has(token);
}

async function revokeAllSessions(userId) {
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.del(`sessions:${userId}`);
    return;
  }
  inMemorySessions.delete(String(userId));
}

async function revokeSession(userId, token) {
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.srem(`sessions:${userId}`, token);
    return;
  }
  cleanupExpired(userId)?.delete(token);
}

module.exports = {
  registerSession,
  isSessionActive,
  revokeAllSessions,
  revokeSession,
};
