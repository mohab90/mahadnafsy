#!/usr/bin/env node
'use strict';

require('dotenv').config();

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const CONCURRENCY = Number(process.env.LOAD_SMOKE_CONCURRENCY || 8);
const LOGIN_RUNS = Number(process.env.LOAD_SMOKE_LOGIN_RUNS || 24);
const LEADS_RUNS = Number(process.env.LOAD_SMOKE_LEADS_RUNS || 24);
const PAYMENT_RUNS = Number(process.env.LOAD_SMOKE_PAYMENT_RUNS || 3);

const timings = [];
const errors = [];

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
  const data = await timed(`login:${email}`, () => api('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  }));
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
  const adminToken = await login('uat.admin@mahad.test');
  const accountantToken = await login('uat.accountant@mahad.test');

  await runPool(Array.from({ length: LOGIN_RUNS }, (_, i) => i), async (i) => {
    const email = i % 3 === 0 ? 'uat.sales@mahad.test' : i % 3 === 1 ? 'uat.collection@mahad.test' : 'uat.online-manager@mahad.test';
    await login(email);
  });

  await runPool(Array.from({ length: LEADS_RUNS }, (_, i) => i), async () => {
    await timed('admin:leads', () => api('/api/admin/leads?limit=25', { token: adminToken }));
  });

  for (let i = 0; i < PAYMENT_RUNS; i++) {
    await timed('payment:create', () => api('/api/admin/subscriber-payments', {
      method: 'POST',
      token: accountantToken,
      body: {
        subscriber_id: 'uat-student-client',
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
  }

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

  console.log(JSON.stringify({ ok: errors.length === 0, summary, errors }, null, 2));
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, errors }, null, 2));
  process.exit(1);
});
