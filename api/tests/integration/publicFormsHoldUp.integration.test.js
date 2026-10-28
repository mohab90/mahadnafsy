'use strict';
/**
 * The public forms under a burst, and against a stranger who knows a number.
 *
 * A local trial on 20 Oct 2026 sent 80 lead forms, 40 at a time: ten were
 * filed, fifty hung for 45 s, and the API stopped answering until it was
 * restarted — each request held its connection while queuing the welcome
 * message through a second one, and twenty requests held the whole pool. The
 * same trial rewrote a client's name, email and «isPaid» with one anonymous
 * form carrying their number.
 *
 * Against a real MariaDB and the real router. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-publicforms-it';
process.env.DEFAULT_TENANT_ID = T;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.DISABLE_BACKGROUND_JOBS = 'true';

let pool; let server; let base;

async function clean() {
  for (const table of ['lead_events', 'leads', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenantId = T; next(); });
  app.use(require('../../routes/lead-capture-crm'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ENABLED) return;
  await clean();
  await new Promise(resolve => server.close(resolve));
  await pool.end().catch(() => {});
});

test('forty lead forms at once are all filed, and the pool is free afterwards', { skip, timeout: 60_000 }, async () => {
  const { capturePublicLead } = require('../../lib/publicLead');
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    capturePublicLead({ tenantId: T, name: `Burst ${i}`, phone: `0109${String(7000000 + i)}`, source: 'it-burst' })));
  assert.equal(results.filter(r => r.id && !r.busy).length, 40);
  assert.ok(Date.now() - started < 30_000, `took ${Date.now() - started} ms`);
  // A connection is still there for the next request.
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND source=?', [T, 'it-burst']);
  assert.equal(Number(row.n), 40);
});

test('an anonymous form with a client\'s number adds a note; it does not rename them or mark them paid', { skip }, async () => {
  const post = body => fetch(`${base}/api/registrations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  const first = await post({ name: 'Victim Real', phone: '01066665555', email: 'victim@it.test', interestedCourseIds: ['c-1'] });
  if (first.status === 503) return; // this machine cannot resolve a visitor's country
  assert.equal(first.status, 200);
  const second = await post({
    name: '<b>HACKED</b>', phone: '+201066665555', email: 'attacker@evil.test',
    stage: 'paid', isPaid: true, assignedSalesId: 'someone', interestedCourseIds: ['c-2'],
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);

  const [[lead]] = await pool.query('SELECT name, email, notes, crm_json FROM leads WHERE id=? AND tenant_id=?', [first.body.id, T]);
  assert.equal(lead.name, 'Victim Real');
  assert.equal(lead.email, 'victim@it.test');
  assert.match(lead.notes, /HACKED/);
  const crm = JSON.parse(lead.crm_json);
  assert.equal(crm.isPaid, undefined);
  assert.equal(crm.stage, undefined);
  assert.notEqual(crm.assignedSalesId, 'someone');
  assert.deepEqual(crm.interestedCourseIds, ['c-1', 'c-2']);
});

test('a phone sent as an object is refused, not filed as «[object Object]»', { skip }, async () => {
  const response = await fetch(`${base}/api/registrations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ['a'], phone: { x: 1 } }),
  });
  assert.equal(response.status, 400);
});
