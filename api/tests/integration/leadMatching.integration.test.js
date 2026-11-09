'use strict';
/**
 * Finding the lead behind a customer's contact details, on a real MariaDB (these were regular expressions over lib/leadMatching.js — `phone_digits IN (`, no `LIKE CONCAT('%'`,
 * no `email || ''`, `if (!match.length) return null`): a number matches in any of its spellings and only that exact number — never another customer whose number merely ends the
 * same way — a blank email or phone matches nobody, an email matches case-exactly as stored, another institute's lead is never found, a hidden (archived) lead is found only when
 * asked for and a merged copy never, and the newest of several matches wins. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-leadmatch-it'; const OTHER = 'tenant-leadmatch-other';
let pool; let matching;

const lead = (id, tenant, phone, email, extra = {}) => pool.query(
  `INSERT INTO leads (id, tenant_id, name, phone, email, source, status, hidden, merged_into_lead_id, created_at)
   VALUES (?, ?, ?, ?, ?, 'test', 'new', ?, ?, ?)`,
  [id, tenant, id, phone, email, extra.hidden ? 1 : 0, extra.merged || null, extra.at || '2026-11-01 10:00:00']);
const find = (contact, extra = {}) => matching.findLeadByContact(pool, { tenantId: T, ...contact, ...extra }).then(row => row?.id ?? null);

async function clean() {
  for (const tenant of [T, OTHER]) await pool.query('DELETE FROM leads WHERE tenant_id=?', [tenant]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  matching = require('../../lib/leadMatching');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await lead('ld-lm-phone', T, '01012345678', 'one-lm@example.test', { at: '2026-11-01 10:00:00' });
  await lead('ld-lm-blank-a', T, 'n/a', '', { at: '2026-11-02 10:00:00' });
  await lead('ld-lm-blank-b', T, 'unknown', '', { at: '2026-11-03 10:00:00' });
  await lead('ld-lm-uk', T, '+44 1012345678', null, { at: '2026-11-01 11:00:00' });
  await lead('ld-lm-hidden', T, '01099990001', null, { hidden: true });
  await lead('ld-lm-merged', T, '01099990002', null, { hidden: true, merged: 'ld-lm-phone' });
  await lead('ld-lm-old', T, '01055550000', null, { at: '2026-10-01 10:00:00' });
  await lead('ld-lm-new', T, '+20 1055550000', null, { at: '2026-11-05 10:00:00' });
  await lead('ld-lm-other', OTHER, '01077770001', 'other-lm@example.test');
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a number matches in any spelling and only that exact number; a blank identifier matches nobody', { skip }, async () => {
  for (const spelling of ['01012345678', '1012345678', '+20 101 234 5678', '00201012345678', '201012345678']) {
    assert.equal(await find({ phone: spelling }), 'ld-lm-phone', spelling);
  }
  assert.equal(await find({ phone: '12345678' }), null, 'the tail of a number is not the number');
  assert.equal(await find({ phone: '5678' }), null);
  assert.equal(await find({ phone: '+44 1012345678' }), 'ld-lm-uk', 'a foreign number that shares the last ten digits is its own customer');
  for (const blank of [{}, { phone: '', email: '' }, { phone: '   ', email: '  ' }, { phone: null, email: null }]) {
    assert.equal(await find(blank), null, `${JSON.stringify(blank)}: nothing to match on, so nobody — not the newest lead with a blank email`);
  }
});

test('an email matches as stored; the tenant is respected; a hidden lead only when asked for; a merged copy never; the newest wins', { skip }, async () => {
  assert.equal(await find({ email: 'one-lm@example.test' }), 'ld-lm-phone');
  assert.equal(await find({ email: '  one-lm@example.test ' }), 'ld-lm-phone', 'trimmed');
  assert.equal(await find({ phone: '01012345678', email: 'nobody@example.test' }), 'ld-lm-phone', 'either term is enough');
  assert.equal(await find({ email: 'other-lm@example.test' }), null, 'another institute\'s lead is not found');
  assert.equal(await matching.findLeadByContact(pool, { tenantId: OTHER, email: 'other-lm@example.test' }).then(row => row?.id), 'ld-lm-other');

  assert.equal(await find({ phone: '01099990001' }), null, 'a hidden lead is not found by default');
  const archived = await matching.findLeadByContact(pool, { tenantId: T, phone: '01099990001', includeHidden: true });
  assert.deepEqual([archived.id, Number(archived.hidden)], ['ld-lm-hidden', 1], 'an archived lead is still this person');
  assert.equal(await find({ phone: '01099990002' }, { includeHidden: true }), null, 'a merged copy is never the answer');
  assert.equal(await find({ phone: '01055550000' }), 'ld-lm-new', 'of several, the newest');
});
