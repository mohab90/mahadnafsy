#!/usr/bin/env node
'use strict';

// A burst on the public lead form against a running API, then its health.
//
// On 20 Oct 2026 forty lead forms at once held every pool connection and the
// API stopped answering until it was restarted. CI starts the API and runs
// this after the integration tests, so a change that brings that back fails
// the build instead of the next campaign. No accounts or secrets are needed:
// the form is public. tools/load-smoke.cjs is the heavier, signed-in run.
//
//   API_BASE_URL=http://127.0.0.1:3105 node tools/public-burst-smoke.cjs
//
// Fails on any request that errors, times out or answers 5xx, or when
// /api/health is not ok afterwards. 409 (already being processed) and 429
// (the per-minute limit) are the API protecting itself, so they pass.

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3105').replace(/\/$/, '');
const REQUESTS = Math.max(1, Number(process.env.BURST_SMOKE_REQUESTS || 40));
const TIMEOUT_MS = Math.max(1000, Number(process.env.BURST_SMOKE_TIMEOUT_MS || 30000));
const run = Date.now().toString().slice(-6);

async function lead(i) {
  const started = Date.now();
  try {
    const res = await fetch(`${API}/api/leads-public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Burst smoke ${i}`, phone: `0109${run}${String(i).padStart(2, '0')}`, source: 'ci-burst-smoke' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.text();
    return { status: res.status, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: error.name === 'TimeoutError' ? 'timeout' : error.message };
  }
}

async function health() {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (error) {
    return { status: 0, body: { error: error.message } };
  }
}

(async () => {
  const results = await Promise.all(Array.from({ length: REQUESTS }, (_, i) => lead(i)));
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  console.log(`[burst] ${REQUESTS} lead forms at once → ${JSON.stringify(byStatus)}, p95 ${p95} ms, slowest ${times.at(-1)} ms`);

  const failures = results.filter(r => r.status === 0 || r.status >= 500);
  for (const f of failures.slice(0, 5)) console.error(`[burst] failed: ${f.status || f.error} after ${f.ms} ms`);
  const filed = byStatus[200] || 0;
  const after = await health();
  console.log(`[burst] /api/health afterwards → ${after.status} ${JSON.stringify(after.body).slice(0, 200)}`);

  const problems = [];
  if (failures.length) problems.push(`${failures.length} request(s) errored, timed out or answered 5xx`);
  if (!filed) problems.push('no lead form was filed at all');
  if (after.status !== 200 || after.body?.status !== 'ok') problems.push('the API is not healthy after the burst');
  if (problems.length) {
    console.error(`[burst] FAILED: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('[burst] OK');
})();
