'use strict';
/**
 * «كارت خطوتك الجاية» and «صفحات الكورسات في جوجل» (11 Oct 2026), against a
 * real MariaDB: the client's next session and balance come from their own round
 * only, and a published course reaches the sitemap and its page at once while
 * an unpublished one does not. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-nextstep-it';
let pool;

const shellFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seo-it-')), 'index.html');
fs.writeFileSync(shellFile, fs.readFileSync(path.join(__dirname, '../../../client/index.html'), 'utf8'));
process.env.SEO_SHELL_FILE = shellFile;

const fakeRes = () => ({
  statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
  set(name, value) { this.headers[name] = value; return this; },
  removeHeader(name) { delete this.headers[name]; },
  type() { return this; },
  send(payload) { this.body = String(payload); return this; },
});
async function call(router, route, req) {
  const layer = router.stack.find(item => item.route?.path === route);
  const res = fakeRes();
  await layer.route.stack.slice(-1)[0].handle({ tenantId: TENANT, headers: {}, query: {}, params: {}, ...req }, res);
  return res;
}

async function clean() {
  for (const table of ['course_completions', 'daqqi_attendees', 'daqqi_rounds', 'payments', 'enrollments', 'subscribers', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]).catch(() => {});
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES ('co-ns-1', ?, 'family-therapy-it', 'العلاج الأسري', '', 'دبلومة العلاج الأسري', '', '', 'GENERAL', 'RECORDED', 3000, 1),
            ('co-ns-2', ?, 'draft-it', 'مسودة', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 0)`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, firebase_uid)
     VALUES ('sub-ns-1', ?, 'عميلة', '1016000101', 'ONLINE_EGYPT', 'uid-ns-1'),
            ('sub-ns-2', ?, 'عميل تاني', '1016000102', 'ONLINE_EGYPT', 'uid-ns-2')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, payment_type, status, date)
     VALUES ('pay-ns-1', ?, 'sub-ns-1', 'co-ns-1', 1200, 'EGP', 'COURSE', 'paid', NOW())`, [TENANT]);
  await pool.query(
    `INSERT INTO daqqi_rounds (id, tenant_id, code, course_id, instructor_name, reception_name, day_of_week, start_date, time_slot, status, branch, room)
     VALUES ('rd-ns-1', ?, '7001', 'co-ns-1', 'د. منى', '', 'السبت', '2026-09-05', 'EVENING', 'ACTIVE', 'TAGAMOA', '3'),
            ('rd-ns-2', ?, '7002', 'co-ns-1', '', '', 'الأحد', '2026-09-06', 'MORNING', 'FINISHED', 'DAQQI', '1')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO daqqi_attendees (round_id, subscriber_id, tenant_id, name, phone, booked_at)
     VALUES ('rd-ns-1', 'sub-ns-1', ?, 'عميلة', '1016000101', NOW()),
            ('rd-ns-2', 'sub-ns-1', ?, 'عميلة', '1016000101', NOW()),
            ('rd-ns-1', 'sub-ns-2', ?, 'عميل تاني', '1016000102', NOW())`, [TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO course_completions (id, tenant_id, subscriber_id, course_id, certificate_code)
     VALUES ('cc-ns-1', ?, 'sub-ns-1', 'co-ns-1', 'CERT-NS-1')`, [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the housed client gets their open round\'s next session and what they still owe', { skip }, async () => {
  const router = require('../../routes/me-next-step');
  const res = await call(router, '/api/me/next-step', { user: { uid: 'uid-ns-1' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { session, rounds, certificates } = res.body;
  assert.equal(session.roundId, 'rd-ns-1', 'a finished round is not the next step');
  assert.equal(session.branchLabel, 'التجمع');
  assert.equal(session.room, '3');
  assert.equal(new Date(`${session.date}T12:00:00Z`).getUTCDay(), 6, 'a Saturday, like the round');
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].price, 3000);
  assert.equal(rounds[0].remaining, 1800, '3000 agreed, 1200 paid');
  assert.equal(certificates[0].code, 'CERT-NS-1');
});

test('the course published is in the sitemap and has its page; the draft has neither', { skip }, async () => {
  const router = require('../../routes/seo-pages');
  const sitemap = await call(router, '/api/seo/sitemap.xml', {});
  assert.match(sitemap.body, /\/c\/family-therapy-it<\/loc>/);
  assert.doesNotMatch(sitemap.body, /draft-it/);
  const page = await call(router, '/api/seo/page/:kind(c|course|bundle)/:key', { params: { kind: 'c', key: 'family-therapy-it' } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<title>العلاج الأسري \| معهد الدراسات النفسية<\/title>/);
  assert.match(page.body, /"@type":"Course"/);
  const draft = await call(router, '/api/seo/page/:kind(c|course|bundle)/:key', { params: { kind: 'c', key: 'draft-it' } });
  assert.equal(draft.statusCode, 404);
});
