#!/usr/bin/env node
'use strict';

const passwordHash = require('../lib/passwordHash');

const concurrency = Number(process.env.PASSWORD_BENCH_CONCURRENCY || 24);
const maxP95 = Number(process.env.PASSWORD_BENCH_MAX_P95_MS || 3000);
const maxEventLoopLag = Number(process.env.PASSWORD_BENCH_MAX_LOOP_LAG_MS || 100);
const password = 'MahadBenchmark#2026';

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] || 0;
}

(async () => {
  const hash = await passwordHash.hash(password);
  let ticks = 0;
  let maxLagMs = 0;
  let expected = Date.now() + 10;
  const timer = setInterval(() => {
    const now = Date.now();
    maxLagMs = Math.max(maxLagMs, now - expected);
    expected = now + 10;
    ticks += 1;
  }, 10);

  const started = Date.now();
  const timings = await Promise.all(Array.from({ length: concurrency }, async () => {
    const requestStarted = Date.now();
    if (!await passwordHash.compare(password, hash)) throw new Error('bcrypt comparison failed');
    return Date.now() - requestStarted;
  }));
  clearInterval(timer);

  const result = {
    engine: passwordHash.engine,
    concurrency,
    totalMs: Date.now() - started,
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    max: Math.max(...timings),
    eventLoopTicks: ticks,
    maxEventLoopLagMs: maxLagMs,
  };
  result.ok = result.engine === 'bcrypt-native'
    && result.p95 <= maxP95
    && result.maxEventLoopLagMs <= maxEventLoopLag;
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
