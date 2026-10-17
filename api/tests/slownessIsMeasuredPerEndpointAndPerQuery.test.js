'use strict';
/**
 * «السيستم بطيء جدا … عاوز علاج نهائي» (17 Oct 2026).
 *
 * A slow screen could only be guessed at: the access log had a duration and nothing about the
 * database, the number of queries, the size of the answer or which query was slow. The server now
 * keeps that per endpoint (lib/performanceMonitor.js) and «مراقبة السيرفر» shows it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-slowness-secret-0123456789-abcdefghijklmnop';
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const monitor = require('../lib/performanceMonitor');

test('a query is one shape whatever its ids and lists are', () => {
  assert.equal(
    monitor.shapeOf("SELECT * FROM leads WHERE id = 'abc-123' AND n > 40  AND s IN ('a','b','c')"),
    'SELECT * FROM leads WHERE id = ? AND n > ? AND s IN (?…)',
  );
  assert.equal(monitor.shapeOf('x'.repeat(500)).length, 200, 'a long statement is cut');
});

test('queries made inside a request are counted against it, and a slow one is remembered', () => {
  monitor.reset();
  monitor.runInRequest(store => {
    monitor.recordQuery('SELECT 1', 3);
    monitor.recordQuery("SELECT * FROM join_us_applications WHERE tenant_id = 'x'", monitor.SLOW_QUERY_MS + 100);
    assert.equal(store.queries, 2);
    assert.ok(store.dbMs >= monitor.SLOW_QUERY_MS + 103);
    monitor.recordRequest({ method: 'GET', route: '/api/admin/join-us', status: 200, ms: 900, bytes: 20480, store });
  });
  const snapshot = monitor.snapshot();
  const row = snapshot.slowest.find(entry => entry.route === 'GET /api/admin/join-us');
  assert.deepEqual({ count: row.count, avgQueries: row.avgQueries, avgKb: row.avgKb, p95: row.p95 }, { count: 1, avgQueries: 2, avgKb: 20, p95: 900 });
  assert.equal(snapshot.slowQueries.length, 1, 'only the slow query is kept');
  assert.equal(snapshot.slowQueries[0].shape, 'SELECT * FROM join_us_applications WHERE tenant_id = ?');
});

test('the 95th percentile is what the slow one in twenty waits, and the slowest endpoint comes first', () => {
  monitor.reset();
  for (let i = 1; i <= 100; i++) monitor.recordRequest({ method: 'GET', route: '/api/fast', status: 200, ms: 20, bytes: 100 });
  for (let i = 1; i <= 100; i++) monitor.recordRequest({ method: 'GET', route: '/api/mostly-fast', status: 200, ms: i === 100 ? 4000 : 50, bytes: 100 });
  for (let i = 1; i <= 100; i++) monitor.recordRequest({ method: 'GET', route: '/api/slow', status: i % 10 === 0 ? 500 : 200, ms: 100 + i * 20, bytes: 100 });
  const { slowest } = monitor.snapshot();
  assert.deepEqual(slowest.map(row => row.route), ['GET /api/slow', 'GET /api/mostly-fast', 'GET /api/fast']);
  assert.equal(slowest[0].errors, 10);
  assert.equal(slowest[1].p95, 50, 'one outlier in a hundred is not the 95th percentile');
  assert.equal(slowest[1].max, 4000, 'but it is still the maximum');
});

test('what is kept is bounded', () => {
  monitor.reset();
  for (let i = 0; i < 1000; i++) monitor.recordRequest({ method: 'GET', route: `/api/r${i}`, status: 200, ms: 1, bytes: 1 });
  assert.ok(monitor.snapshot({ limit: 1000 }).slowest.length <= 400);
  for (let i = 0; i < 500; i++) monitor.recordQuery(`SELECT ${'a'.repeat(i % 50)} FROM t${i}`, monitor.SLOW_QUERY_MS + 1);
  assert.ok(monitor.snapshot({ limit: 1000 }).slowQueries.length <= 300);
});

test('the request middleware records the route pattern, the bytes and the queries of a real response', async () => {
  monitor.reset();
  const express = require('express');
  const compression = require('compression');
  const { timeRequests } = require('../lib/httpApp');
  const app = express();
  app.use(compression());
  app.use(timeRequests);
  app.get('/api/things/:id', async (req, res) => {
    monitor.recordQuery('SELECT * FROM things WHERE id = 1', 5);
    await new Promise(resolve => setTimeout(resolve, 5));
    monitor.recordQuery('SELECT * FROM parts WHERE thing_id = 1', 7);
    res.json({ rows: 'x'.repeat(2000) });
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    await new Promise((resolve, reject) => http.get({ port, host: '127.0.0.1', path: '/api/things/42?x=1', headers: { 'accept-encoding': 'gzip' } }, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
    await new Promise(resolve => setTimeout(resolve, 30));
  } finally { server.close(); }
  const row = monitor.snapshot().slowest.find(entry => entry.route === 'GET /api/things/:id');
  assert.ok(row, 'recorded under the pattern, not the URL with its id');
  assert.equal(row.count, 1);
  assert.equal(row.avgQueries, 2, 'queries made after an await still belong to the request');
  assert.ok(row.avgKb >= 1.9, 'the size is what the handler wrote, before compression');
});

test('the monitoring route and the screen exist, and the database layer feeds the monitor', () => {
  const routes = read('api/routes/monitoring.js');
  assert.match(routes, /router\.get\('\/api\/admin\/monitoring\/performance', requireAuth, requireAdmin,/, 'admin only');
  const db = read('api/lib/db.js');
  assert.equal((db.match(/perfMonitor\.recordQuery\(sql, Date\.now\(\) - began\)/g) || []).length, 2, 'query and execute are both timed');
  const app = read('api/lib/httpApp.js');
  assert.match(app, /app\.use\(compression\(\)\);\n\s*app\.use\(timeRequests\);/, 'first after compression, so the tenant lookup counts');
  assert.match(read('admin/pages/dashboard/tabs/ServerMonitorTab.tsx'), /<PerformancePanel \/>/);
});
