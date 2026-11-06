'use strict';
/**
 * 6 Nov 2026, «تفريغ crm_json في جداول», second key: the online client's market (local / saudi / intl) is the column subscribers.market. Against a real MariaDB: migration
 * 367's copy, the reader's rule (the blob's key while an old row still has it, else the column — SQL and JS agree), the save that writes the column and takes the key out of
 * the blob (a new client, a partial save, a save that does not mention the market), the change of currency that moves a client to another market, and the bulk
 * assignment's read of it. Runs only with DB_*.
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
const T = 'tenant-market-column-it';
let pool, router;

const clean = async () => { for (const table of ['payments', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
const row = async id => (await pool.query('SELECT market, client_status, branch, crm_json FROM subscribers WHERE id=? AND tenant_id=?', [id, T]))[0][0];
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
  // an old row as migration 367 finds it: the market only in the blob
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, crm_json) VALUES ('mk-old', ?, 'MK1', 'قديم', '1019500001', 'ONLINE_SAUDI', ?)", [T, JSON.stringify({ market: 'saudi', clientStatus: 'active' })]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, market, crm_json) VALUES ('mk-col', ?, 'MK2', 'عمود', '1019500002', 'ONLINE_EGYPT', 'local', '{}')", [T]);
  // written by an older server after the copy: the blob says intl, the column still says local — the blob is the newer
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, market, crm_json) VALUES ('mk-both', ?, 'MK3', 'الاتنين', '1019500003', 'ONLINE_ABROAD', 'local', ?)", [T, JSON.stringify({ market: 'intl' })]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('migration 367 copies the market from the blob into the column and touches nothing already set', { skip }, async () => {
  const { splitStatements } = require('../../lib/migrationRunner');
  const sql = splitStatements(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '367_v26_subscribers_market_column.sql'), 'utf8'));
  await pool.query("UPDATE subscribers SET market=NULL WHERE id='mk-old' AND tenant_id=?", [T]);
  for (const statement of sql) await pool.query(statement);   // IF NOT EXISTS: running it again changes nothing
  assert.equal((await row('mk-old')).market, 'saudi', 'copied from the blob');
  assert.equal((await row('mk-col')).market, 'local', 'a column already set is not touched');
});

test('a reader takes the blob\'s key while it is there and the column otherwise, in SQL and in JS alike', { skip }, async () => {
  const { ownedSql, withOwned } = require('../../lib/crmColumns');
  const [rows] = await pool.query(`SELECT s.id, s.market, s.crm_json, ${ownedSql('market')} AS market_seen FROM subscribers s WHERE s.tenant_id=? ORDER BY s.id`, [T]);
  const byId = Object.fromEntries(rows.map(entry => [entry.id, entry]));
  assert.deepEqual({ old: byId['mk-old'].market_seen, col: byId['mk-col'].market_seen, both: byId['mk-both'].market_seen }, { old: 'saudi', col: 'local', both: 'intl' });
  for (const entry of rows) assert.equal(withOwned(JSON.parse(entry.crm_json), entry).market || '', entry.market_seen, `${entry.id}: JS and SQL say the same`);
});

test('a new client saved with a market keeps it in the column and not in the blob', { skip }, async () => {
  const res = await save({ id: 'mk-new', name: 'عميل جديد', phone: '01019500010', branch: 'ONLINE_SAUDI', market: 'saudi', clientStatus: 'active' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const saved = await row('mk-new');
  assert.equal(saved.market, 'saudi');
  assert.equal(saved.client_status, 'active', 'and the status, as before');
  assert.equal(JSON.parse(saved.crm_json).market, undefined, 'the key left the blob');
});

test('a partial save that changes the market writes the column; one that does not mention it leaves it alone', { skip }, async () => {
  const moved = await save({ id: 'mk-new', name: 'عميل جديد', phone: '01019500010', changedFields: ['market'], market: 'intl' });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal((await row('mk-new')).market, 'intl');
  const untouched = await save({ id: 'mk-new', name: 'عميل جديد', phone: '01019500010', changedFields: ['notes'], notes: 'ملاحظة' });
  assert.equal(untouched.statusCode, 200, JSON.stringify(untouched.body));
  const after = await row('mk-new');
  assert.equal(after.market, 'intl', 'a save about something else does not clear the market');
  assert.equal(JSON.parse(after.crm_json).market, undefined);
});

test('an old row edited through the screen moves its market to the column and out of the blob', { skip }, async () => {
  const res = await save({ id: 'mk-old', name: 'قديم', phone: '01019500001', changedFields: ['notes'], notes: 'x' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const saved = await row('mk-old');
  assert.equal(saved.market, 'saudi', 'the blob\'s value, carried through the base of the partial save, is now the column\'s');
  assert.equal(JSON.parse(saved.crm_json).market, undefined);
});

test('changing a client\'s currency moves their market in the column, with the branch and the status', { skip }, async () => {
  const { changeClientCurrency } = require('../../lib/clientCurrency');
  await pool.query("UPDATE subscribers SET market='local', branch='ONLINE_EGYPT', client_status='old_local', crm_json='{}' WHERE id='mk-col' AND tenant_id=?", [T]);
  const result = await changeClientCurrency(pool, { tenantId: T, subscriberId: 'mk-col', currency: 'SAR', convert: false, actor: 'test' });
  assert.equal(result.branch, 'ONLINE_SAUDI');
  const saved = await row('mk-col');
  assert.equal(saved.market, 'saudi');
  assert.equal(saved.branch, 'ONLINE_SAUDI');
  assert.equal(saved.client_status, 'old_intl', 'the old-data tabs move with the market');
  assert.equal(JSON.parse(saved.crm_json).market, undefined);
});
