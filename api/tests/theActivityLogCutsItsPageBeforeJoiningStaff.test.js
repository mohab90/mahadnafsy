'use strict';
/**
 * 29 Oct 2026, measured on the lab at production scale (250,000 log rows): GET /api/admin/activity-logs took 3.0 s. The statement joined
 * the staff on `st.email = a.actor OR st.id = a.actor` — an OR over two columns, which no index serves — in the same statement as
 * `ORDER BY a.at DESC LIMIT 200`, so the optimizer read 127,000 log rows into a temporary table and sorted them. The page cut first and
 * joined after is the same rows in 16–40 ms. A search or an actor filter needs the staff's name inside the WHERE, so those keep the
 * single statement.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the log\'s default view cuts its page from activity_logs alone, then joins the staff to those rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin-operations.js'), 'utf8');
  const route = source.slice(source.indexOf("router.get('/api/admin/activity-logs'"), source.indexOf("router.post('/api/admin/activity-logs'"));
  assert.match(route, /FROM \(SELECT \* FROM activity_logs a WHERE a\.tenant_id=\?\$\{filters\} ORDER BY a\.at DESC LIMIT \? OFFSET \?\) a/);
  assert.match(route, /const searchesStaff = Boolean\(q \|\| actor\)/);
  // The single statement stays only where the WHERE reads the staff's columns.
  assert.match(route, /searchesStaff\s*\? `SELECT[\s\S]*?FROM activity_logs a\s+\$\{joins\}/);
  // The OR join is written once, so the two statements cannot drift apart.
  assert.equal(route.split('(st.email=a.actor OR st.id=a.actor)').length - 1, 1);
});
