'use strict';
/**
 * Marketing consent and the durable message outbox, on a real MariaDB (these were regular expressions over lib/marketingConsent.js, lib/outbox.js and migration 082):
 * opting out suppresses the address or number under any spelling, is audited, and is undone by opting back in; a contact of another institute is not found; the suppression
 * list removes recipients from a send; a message is queued once per dedupe key (per institute); a drain sends each message exactly once even when two run together, retries
 * a failure later with growing delay, buries a message after the last attempt or at once for a permanent refusal, and never lets one institute's queue touch another's.
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
const T = 'tenant-consent-it'; const OTHER = 'tenant-consent-other';
let pool; let consent; let outbox;

async function clean() {
  for (const tenant of [T, OTHER]) {
    for (const table of ['marketing_consent_audit', 'marketing_suppressions', 'message_outbox', 'notifications', 'leads', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
  }
}
const row = async id => (await pool.query('SELECT status, attempts, last_error, locked_by, next_attempt_at > NOW() AS later FROM message_outbox WHERE id=?', [id]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  consent = require('../../lib/marketingConsent');
  outbox = require('../../lib/outbox');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, email, phone, branch, branch_id) VALUES
       ('sub-co-1', ?, 'منى', 'Mona@Example.test', '01012000771', 'ONLINE_EGYPT', 'branch-online-egypt'),
       ('sub-co-2', ?, 'سارة', 'sara@example.test', '01012000772', 'ONLINE_EGYPT', 'branch-online-egypt'),
       ('sub-co-other', ?, 'غريب', 'x@example.test', '01012000773', 'ONLINE_EGYPT', 'branch-online-egypt')`, [T, T, OTHER]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('opting out suppresses the address under any spelling and is audited; opting back in lifts it; another institute\'s contact is not found', { skip }, async () => {
  const out = await consent.setMarketingConsent({ tenantId: T, subjectType: 'subscriber', subjectId: 'sub-co-1', channel: 'email', subscribed: false, source: 'unsubscribe-link' });
  assert.equal(out.ok, true);
  assert.equal(await consent.isSuppressed(T, 'email', 'mona@example.test'), true, 'upper or lower case is the same address');
  assert.equal(await consent.isSuppressed(OTHER, 'email', 'mona@example.test'), false, 'another institute is unaffected');
  const kept = await consent.filterSuppressed(T, 'email', [{ email: 'MONA@example.test' }, { email: 'sara@example.test' }], 'email');
  assert.deepEqual(kept.map(item => item.email), ['sara@example.test'], 'the suppressed address is out of a send');
  await consent.setMarketingConsent({ tenantId: T, subjectType: 'subscriber', subjectId: 'sub-co-2', channel: 'whatsapp', subscribed: false, source: 'stop-reply' });
  assert.equal(await consent.isSuppressed(T, 'whatsapp', '+20 101 200 0772'), true, 'a number in any spelling');
  const back = await consent.setMarketingConsent({ tenantId: T, subjectType: 'subscriber', subjectId: 'sub-co-1', channel: 'email', subscribed: true, source: 'desk', actor: 'rep' });
  assert.equal(back.subscribed, true);
  assert.equal(await consent.isSuppressed(T, 'email', 'mona@example.test'), false);
  const [audit] = await pool.query("SELECT action, source FROM marketing_consent_audit WHERE tenant_id=? AND subject_id='sub-co-1' ORDER BY created_at, id", [T]);
  assert.deepEqual(audit.map(item => item.action).sort(), ['resubscribed', 'unsubscribed'], 'both changes are on record');
  await assert.rejects(consent.setMarketingConsent({ tenantId: T, subjectType: 'subscriber', subjectId: 'sub-co-other', channel: 'email', subscribed: false, source: 'x' }), /not found/);
  await assert.rejects(consent.setMarketingConsent({ tenantId: T, subjectType: 'subscriber', subjectId: 'sub-co-1', channel: 'email', subscribed: false }), /Invalid consent change/);
});

test('a message is queued once per dedupe key and institute', { skip }, async () => {
  const make = (tenantId, key) => outbox.enqueue({ channel: 'email', recipient: 'a@example.test', subject: 's', payload: { html: 'x' }, tenantId, dedupeKey: key });
  const first = await make(T, 'k-1'); const again = await make(T, 'k-1'); const other = await make(OTHER, 'k-1');
  assert.equal(first, again, 'asking again returns the message that is queued');
  assert.notEqual(first, other, 'the same key in another institute is its own message');
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM message_outbox WHERE dedupe_key='k-1'"))[0][0].n), 2);
});

test('two drains together send each message once; a failure is retried later; the last attempt, or a permanent refusal, buries it', { skip }, async () => {
  await pool.query('DELETE FROM message_outbox WHERE tenant_id IN (?, ?)', [T, OTHER]);
  const ids = [];
  for (let i = 1; i <= 6; i += 1) ids.push(await outbox.enqueue({ channel: 'email', recipient: `r${i}@example.test`, subject: 's', payload: {}, tenantId: T }));
  const sentTo = [];
  const senders = { email: async ({ recipient }) => { sentTo.push(recipient); await new Promise(resolve => setTimeout(resolve, 20)); return { ok: true, idMessage: `m-${recipient}` }; } };
  const [a, b] = await Promise.all([outbox.drain(senders, 20), outbox.drain(senders, 20)]);
  assert.equal(a + b, 6, 'six messages, six sends');
  assert.equal(new Set(sentTo).size, 6, 'no recipient twice');
  assert.ok((await pool.query("SELECT status FROM message_outbox WHERE tenant_id=?", [T]))[0].every(item => item.status === 'sent'));

  const failing = await outbox.enqueue({ channel: 'email', recipient: 'f@example.test', subject: 's', payload: {}, tenantId: T });
  await outbox.drain({ email: async () => { throw new Error('SMTP down'); } }, 20);
  let state = await row(failing);
  assert.deepEqual([state.status, state.attempts, Number(state.later), state.locked_by], ['failed', 1, 1, null], 'failed once, due again later, nobody holds it');
  assert.equal(state.last_error, 'SMTP down');
  await pool.query('UPDATE message_outbox SET attempts=?, next_attempt_at=NOW() WHERE id=?', [outbox.MAX_ATTEMPTS - 1, failing]);
  await outbox.drain({ email: async () => { throw new Error('SMTP down'); } }, 20);
  assert.equal((await row(failing)).status, 'dead', 'the last attempt buries it');

  const refused = await outbox.enqueue({ channel: 'email', recipient: 'p@example.test', subject: 's', payload: {}, tenantId: T });
  await outbox.drain({ email: async () => ({ ok: false, reason: 'category_disabled' }) }, 20);
  state = await row(refused);
  assert.deepEqual([state.status, state.attempts], ['dead', 1], 'a switched-off category is not retried');
});

test('a drain only ever completes the rows it holds: a row whose claim moved is left to its new owner', { skip }, async () => {
  await pool.query('DELETE FROM message_outbox WHERE tenant_id IN (?, ?)', [T, OTHER]);
  const id = await outbox.enqueue({ channel: 'email', recipient: 'slow@example.test', subject: 's', payload: {}, tenantId: T });
  let moved = false;
  const senders = { email: async () => { if (!moved) { moved = true; await pool.query("UPDATE message_outbox SET locked_by='someone-else' WHERE id=?", [id]); } return { ok: true }; } };
  await outbox.drain(senders, 20);
  const state = await row(id);
  assert.equal(state.status, 'processing', 'not marked sent by a worker that no longer holds it');
  assert.equal(state.locked_by, 'someone-else');
});
