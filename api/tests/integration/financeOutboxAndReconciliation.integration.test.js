'use strict';
/**
 * The finance outbox and the reconciliation dashboard, on a real MariaDB (these were regular expressions over lib/financeOutbox.js and routes/core/payops.js —
 * `uq_finance_outbox_tenant_dedupe`, `attempts >= MAX_ATTEMPTS`, `LIMIT ? FOR UPDATE`, `locked_by`, `finance-outbox/:id/retry … manage_financial`, the per-tenant joins of
 * `paid_without_journal` / `unbalanced_journal` / `failed_finance_events`): an event is queued once per institute and key; a drain handles each event once even when two
 * run together, retries a failure later and buries it on the sixth; a worker that died holding an event loses it after 15 minutes; only the central books list the
 * outbox and retry a failed or dead event, and never another institute's; and the dashboard names a paid payment with no journal entry, an unbalanced entry and the failed
 * events — for this institute only — and clears them when they are fixed. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-fin-outbox-it'; const OTHER = 'tenant-fin-outbox-other';
let pool; let outbox; let payops;

const staff = (id, role, permissions, extra = {}) => ({ id, name: id, role, permissions_json: JSON.stringify(permissions), ...extra });
const ACCOUNTS = staff('st-fo-acc', 'accountant', ['view_financial', 'manage_financial']);
const VIEWER = staff('st-fo-view', 'accountant', ['view_financial']);
const BRANCH = staff('st-fo-br', 'accountant', ['view_financial', 'manage_financial'], { data_scope: 'branch:DAQQI', branch_id: 'branch-daqqi' });

async function call(method, path, { params = {}, query = {}, who = ACCOUNTS } = {}) {
  const layer = payops.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body: {}, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-fo@example.test', tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const rowOf = async id => (await pool.query('SELECT status, attempts, locked_by, error_message, next_attempt_at > NOW() AS later FROM finance_outbox WHERE id=?', [id]))[0][0];
const idOf = async (tenant, key) => (await pool.query('SELECT id FROM finance_outbox WHERE tenant_id=? AND dedupe_key=?', [tenant, key]))[0][0]?.id;
const check = async key => (await call('get', '/api/admin/reconciliation-dashboard')).body.checks.find(item => item.key === key);

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id IN (?, ?))', [T, OTHER]).catch(() => {});
  for (const tenant of [T, OTHER]) {
    for (const table of ['journal_entries', 'finance_outbox', 'payments', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  outbox = require('../../lib/financeOutbox');
  payops = require('../../routes/core/payops');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-fo-acc', ?, 'المحاسب', 'acc-fo@example.test', '1019300001', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-fo-view', ?, 'مشاهد', 'view-fo@example.test', '1019300002', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-fo-br', ?, 'محاسب فرع', 'br-fo@example.test', '1019300003', 'ACCOUNTANT', 1, '2025-01-01')`, [T, T, T]);
  for (const [tenant, id, phone] of [[T, 'sub-fo-1', '1019300010'], [OTHER, 'sub-fo-other', '1019300011']]) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'عميل', ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [id, tenant, phone]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an event is queued once per institute and key, and needs both', { skip }, async () => {
  const enqueue = (tenantId, key) => outbox.enqueueFinanceEvent({ tenantId, eventType: 'sync_lead_deal_value', refType: 'lead', refId: key, dedupeKey: key, payload: { n: 1 } });
  await enqueue(T, 'k-1'); await enqueue(T, 'k-1'); await enqueue(OTHER, 'k-1');
  assert.equal((await pool.query("SELECT id FROM finance_outbox WHERE tenant_id=? AND dedupe_key='k-1'", [T]))[0].length, 1, 'asking again queues nothing more');
  assert.equal((await pool.query("SELECT id FROM finance_outbox WHERE tenant_id=? AND dedupe_key='k-1'", [OTHER]))[0].length, 1, 'the other institute\'s key is its own');
  await assert.rejects(outbox.enqueueFinanceEvent({ eventType: 'x' }), /required/);
  await assert.rejects(outbox.enqueueFinanceEvent({ tenantId: T }), /required/);
});

test('a drain handles each event once, retries a failure later, buries it on the sixth, and takes back what a dead worker held', { skip }, async () => {
  await pool.query('DELETE FROM finance_outbox WHERE tenant_id IN (?, ?)', [T, OTHER]);
  for (let i = 1; i <= 4; i += 1) await outbox.enqueueFinanceEvent({ tenantId: T, eventType: 'ok_event', refId: `r${i}`, dedupeKey: `ok-${i}` });
  const seen = [];
  const handlers = { ok_event: async row => { seen.push(row.dedupe_key); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const [a, b] = await Promise.all([outbox.drainFinanceOutbox(handlers, 10), outbox.drainFinanceOutbox(handlers, 10)]);
  assert.equal(a + b, 4);
  assert.equal(new Set(seen).size, 4, 'no event twice');
  assert.ok((await pool.query("SELECT status FROM finance_outbox WHERE tenant_id=?", [T]))[0].every(item => item.status === 'processed'));

  await outbox.enqueueFinanceEvent({ tenantId: T, eventType: 'no_handler_event', refId: 'bad', dedupeKey: 'bad-1' });
  const bad = await idOf(T, 'bad-1');
  await outbox.drainFinanceOutbox({}, 10);
  let state = await rowOf(bad);
  assert.deepEqual([state.status, state.attempts, Number(state.later), state.locked_by], ['failed', 1, 1, null], 'failed once, due again later');
  assert.match(state.error_message, /No handler/);
  await pool.query('UPDATE finance_outbox SET attempts=?, next_attempt_at=NOW() WHERE id=?', [outbox.MAX_ATTEMPTS - 1, bad]);
  await outbox.drainFinanceOutbox({}, 10);
  assert.equal((await rowOf(bad)).status, 'dead', 'the last attempt buries it');

  await outbox.enqueueFinanceEvent({ tenantId: T, eventType: 'ok_event', refId: 'held', dedupeKey: 'held-1' });
  const held = await idOf(T, 'held-1');
  await pool.query("UPDATE finance_outbox SET status='processing', locked_by='worker-gone', locked_at=NOW() WHERE id=?", [held]);
  await outbox.drainFinanceOutbox(handlers, 10);
  assert.equal((await rowOf(held)).status, 'processing', 'a fresh claim is left to its worker');
  await pool.query("UPDATE finance_outbox SET locked_at=DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id=?", [held]);
  await outbox.drainFinanceOutbox(handlers, 10);
  assert.equal((await rowOf(held)).status, 'processed', 'a worker that died holding it loses it after 15 minutes');
});

test('only the central books list the outbox and retry a failed or dead event, and never another institute\'s', { skip }, async () => {
  const dead = await idOf(T, 'bad-1');
  await outbox.enqueueFinanceEvent({ tenantId: OTHER, eventType: 'no_handler_event', refId: 'x', dedupeKey: 'other-bad' });
  await outbox.drainFinanceOutbox({}, 50);
  const otherId = await idOf(OTHER, 'other-bad');
  const listed = await call('get', '/api/admin/finance-outbox', { query: { status: 'dead' } });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body.rows.map(row => row.id), [dead], 'this institute\'s dead event only');
  assert.equal((await call('get', '/api/admin/finance-outbox', { who: BRANCH })).statusCode, 403, 'a branch does not see the central outbox');
  assert.equal((await call('post', '/api/admin/finance-outbox/:id/retry', { params: { id: dead }, who: VIEWER })).statusCode, 403, 'view_financial alone cannot retry');
  assert.equal((await call('post', '/api/admin/finance-outbox/:id/retry', { params: { id: dead }, who: BRANCH })).statusCode, 403);
  assert.equal((await call('post', '/api/admin/finance-outbox/:id/retry', { params: { id: otherId } })).statusCode, 404, 'not another institute\'s');
  const done = await call('post', '/api/admin/finance-outbox/:id/retry', { params: { id: dead } });
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual([(await rowOf(dead)).status, (await rowOf(dead)).attempts], ['pending', 0], 'back in the queue from the start');
  const processedOne = (await pool.query("SELECT id FROM finance_outbox WHERE tenant_id=? AND status='processed' LIMIT 1", [T]))[0][0].id;
  assert.equal((await call('post', '/api/admin/finance-outbox/:id/retry', { params: { id: processedOne } })).statusCode, 404, 'only a failed or dead one');
});

test('the dashboard names a paid payment with no entry, an unbalanced entry and the failed events — this institute\'s only — and clears them when fixed', { skip }, async () => {
  const pay = (tenant, sub, id) => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, status, payment_type, payment_method, date, branch_id)
     VALUES (?, ?, ?, 500, 500, 'EGP', 'paid', 'OTHER', 'كاش', NOW(), 'branch-online-egypt')`, [id, tenant, sub]);
  await pay(T, 'sub-fo-1', 'p-fo-1'); await pay(OTHER, 'sub-fo-other', 'p-fo-other');
  const without = await check('paid_without_journal');
  assert.deepEqual(without.rows.map(row => row.id), ['p-fo-1'], 'this institute\'s payment, not the other\'s');
  assert.ok((await call('get', '/api/admin/reconciliation-dashboard')).body.criticalCount > 0);

  await pool.query("INSERT INTO journal_entries (id, tenant_id, ref_type, ref_id, entry_date, description, total_debit, total_credit, posted_by, branch_id) VALUES ('je-fo-1', ?, 'payment', 'p-fo-1', CURDATE(), 'دفعة', 500, 500, 'x', 'branch-online-egypt')", [T]);
  await pool.query("INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit) VALUES (UUID(), 'je-fo-1', '1100', 'نقدية', 500, 0), (UUID(), 'je-fo-1', '4100', 'إيراد', 0, 400)");
  assert.equal((await check('paid_without_journal')).count, 0, 'with its entry it is no longer named');
  const unbalanced = await check('unbalanced_journal');
  assert.deepEqual(unbalanced.rows.map(row => row.id), ['je-fo-1'], 'but the entry does not balance');
  await pool.query("UPDATE journal_entry_lines SET credit=500 WHERE entry_id='je-fo-1' AND account_code='4100'");
  assert.equal((await check('unbalanced_journal')).count, 0);

  await outbox.enqueueFinanceEvent({ tenantId: T, eventType: 'no_handler_event', refId: 'again', dedupeKey: 'again-1' });
  await outbox.drainFinanceOutbox({}, 50);
  const failed = await check('failed_finance_events');
  const ids = failed.rows.map(row => row.id);
  assert.ok(ids.includes(await idOf(T, 'again-1')), 'a failed event of this institute shows');
  assert.ok(!ids.includes(await idOf(OTHER, 'other-bad')), 'the other institutes one does not');
  assert.equal((await call('get', '/api/admin/reconciliation-dashboard', { who: staff('st-fo-x', 'sales', ['view_leads']) })).statusCode, 403);
});
