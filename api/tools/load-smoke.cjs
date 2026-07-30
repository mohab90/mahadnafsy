#!/usr/bin/env node
'use strict';

require('dotenv').config();

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const CONCURRENCY = Number(process.env.LOAD_SMOKE_CONCURRENCY || 8);
const LOGIN_RUNS = Number(process.env.LOAD_SMOKE_LOGIN_RUNS || 24);
const LEADS_RUNS = Number(process.env.LOAD_SMOKE_LEADS_RUNS || 24);
const PAYMENT_RUNS = Number(process.env.LOAD_SMOKE_PAYMENT_RUNS || 3);
const PROFILE_INTERVAL_MS = Number(process.env.LOAD_SMOKE_PROFILE_INTERVAL_MS || 250);
const MAX_P95 = {
  login: Number(process.env.LOAD_SMOKE_LOGIN_MAX_P95_MS || 3000),
  admin: Number(process.env.LOAD_SMOKE_API_MAX_P95_MS || 500),
  payment: Number(process.env.LOAD_SMOKE_PAYMENT_MAX_P95_MS || 1000),
};
const LOGIN_ACCOUNTS = String(process.env.LOAD_SMOKE_LOGIN_ACCOUNTS || [
  'uat.manager@mahad.test',
  'uat.online-manager@mahad.test',
  'uat.sales-manager@mahad.test',
  'uat.sales@mahad.test',
  'uat.collection@mahad.test',
  'uat.support-online@mahad.test',
  'uat.support-daqqi@mahad.test',
  'uat.reception-daqqi@mahad.test',
  'uat.daqqi-manager@mahad.test',
  'uat.hr-manager@mahad.test',
  'uat.recruiter@mahad.test',
  'uat.consultant@mahad.test',
  'uat.expert@mahad.test',
  'uat.trainer@mahad.test',
  'uat.instructor@mahad.test',
  'uat.other@mahad.test',
].join(',')).split(',').map(value => value.trim()).filter(Boolean);

const timings = [];
const errors = [];
const profileSamples = [];

async function timed(name, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    timings.push({ name, ms: Date.now() - t0, ok: true });
    return result;
  } catch (error) {
    timings.push({ name, ms: Date.now() - t0, ok: false });
    errors.push({ name, error: error.message });
    throw error;
  }
}

async function api(path, { method = 'GET', token, body, expected = [200] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(res.status)) {
    const snippet = typeof data === 'string' ? data.slice(0, 250) : JSON.stringify(data).slice(0, 250);
    throw new Error(`${method} ${path} -> ${res.status}; ${snippet}`);
  }
  return data;
}

async function login(email) {
  const data = await timed(`login:${email}`, async () => {
    const first = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });
    if (!first?.totpRequired) return first;
    const secret = String(process.env.UAT_TOTP_SECRET || '');
    if (secret.length < 16) throw new Error(`MFA challenge received for ${email} without UAT_TOTP_SECRET`);
    const { generate } = require('otplib');
    return api('/api/auth/2fa/verify', {
      method: 'POST',
      body: { pendingToken: first.pendingToken, token: await generate({ secret }) },
    });
  });
  if (!data?.token) throw new Error(`No token for ${email}`);
  return data.token;
}

async function runPool(items, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

(async () => {
  const profileTimer = setInterval(async () => {
    try {
      profileSamples.push(await api('/api/health/detailed'));
    } catch {
      // The request-level error counters remain authoritative for the load gate.
    }
  }, PROFILE_INTERVAL_MS);
  profileTimer.unref?.();

  const adminToken = await login('uat.admin@mahad.test');
  const accountantToken = await login('uat.accountant@mahad.test');
  const configuredSubscriberIds = String(process.env.LOAD_SMOKE_SUBSCRIBER_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const subscriberRows = configuredSubscriberIds.length
    ? []
    : await api('/api/admin/subscribers?limit=100', { token: adminToken });
  const subscriberIds = configuredSubscriberIds.length
    ? configuredSubscriberIds
    : (Array.isArray(subscriberRows) ? subscriberRows : subscriberRows?.items || [])
      .map(row => row?.id).filter(Boolean);
  if (!subscriberIds.length) subscriberIds.push('uat-student-client');

  // One account cannot complete two MFA challenges concurrently: the first
  // successful login deliberately rotates its single active session. Run
  // accounts concurrently, while keeping attempts for each account serial.
  await runPool(LOGIN_ACCOUNTS, async (email) => {
    const attempts = Math.floor(LOGIN_RUNS / LOGIN_ACCOUNTS.length)
      + (LOGIN_ACCOUNTS.indexOf(email) < LOGIN_RUNS % LOGIN_ACCOUNTS.length ? 1 : 0);
    for (let index = 0; index < attempts; index += 1) await login(email);
  });

  await runPool(Array.from({ length: LEADS_RUNS }, (_, i) => i), async () => {
    await timed('admin:leads', () => api('/api/admin/leads?limit=25', { token: adminToken }));
  });

  await runPool(Array.from({ length: PAYMENT_RUNS }, (_, i) => i), async (i) => {
    await timed('payment:create', () => api('/api/admin/subscriber-payments', {
      method: 'POST',
      token: accountantToken,
      body: {
        subscriber_id: subscriberIds[i % subscriberIds.length],
        payment: {
          id: `load-pay-${Date.now().toString(36)}-${i}`,
          amount: 1,
          currency: 'EGP',
          paymentType: 'COURSE',
          paymentMethod: 'cash',
          transactionId: `LOAD-TXN-${Date.now()}-${i}`,
          status: 'paid',
          source: 'staff',
          note: 'load smoke',
        },
      },
    }));
  });
  clearInterval(profileTimer);
  try { profileSamples.push(await api('/api/health/detailed')); } catch {}

  const byName = timings.reduce((acc, timing) => {
    const key = timing.name.split(':')[0];
    if (!acc[key]) acc[key] = [];
    acc[key].push(timing);
    return acc;
  }, {});
  const summary = Object.fromEntries(Object.entries(byName).map(([name, rows]) => {
    const ms = rows.map((r) => r.ms);
    return [name, {
      count: rows.length,
      errors: rows.filter((r) => !r.ok).length,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      max: Math.max(...ms),
    }];
  }));

  const thresholdFailures = Object.entries(MAX_P95)
    .filter(([name, max]) => summary[name] && summary[name].p95 > max)
    .map(([name, max]) => ({ name, p95: summary[name].p95, max }));
  const ok = errors.length === 0 && thresholdFailures.length === 0;
  const profile = {
    samples: profileSamples.length,
    cpuAveragePercentMax: Math.max(0, ...profileSamples.map(sample => Number(sample.cpuAveragePercent || 0))),
    eventLoopP95MsMax: Math.max(0, ...profileSamples.map(sample => Number(sample.eventLoop?.p95Ms || 0))),
    eventLoopMaxMs: Math.max(0, ...profileSamples.map(sample => Number(sample.eventLoop?.maxMs || 0))),
    dbPoolActiveMax: Math.max(0, ...profileSamples.map(sample => Number(sample.dbPool?.active || 0))),
    dbPoolQueuedMax: Math.max(0, ...profileSamples.map(sample => Number(sample.dbPool?.queued || 0))),
    rssMBMax: Math.max(0, ...profileSamples.map(sample => Number(sample.rssMB || 0))),
  };
  console.log(JSON.stringify({ ok, summary, thresholds: MAX_P95, thresholdFailures, profile, errors }, null, 2));
  if (!ok) process.exit(1);
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, errors }, null, 2));
  process.exit(1);
});
