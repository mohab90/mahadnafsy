'use strict';

const logger = require('./logger').child({ module: 'rate-limit-store' });

let client;

function redisClient() {
  if (client) return client;
  const Redis = require('ioredis');
  client = new Redis(process.env.REDIS_URL, {
    // RedisStore loads its Lua script while the client is still connecting.
    // Keep only that short startup queue; maxRetriesPerRequest still fails
    // requests closed when Redis is unavailable after startup.
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    // Keep reconnecting to a managed primary after a node replacement while
    // maxRetriesPerRequest makes individual HTTP requests fail closed quickly.
    retryStrategy: times => Math.min(times * 100, 2000),
    reconnectOnError: error => (/READONLY/i.test(error.message || '') ? 2 : false),
  });
  client.on('error', error => logger.error('distributed limiter Redis error', { error: error.message }));
  return client;
}

function isDistributedEnabled() {
  return process.env.RATE_LIMIT_REDIS_ENABLED === 'true' && Boolean(process.env.REDIS_URL);
}

function distributedRateLimitStore(prefix) {
  if (process.env.RATE_LIMIT_REDIS_ENABLED !== 'true') return undefined;
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required when RATE_LIMIT_REDIS_ENABLED=true');
  const { RedisStore } = require('rate-limit-redis');
  const redis = redisClient();
  return new RedisStore({
    prefix: `mahad:rate:${prefix}:`,
    sendCommand: (...args) => redis.call(...args),
  });
}

async function redisHealth({ writeProbe = false } = {}) {
  if (!isDistributedEnabled()) {
    return { ok: false, enabled: false, status: 'disabled' };
  }
  const redis = redisClient();
  const started = Date.now();
  try {
    const reply = await redis.ping();
    let writable = null;
    let role = null;
    if (writeProbe) {
      const probeKey = `mahad:health:${process.pid}:${Date.now()}`;
      const probeValue = `${Date.now()}`;
      const setReply = await redis.set(probeKey, probeValue, 'PX', 5000, 'NX');
      const stored = setReply === 'OK' ? await redis.get(probeKey) : null;
      await redis.del(probeKey).catch(() => {});
      writable = setReply === 'OK' && stored === probeValue;
      const roleReply = await redis.call('ROLE');
      role = Array.isArray(roleReply) ? String(roleReply[0] || '').toLowerCase() : null;
    }
    return {
      ok: reply === 'PONG' && (!writeProbe || (writable && role === 'master')),
      enabled: true,
      status: redis.status,
      latencyMs: Date.now() - started,
      ...(writeProbe ? { writable, role } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      status: redis.status,
      latencyMs: Date.now() - started,
      error: error.code || error.message,
    };
  }
}

async function closeRedis() {
  if (!client) return;
  const current = client;
  client = null;
  await current.quit().catch(() => current.disconnect());
}

module.exports = {
  closeRedis,
  distributedRateLimitStore,
  isDistributedEnabled,
  redisClient,
  redisHealth,
};
