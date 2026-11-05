'use strict';
/**
 * 5 Nov 2026, «تفريغ crm_json في جداول», first key: the client's status (clientStatus) is the column subscribers.client_status. Against a real MariaDB: migration 365's copy,
 * the reader's rule (the blob's key while an old row still has it, else the column — SQL and JS agree), the save that writes the column and takes the key out of the blob
 * (a new client, a partial save, a save that does not mention the status), and the status counts the clients table reads. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-client-status-it';
let pool, router;

const clean = () => pool.query('DELETE FROM subscribers WHERE tenant_id=?', [T]).catch(() => {});
const row = async id => (await pool.query('SELECT client_status, crm_json FROM subscribers WHERE id=? AND tenant_id=?', [id, T]))[0][0];
const save = async body => {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/subscribers' && l.route.methods.post);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query: {}, body, headers: {}, tenantId: T, user: { uid: 'admin', email: 'owner@x.t' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/subscribers');
  await clean();
  // an old row as migration 365 finds it: the status only in the blob
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, crm_json) VALUES ('cs-old', ?, 'CS1', 'قديم', '1019400001', 'ONLINE_EGYPT', ?)", [T, JSON.stringify({ clientStatus: 'paused', market: 'local' })]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, client_status, crm_json) VALUES ('cs-col', ?, 'CS2', 'عمود', '1019400002', 'ONLINE_EGYPT', 'active', '{}')", [T]);
  // written by an older server after the copy: the blob says finished, the column still says active — the blob is the newer
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, client_status, crm_json) VALUES ('cs-both', ?, 'CS3', 'الاتنين', '1019400003', 'ONLINE_EGYPT', 'active', ?)", [T, JSON.stringify({ clientStatus: 'finished' })]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('migration 365 copies the status from the blob into the column and indexes it', { skip }, async () => {
  const { splitStatements } = require('../../lib/migrationRunner');
  const sql = splitStatements(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '365_v26_subscribers_client_status_column.sql'), 'utf8'));
  await pool.query("UPDATE subscribers SET client_status=NULL WHERE id='cs-old' AND tenant_id=?", [T]);
  for (const statement of sql) await pool.query(statement);   // IF NOT EXISTS: running it again changes nothing
  assert.equal((await row('cs-old')).client_status, 'paused', 'copied from the blob');
  assert.equal((await row('cs-col')).client_status, 'active', 'a column already set is not touched');
  const [index] = await pool.query("SHOW INDEX FROM subscribers WHERE Key_name='idx_subscribers_tenant_status'");
  assert.deepEqual(index.map(entry => entry.Column_name), ['tenant_id', 'client_status']);
});

test('a reader takes the blob\'s key while it is there and the column otherwise, in SQL and in JS alike', { skip }, async () => {
  const { ownedSql, withOwned } = require('../../lib/crmColumns');
  const [rows] = await pool.query(`SELECT s.id, s.client_status, s.crm_json, ${ownedSql('clientStatus')} AS status FROM subscribers s WHERE s.tenant_id=? ORDER BY s.id`, [T]);
  const byId = Object.fromEntries(rows.map(entry => [entry.id, entry]));
  assert.deepEqual({ old: byId['cs-old'].status, col: byId['cs-col'].status, both: byId['cs-both'].status }, { old: 'paused', col: 'active', both: 'finished' });
  for (const entry of rows) assert.equal(withOwned(JSON.parse(entry.crm_json), entry).clientStatus, entry.status, `${entry.id}: JS and SQL say the same`);
});

test('a new client saved with a status keeps it in the column and not in the blob', { skip }, async () => {
  const res = await save({ id: 'cs-new', name: 'عميل جديد', phone: '01019400010', branch: 'ONLINE_EGYPT', clientStatus: 'refunded', market: 'local' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const saved = await row('cs-new');
  assert.equal(saved.client_status, 'refunded');
  assert.deepEqual(JSON.parse(saved.crm_json).clientStatus, undefined, 'the key left the blob');
  assert.equal(JSON.parse(saved.crm_json).market, 'local', 'the rest of the blob is untouched');
});

test('a partial save that changes the status writes the column; one that does not mention it leaves it alone', { skip }, async () => {
  const changed = await save({ id: 'cs-new', name: 'عميل جديد', phone: '01019400010', changedFields: ['clientStatus'], clientStatus: 'active' });
  assert.equal(changed.statusCode, 200, JSON.stringify(changed.body));
  assert.equal((await row('cs-new')).client_status, 'active');
  const untouched = await save({ id: 'cs-new', name: 'عميل جديد', phone: '01019400010', changedFields: ['notes'], notes: 'ملاحظة' });
  assert.equal(untouched.statusCode, 200, JSON.stringify(untouched.body));
  const after = await row('cs-new');
  assert.equal(after.client_status, 'active', 'a save about something else does not clear the status');
  assert.equal(JSON.parse(after.crm_json).clientStatus, undefined);
});

test('an old row edited through the screen moves its status to the column and out of the blob', { skip }, async () => {
  const res = await save({ id: 'cs-old', name: 'قديم', phone: '01019400001', changedFields: ['notes'], notes: 'x' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const saved = await row('cs-old');
  assert.equal(saved.client_status, 'paused', 'the blob\'s value, carried through the base of the partial save, is now the column\'s');
  assert.equal(JSON.parse(saved.crm_json).clientStatus, undefined);
});
