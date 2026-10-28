'use strict';
/**
 * Handing out leads and reading the CRM's figures, over HTTP on the real app
 * and against the real schema's triggers, in a MariaDB of the file's own.
 *
 * The database stamps assigned_at whenever a lead gets a rep, from any path,
 * and leaves it alone otherwise. «توزيع تلقائي» keeps each rep's own daily cap
 * as it hands a batch out, and leaves what nobody has room for in the pool.
 * The aggregate screens count a rep's own leads only, give a role scoped to
 * nothing an empty answer, and take nothing raw from the query string. A
 * coaching review needs evidence and a second person, and its score is the
 * server's arithmetic. Replaces the source-text checks on
 * routes/lead-capture-crm.js, lib/leadAssignment.js, routes/admin/leads/*.js,
 * routes/crm-coaching.js and migration 216. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

const T = 'tenant-crm-it';
let pool; let app; let admin; let rep1; let rep2; let hr;

const one = async (sql, params) => (await pool.query(sql, params))[0][0];
const stampOf = async id => (await one("SELECT DATE_FORMAT(assigned_at, '%Y-%m-%d') AS d FROM leads WHERE id=?", [id])).d;
async function lead(id, fields = {}) {
  const row = { name: id, phone: `0104${String(++phones).padStart(7, '0')}`, source: 'فيسبوك', status: 'new', ...fields };
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, assigned_sales_id, assigned_sales_name, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, UTC_TIMESTAMP())`,
    [id, T, row.name, row.phone, row.source, row.status, row.assigned_sales_id || null, row.assigned_sales_name || null, row.score ?? 0]);
}
let phones = 0;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-crm-admin', role: 'ADMIN', name: 'مدير' });
  rep1 = await signInStaff(pool, app, { tenantId: T, id: 'st-crm-rep1', role: 'SALES', name: 'رنا' });
  rep2 = await signInStaff(pool, app, { tenantId: T, id: 'st-crm-rep2', role: 'SALES', name: 'سلمى' });
  hr = await signInStaff(pool, app, {
    tenantId: T, id: 'st-crm-hr', role: 'HR', name: 'HR', permissions: ['view_dashboard', 'view_leads', 'view_subscribers', 'view_reports'],
  });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('the database stamps assigned_at whenever a lead gets a rep, and only then', { skip }, async () => {
  await lead('ld-stamp-1');
  assert.equal((await one("SELECT assigned_at FROM leads WHERE id='ld-stamp-1'")).assigned_at, null, 'nobody, no stamp');
  await pool.query("UPDATE leads SET assigned_sales_id='st-crm-rep1' WHERE id='ld-stamp-1'");
  const first = (await one("SELECT assigned_at FROM leads WHERE id='ld-stamp-1'")).assigned_at;
  assert.ok(first, 'a rep, a stamp — whichever path wrote the rep');
  await pool.query("UPDATE leads SET assigned_at='2026-01-01 00:00:00' WHERE id='ld-stamp-1'");
  await pool.query("UPDATE leads SET notes='اتصلت' WHERE id='ld-stamp-1'");
  assert.equal(await stampOf('ld-stamp-1'), '2026-01-01', 'touching anything else leaves it');
  await pool.query("UPDATE leads SET assigned_sales_id='st-crm-rep2' WHERE id='ld-stamp-1'");
  assert.notEqual(await stampOf('ld-stamp-1'), '2026-01-01', 'a new rep is a new stamp');
  await lead('ld-stamp-2', { assigned_sales_id: 'st-crm-rep1' });
  assert.ok((await one("SELECT assigned_at FROM leads WHERE id='ld-stamp-2'")).assigned_at, 'an insert with a rep is stamped too');
  await pool.query("DELETE FROM leads WHERE id IN ('ld-stamp-1','ld-stamp-2')");
});

test('«توزيع تلقائي» keeps each rep\'s own daily cap across the batch', { skip }, async () => {
  await pool.query(
    `INSERT INTO crm_assignment_members (id, tenant_id, staff_id, branch_key, team_key, weight, is_available, intake_limit, intake_period)
     VALUES ('cam-1', ?, 'st-crm-rep1', '*', 'sales', 1, 1, 2, 'day'), ('cam-2', ?, 'st-crm-rep2', '*', 'sales', 1, 1, 3, 'day')`, [T, T]);
  for (let i = 0; i < 20; i++) await lead(`ld-pool-${i}`);
  const res = await app.call('POST', '/api/admin/leads/distribute', { session: admin, body: { mode: 'unassigned' } });
  assert.equal(res.status, 200, res.text);
  const [counts] = await pool.query(
    "SELECT assigned_sales_id AS rep, COUNT(*) AS n FROM leads WHERE tenant_id=? AND id LIKE 'ld-pool-%' AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id", [T]);
  const byRep = Object.fromEntries(counts.map(row => [row.rep, Number(row.n)]));
  assert.ok((byRep['st-crm-rep1'] || 0) <= 2, `rep1 took ${byRep['st-crm-rep1']} against a cap of 2`);
  assert.ok((byRep['st-crm-rep2'] || 0) <= 3, `rep2 took ${byRep['st-crm-rep2']} against a cap of 3`);
  assert.ok((byRep['st-crm-rep1'] || 0) + (byRep['st-crm-rep2'] || 0) >= 1, 'something was handed out');
  const [stamped] = await pool.query(
    "SELECT id FROM leads WHERE tenant_id=? AND id LIKE 'ld-pool-%' AND assigned_sales_id IS NOT NULL AND assigned_at IS NULL", [T]);
  assert.equal(stamped.length, 0);
  const again = await app.call('POST', '/api/admin/leads/distribute', { session: admin, body: { mode: 'unassigned' } });
  // Both full: nobody is left on the roster, and nothing more is handed out.
  assert.ok(again.status === 409 || again.body.assigned === 0, again.text);
  const [left] = await pool.query("SELECT id FROM leads WHERE tenant_id=? AND id LIKE 'ld-pool-%' AND assigned_sales_id IS NULL", [T]);
  assert.ok(left.length >= 15, 'the rest stay in the pool');
});

test('a rep\'s figures count their own leads; a role scoped to nothing gets nothing', { skip }, async () => {
  await lead('ld-own-1', { assigned_sales_id: 'st-crm-rep1', assigned_sales_name: 'رنا', score: 80, name: 'ليد رنا' });
  await lead('ld-other-1', { assigned_sales_id: 'st-crm-rep2', assigned_sales_name: 'سلمى', score: 90, name: 'ليد سلمى' });
  const scored = await app.call('GET', '/api/admin/leads/scored?limit=500&minScore=0', { session: rep1 });
  assert.equal(scored.status, 200, scored.text);
  assert.ok(scored.text.includes('ليد رنا'));
  assert.ok(!scored.text.includes('ليد سلمى'), 'another rep\'s lead is not in my scored list');
  for (const path of ['/api/admin/leads/scored', '/api/admin/leads/staff-performance', '/api/admin/leads/crm-insights', '/api/admin/subscribers/stats']) {
    const res = await app.call('GET', path, { session: hr });
    assert.equal(res.status, 200, `${path}: ${res.text}`);
    assert.ok(!res.text.includes('ليد'), `${path} names no lead for a role scoped to nothing`);
    assert.ok(!/"total(Leads)?":\s*[1-9]/.test(res.text), `${path} counts nothing for it: ${res.text.slice(0, 200)}`);
  }
});

test('the aggregate routes take nothing raw from the query string', { skip }, async () => {
  const injected = await app.call('GET', `/api/admin/leads/staff-performance?from=${encodeURIComponent("2026-01-01' OR '1'='1")}`, { session: admin });
  assert.equal(injected.status, 200, injected.text);
  assert.equal(injected.body.from, null, 'a from that is not a plain date is dropped, not run');
  const clamped = await app.call('GET', '/api/admin/leads/scored?limit=999999&minScore=-50&sortBy=DROP', { session: admin });
  assert.equal(clamped.status, 200, clamped.text);
  const rows = Array.isArray(clamped.body) ? clamped.body : (clamped.body.leads || clamped.body.rows || []);
  assert.ok(rows.length <= 500, `limit is clamped, got ${rows.length}`);
});

test('a coaching review needs evidence and a second person, and the server does the arithmetic', { skip }, async () => {
  await pool.query(
    `INSERT INTO communications (id, tenant_id, lead_id, type, date, notes, staff_id, created_at)
     VALUES ('comm-crm-1', ?, 'ld-own-1', 'call', UTC_TIMESTAMP(), 'مكالمة', 'st-crm-rep1', UTC_TIMESTAMP())`, [T]);
  const scores = { discovery_score: 5, empathy_score: 4, accuracy_score: 3, next_step_score: 2 };
  const noEvidence = await app.call('POST', '/api/admin/crm/coaching/reviews', {
    session: admin, body: { communication_id: 'comm-crm-1', evidence_id: 'nothing', ...scores },
  });
  assert.equal(noEvidence.status, 400, noEvidence.text);
  const evidence = await app.call('POST', '/api/admin/crm/communications/comm-crm-1/evidence', {
    session: admin, body: { evidence_type: 'note', content_text: 'العميل سأل عن التقسيط' },
  });
  assert.equal(evidence.status, 201, evidence.text);
  assert.match(evidence.body.content_sha256, /^[0-9a-f]{64}$/);
  const insecure = await app.call('POST', '/api/admin/crm/communications/comm-crm-1/evidence', {
    session: admin, body: { evidence_type: 'recording', evidence_url: 'http://example.test/a.mp3' },
  });
  assert.equal(insecure.status, 400, 'evidence by link is HTTPS only');
  const own = await app.call('POST', '/api/admin/crm/coaching/reviews', {
    session: rep1, body: { communication_id: 'comm-crm-1', evidence_id: evidence.body.id, ...scores },
  });
  assert.ok([403, 409].includes(own.status), `nobody reviews their own call: ${own.text}`);
  const outOfRange = await app.call('POST', '/api/admin/crm/coaching/reviews', {
    session: admin, body: { communication_id: 'comm-crm-1', evidence_id: evidence.body.id, ...scores, empathy_score: 9 },
  });
  assert.equal(outOfRange.status, 400);
  const reviewed = await app.call('POST', '/api/admin/crm/coaching/reviews', {
    session: admin, body: { communication_id: 'comm-crm-1', evidence_id: evidence.body.id, ...scores, total_score: 100 },
  });
  assert.equal(reviewed.status, 201, reviewed.text);
  assert.equal(reviewed.body.total_score, 70, '(5+4+3+2)/20 — whatever total the browser sent');
  const twice = await app.call('POST', '/api/admin/crm/coaching/reviews', {
    session: admin, body: { communication_id: 'comm-crm-1', evidence_id: evidence.body.id, ...scores },
  });
  assert.equal(twice.status, 409, 'one review per reviewer per call');
});
