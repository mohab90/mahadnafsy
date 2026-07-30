#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const {
  closeRedis,
  distributedRateLimitStore,
  isDistributedEnabled,
  redisHealth,
} = require('../lib/rateLimitStore');

async function main() {
  assert.equal(isDistributedEnabled(), true, 'distributed Redis must be enabled');
  const before = await redisHealth({ writeProbe: true });
  assert.equal(before.ok, true, `Redis is not a writable primary: ${JSON.stringify(before)}`);

  const store = distributedRateLimitStore('readiness-smoke');
  store.init({ windowMs: 60_000 });
  const key = `tenant-smoke:${process.pid}:${Date.now()}`;
  const first = await store.increment(key);
  const second = await store.increment(key);
  assert.equal(Number(first.totalHits), 1, 'first distributed counter increment must equal 1');
  assert.equal(Number(second.totalHits), 2, 'second distributed counter increment must equal 2');
  await store.resetKey(key);

  // Force a complete client recycle. The next probe reconnects through the
  // configured endpoint, matching the application path after primary replacement.
  await closeRedis();
  const reconnected = await redisHealth({ writeProbe: true });
  assert.equal(reconnected.ok, true, `Redis did not recover after client recycle: ${JSON.stringify(reconnected)}`);

  console.log(JSON.stringify({
    ok: true,
    primary: before.role,
    latencyMs: before.latencyMs,
    counter: [Number(first.totalHits), Number(second.totalHits)],
    reconnectLatencyMs: reconnected.latencyMs,
  }, null, 2));
}

main()
  .catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.stack || error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => closeRedis().catch(() => {}));
