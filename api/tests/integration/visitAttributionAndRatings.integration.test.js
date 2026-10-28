'use strict';
/**
 * Growth basics against a real MariaDB: a lead keeps the ad visit that first
 * brought it (a later form does not rewrite it) and the lead card names it; and
 * a course's rating counts only the ratings of students who hold the course.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-product-growth-it';
let pool;

async function clean() {
  for (const table of ['lead_events', 'leads', 'course_ratings', 'enrollments', 'subscribers', 'courses', 'client_code_counter', 'outbox', 'message_outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a public lead keeps its first ad visit, and the lead card names it', { skip }, async () => {
  const { capturePublicLead } = require('../../lib/publicLead');
  const first = await capturePublicLead({
    tenantId: TENANT, name: 'عميلة إعلان', phone: '01018000001', source: 'website',
    attribution: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'eid-2026', fbclid: 'FB.1' },
  });
  await capturePublicLead({ tenantId: TENANT, name: 'عميلة إعلان', phone: '01018000001', source: 'website', attribution: { utm_source: 'google', utm_term: 'نفسي' } });
  const [[lead]] = await pool.query('SELECT * FROM leads WHERE id=? AND tenant_id=?', [first.id, TENANT]);
  assert.deepEqual([lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.fbclid, lead.utm_term],
    ['facebook', 'paid', 'eid-2026', 'FB.1', 'نفسي'], 'the first source is kept; an empty field is filled');
  const { mapLeadRow } = require('../../routes/admin/leads/_shared');
  assert.equal(mapLeadRow(lead, new Map()).adSource, 'facebook · paid · eid-2026');
});

test('a sign-up lead carries the visit too', { skip }, async () => {
  const { ensureLeadForUser } = require('../../lib/registrationLead');
  const conn = await pool.getConnection();
  try {
    const result = await ensureLeadForUser(conn, {
      tenantId: TENANT, user: { name: 'مشترك جديد', phone: '01018000002' }, attribution: { utm_source: 'instagram', gclid: 'G-9' },
    });
    const [[lead]] = await conn.query('SELECT utm_source, gclid FROM leads WHERE id=?', [result.leadId]);
    assert.deepEqual({ ...lead }, { utm_source: 'instagram', gclid: 'G-9' });
  } finally { conn.release(); }
});

test('a course\'s rating counts its own students only', { skip }, async () => {
  const { courseRating, courseRatings } = require('../../lib/courseRatings');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, is_published)
     VALUES ('co-pg-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1)`, [TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-pg-1', ?, 'أ', '1018100001'), ('sub-pg-2', ?, 'ب', '1018100002'), ('sub-pg-3', ?, 'ج', '1018100003')`,
    [TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, access_type, status, branch_id, enrolled_at) VALUES
       (UUID(), ?, 'sub-pg-1', 'co-pg-1', 'full', 'active', 'branch-online-egypt', NOW()),
       (UUID(), ?, 'sub-pg-2', 'co-pg-1', 'full', 'completed', 'branch-online-egypt', NOW()),
       (UUID(), ?, 'sub-pg-3', 'co-pg-1', 'full', 'revoked', 'branch-online-egypt', NOW())`, [TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO course_ratings (id, course_id, subscriber_id, rating, tenant_id) VALUES
       (UUID(), 'co-pg-1', 'sub-pg-1', 5, ?), (UUID(), 'co-pg-1', 'sub-pg-2', 4, ?), (UUID(), 'co-pg-1', 'sub-pg-3', 1, ?)`, [TENANT, TENANT, TENANT]);
  assert.deepEqual(await courseRating(pool, { tenantId: TENANT, courseId: 'co-pg-1' }), { avg: 4.5, count: 2 }, 'the refunded student\'s 1 is not counted');
  assert.deepEqual(await courseRatings(pool, { tenantId: TENANT }), { 'co-pg-1': { avg: 4.5, count: 2 } });
});
