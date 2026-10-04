'use strict';
// tools/perf-report.cjs ranks routes from the request log and groups slow
// statements by shape. Both only mean something if two requests for two
// different leads count as one route, and two lookups for two different
// phones as one statement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { routeKey, sqlShape, summarizeRequests } = require('../tools/perf-report.cjs');

test('ids in a path fold into one route', () => {
  assert.equal(routeKey('/api/admin/leads/123/notes'), '/api/admin/leads/:id/notes');
  assert.equal(routeKey('/api/admin/leads/3f2a1b4c-1111-2222-3333-444455556666'), '/api/admin/leads/:id');
  assert.equal(routeKey('/api/admin/subscribers/rv-sub-2031?x=1'), '/api/admin/subscribers/:id');
  assert.equal(routeKey('/api/admin/leads/pool'), '/api/admin/leads/pool');
  assert.equal(routeKey('/api/admin/hr/attendance/summary'), '/api/admin/hr/attendance/summary');
});

test('literals and IN lists fold into one statement shape', () => {
  assert.equal(
    sqlShape("SELECT * FROM leads WHERE phone = '0100' AND id IN (1, 2, 3) LIMIT 50"),
    sqlShape("SELECT *  FROM leads WHERE phone = '0111' AND id IN (9) LIMIT 20"));
  assert.notEqual(sqlShape('SELECT a FROM leads'), sqlShape('SELECT a FROM payments'));
});

test('request lines rank by route, ignoring everything that is not a request', () => {
  const line = (path, ms, status = 200) => `prefix ${JSON.stringify({ ts: 'x', level: 'info', msg: 'http', method: 'GET', path, status, ms })}`;
  const lines = [
    ...[10, 20, 30, 40, 900].map(ms => line(`/api/admin/leads/${ms}`, ms)),
    line('/api/admin/leads/pool', 5, 500),
    '{"msg":"something else","ms":5}', 'not json at all', '',
  ];
  const { read, routes } = summarizeRequests(lines);
  assert.equal(read, 6);
  const leads = routes.find(r => r.route === 'GET /api/admin/leads/:id');
  assert.equal(leads.count, 5);
  assert.equal(leads.p50, 30);
  assert.equal(leads.max, 900);
  assert.equal(routes.find(r => r.route === 'GET /api/admin/leads/pool').errors, 1);
});
