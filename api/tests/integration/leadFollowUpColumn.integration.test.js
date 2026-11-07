'use strict';
/**
 * 7 Nov 2026 (migration 370 + migrations-later/370b): a lead's next follow-up day is copied into leads.next_follow_up_date by 370, which changes no blob (code of the previous
 * release keeps working after it, so a rollback loses nothing); the writers keep both; removing the blob key is a later step run by hand. Against a real MariaDB. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-followup-column-it';
let pool, splitStatements;

const clean = async () => { for (const t of ['lead_events', 'communications', 'leads']) await pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [T]).catch(() => {}); };
const lead = (id, crm, column) => pool.query(
  'INSERT INTO leads (id, tenant_id, name, phone, source, status, crm_json, next_follow_up_date, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  [id, T, `ليد ${id}`, `1019${id.replace(/\D/g, '').padStart(7, '0')}`, 'facebook', 'new', JSON.stringify(crm), column, '2026-01-01 10:00:00']);
const row = async id => (await pool.query('SELECT crm_json, DATE_FORMAT(next_follow_up_date, "%Y-%m-%d") AS day, updated_at FROM leads WHERE id=? AND tenant_id=?', [id, T]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ splitStatements } = require('../../lib/migrationRunner'));
  await clean();
  await lead('f1', { nextFollowUpDate: '2026-11-20', interestLevel: 'high' }, null);          // blob only: the column is filled, the key goes
  await lead('f2', { nextFollowUpDate: '2026-11-21T10:00:00.000Z', clientType: 'x' }, '2026-11-21 00:00:00'); // both: the key goes, the column stays
  await lead('f3', { interestLevel: 'low' }, '2026-11-22 00:00:00');                           // column only: untouched
  await lead('f4', { nextFollowUpDate: 'بعد العيد' , note: 'keep' }, null);                       // free text, no column: left where it is
  await lead('f5', { nextFollowUpDate: null, note: 'empty' }, null);                           // an empty key: removed
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const run = async file => { for (const statement of splitStatements(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'))) await pool.query(statement); };
const keptUpdatedAt = rows => { for (const r of rows) assert.equal(new Date(r.updated_at).toISOString().slice(0, 10), '2026-01-01', 'updated_at is kept'); };

test('migration 370 only copies: the column is filled where the blob had the date, no blob changes', { skip }, async () => {
  await run('migrations/370_v26_leads_follow_up_leaves_crm_json.sql');
  const [f1, f2, f3, f4, f5] = [await row('f1'), await row('f2'), await row('f3'), await row('f4'), await row('f5')];
  assert.equal(f1.day, '2026-11-20', 'the date only the blob had is in the column now');
  assert.deepEqual(JSON.parse(f1.crm_json), { nextFollowUpDate: '2026-11-20', interestLevel: 'high' }, 'the code of the previous release still finds the key');
  assert.equal(f2.day, '2026-11-21');
  assert.deepEqual(JSON.parse(f2.crm_json), { nextFollowUpDate: '2026-11-21T10:00:00.000Z', clientType: 'x' });
  assert.equal(f3.day, '2026-11-22');
  assert.equal(f4.day, null, 'free text is not a date');
  assert.deepEqual(JSON.parse(f4.crm_json), { nextFollowUpDate: 'بعد العيد', note: 'keep' });
  assert.deepEqual(JSON.parse(f5.crm_json), { nextFollowUpDate: null, note: 'empty' });
  keptUpdatedAt([f1, f2, f3, f4, f5]);
});

test('the later step (migrations-later/370b) removes the key only where the column holds the date', { skip }, async () => {
  await run('migrations-later/370b_leads_follow_up_key_leaves_crm_json.sql');
  const [f1, f2, f3, f4, f5] = [await row('f1'), await row('f2'), await row('f3'), await row('f4'), await row('f5')];
  assert.deepEqual(JSON.parse(f1.crm_json), { interestLevel: 'high' });
  assert.equal(f1.day, '2026-11-20');
  assert.deepEqual(JSON.parse(f2.crm_json), { clientType: 'x' });
  assert.equal(f2.day, '2026-11-21', 'the column is untouched');
  assert.deepEqual(JSON.parse(f3.crm_json), { interestLevel: 'low' });
  assert.deepEqual(JSON.parse(f4.crm_json), { nextFollowUpDate: 'بعد العيد', note: 'keep' }, 'free text that is not a date is not thrown away');
  assert.deepEqual(JSON.parse(f5.crm_json), { note: 'empty' });
  keptUpdatedAt([f1, f2, f3, f4, f5]);
});

test('migration 370 is not run by the runner together with the later step', { skip: false }, () => {
  const migrations = fs.readdirSync(path.join(__dirname, '..', '..', 'migrations'));
  assert.ok(migrations.includes('370_v26_leads_follow_up_leaves_crm_json.sql'));
  assert.ok(!migrations.some(name => name.startsWith('370b')), 'the later step stays outside migrations/');
  assert.ok(!/JSON_REMOVE/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '370_v26_leads_follow_up_leaves_crm_json.sql'), 'utf8')), '370 takes nothing out of the blob');
});

test('a contact logged on a lead sets the column and the blob key together', { skip }, async () => {
  const { appendLeadInteraction } = require('../../lib/leadInteractions');
  await lead('f6', { interestLevel: 'high' }, null);
  await appendLeadInteraction({ tenantId: T, leadId: 'f6', interaction: { type: 'call', notes: 'كلمتها', nextFollowUp: '2026-12-05' } });
  const after = await row('f6');
  assert.equal(after.day, '2026-12-05');
  assert.equal(JSON.parse(after.crm_json).nextFollowUpDate, '2026-12-05', 'the previous release reads the same day from the blob');
});
