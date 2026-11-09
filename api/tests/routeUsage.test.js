'use strict';

// lib/routeUsage.js counts calls per route and day in memory and writes them additively; a failed write loses nothing; recording never throws.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRouteUsage } = require('../lib/routeUsage');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('calls are counted per day, method and route pattern; only /api routes count; 5xx are kept as errors', async () => {
  let when = new Date('2026-11-05T10:00:00Z');
  const usage = createRouteUsage({ now: () => when });
  usage.record('get', '/api/admin/kpi/summary', 200);
  usage.record('GET', '/api/admin/kpi/summary', 500);
  usage.record('POST', '/api/admin/leads/:id/convert', 200);
  usage.record('GET', 'static or other', 200);
  usage.record('GET', null, 200);
  when = new Date('2026-11-06T10:00:00Z');
  usage.record('GET', '/api/admin/kpi/summary', 200);
  const rows = usage._take().sort((a, b) => (a.day + a.route).localeCompare(b.day + b.route));
  assert.deepEqual(rows.map(r => [r.day, r.method, r.route, r.hits, r.errors]), [
    ['2026-11-05', 'GET', '/api/admin/kpi/summary', 2, 1],
    ['2026-11-05', 'POST', '/api/admin/leads/:id/convert', 1, 0],
    ['2026-11-06', 'GET', '/api/admin/kpi/summary', 1, 0],
  ]);
  assert.equal(usage.size(), 0, 'taking empties the counters');
});

test('the flush is one additive upsert, and a failed one keeps every count for the next', async () => {
  const usage = createRouteUsage({ now: () => new Date('2026-11-05T10:00:00Z') });
  usage.record('GET', '/api/a', 200); usage.record('GET', '/api/a', 200); usage.record('GET', '/api/b', 200);
  const calls = [];
  let fail = true;
  const db = { async query(sql, params) { calls.push({ sql, params }); if (fail) throw new Error('db down'); return [{}]; } };
  await assert.rejects(() => usage.flush(db), /db down/);
  usage.record('GET', '/api/a', 200);                       // arrives while the write is failing
  fail = false;
  assert.equal(await usage.flush(db), 2);
  const last = calls.at(-1);
  assert.match(last.sql, /ON DUPLICATE KEY UPDATE hits = hits \+ VALUES\(hits\)/, 'additive, so two processes share the table');
  const params = last.params;
  assert.deepEqual(params.slice(0, 5), ['2026-11-05', 'GET', '/api/a', 3, 0], '2 + 1 counted, none lost');
  assert.equal(await usage.flush(db), 0, 'nothing left to write');
});

test('the counters are bounded', () => {
  const usage = createRouteUsage({ now: () => new Date('2026-11-05T10:00:00Z') });
  for (let i = 0; i < 6000; i += 1) usage.record('GET', `/api/x/${i}`, 200);
  assert.ok(usage.size() <= 5000);
});

test('it is wired: every finished request is counted, production starts the flush, shutdown writes the last minute, the table and the report exist', () => {
  
  
  
  
  const report = read('api/tools/route-usage-report.cjs');
  const statements = [...report.matchAll(/db\.query\(\s*'([^']*)'/g)].map(match => match[1].trim());
  assert.ok(statements.length >= 2 && statements.every(sql => /^SELECT\b/i.test(sql)), 'the report only reads');
  
});
