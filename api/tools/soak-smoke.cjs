#!/usr/bin/env node
'use strict';

require('dotenv').config();

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const DURATION_MS = Math.max(10_000, Number(process.env.SOAK_DURATION_MS || 300_000));
const INTERVAL_MS = Math.max(100, Number(process.env.SOAK_INTERVAL_MS || 300));
const MAX_P95_MS = Number(process.env.SOAK_MAX_P95_MS || 400);
const MAX_RSS_GROWTH_MB = Number(process.env.SOAK_MAX_RSS_GROWTH_MB || 64);

const timings = [];
const errors = [];
const health = [];

async function request(path, token) {
  const started = Date.now();
  const response = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const ms = Date.now() - started;
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return { data: await response.json(), ms };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] || 0;
}

async function main() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'uat.admin@mahad.test', password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login -> ${login.status}`);
  const loginData = await login.json();
  let { token } = loginData;
  if (loginData?.totpRequired) {
    const secret = String(process.env.UAT_TOTP_SECRET || '');
    if (secret.length < 16) throw new Error('MFA challenge received without UAT_TOTP_SECRET');
    const { generate } = require('otplib');
    const verification = await fetch(`${API}/api/auth/2fa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pendingToken: loginData.pendingToken,
        token: await generate({ secret }),
      }),
    });
    if (!verification.ok) throw new Error(`2fa verify -> ${verification.status}`);
    ({ token } = await verification.json());
  }
  if (!token) throw new Error('login returned no token');

  const deadline = Date.now() + DURATION_MS;
  while (Date.now() < deadline) {
    const cycle = await Promise.allSettled([
      request('/api/admin/leads?limit=25', token),
      request('/api/health/detailed'),
    ]);
    if (cycle[0].status === 'fulfilled') timings.push(cycle[0].value.ms);
    else errors.push(cycle[0].reason.message);
    if (cycle[1].status === 'fulfilled') health.push(cycle[1].value.data);
    else errors.push(cycle[1].reason.message);
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }

  const initialRss = Number(health[0]?.rssMB || 0);
  const finalRss = Number(health.at(-1)?.rssMB || 0);
  const summary = {
    durationMs: DURATION_MS,
    cycles: timings.length,
    errors: errors.length,
    p95Ms: percentile(timings, 95),
    maxMs: Math.max(0, ...timings),
    rssGrowthMB: finalRss - initialRss,
    eventLoopP95MsMax: Math.max(0, ...health.map(row => Number(row.eventLoop?.p95Ms || 0))),
    dbPoolQueuedMax: Math.max(0, ...health.map(row => Number(row.dbPool?.queued || 0))),
  };
  const ok = errors.length === 0
    && summary.p95Ms <= MAX_P95_MS
    && summary.rssGrowthMB <= MAX_RSS_GROWTH_MB
    && summary.dbPoolQueuedMax === 0;
  console.log(JSON.stringify({
    ok,
    summary,
    thresholds: { maxP95Ms: MAX_P95_MS, maxRssGrowthMB: MAX_RSS_GROWTH_MB },
    errors: errors.slice(0, 10),
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.stack || error.message }, null, 2));
  process.exitCode = 1;
});
