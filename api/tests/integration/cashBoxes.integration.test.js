'use strict';
/**
 * The cash boxes («الخزائن»), on a real MariaDB (these were regular expressions over routes/finance/budgets.js, lib/boxBalances.js and lib/boxWithdrawals.js —
 * `BOXES_MAIN_BOOKS_ONLY`, `mainBooks`, `value.balance !== 0`, the routes of withdraw / void / merge / reset): a box's balance is what came in under that name, however it was
 * typed, less what was refunded, until it is reset or set to what was counted; money is taken out for a partner, an expense account or another box, an entry that balances
 * is posted for all but a transfer, a withdrawal bigger than the balance needs a confirmation, and a voided one is reversed once; merging adds the balances; only the
 * institute's main books and only manage_financial change any of it, and a branch's view has no balances. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-boxes-it';
let pool; let boxes;
const CASH = 'خزنة الدقي - كاش';

const staff = (id, role, permissions, extra = {}) => ({ id, name: id, role, permissions_json: JSON.stringify(permissions), ...extra });
const ACCOUNTS = staff('st-bx-acc', 'accountant', ['view_financial', 'manage_financial']);
const VIEWER = staff('st-bx-view', 'accountant', ['view_financial']);
const BRANCH = staff('st-bx-br', 'accountant', ['view_financial', 'manage_financial'], { data_scope: 'branch:DAQQI', branch_id: 'branch-daqqi' });

async function call(method, path, { body = {}, query = {}, who = ACCOUNTS } = {}) {
  const layer = boxes.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: {}, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-bx@example.test', tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const list = async who => (await call('get', '/api/admin/finance/boxes', { who })).body;
const balanceOf = async (method, currency = 'EGP') => (await list()).boxes.find(box => box.method === method && box.currency === currency)?.balance;

let seq = 0;
const payment = (method, amount, extra = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, status, payment_type, payment_method, date, branch_id, source, created_at)
   VALUES (?, ?, ?, ?, ?, ?, 'paid', 'OTHER', ?, ${extra.later ? 'DATE_ADD(NOW(), INTERVAL 5 SECOND)' : 'NOW()'}, ?, ?, ${extra.later ? 'DATE_ADD(NOW(), INTERVAL 5 SECOND)' : 'NOW()'})`,
  [`bx-p-${++seq}`, T, extra.sub || 'sub-bx-1', amount, amount, extra.currency || 'EGP', method, extra.branch || 'branch-online-egypt', extra.source || null]);

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'box_withdrawals', 'box_aliases', 'box_balance_events', 'box_balances', 'payments', 'subscribers', 'tenant_chart_of_accounts', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  boxes = require('../../routes/finance/budgets');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-bx-acc', ?, 'المحاسب', 'acc-bx@example.test', '1019600001', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-bx-view', ?, 'مشاهد', 'view-bx@example.test', '1019600002', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-bx-br', ?, 'محاسب فرع', 'br-bx@example.test', '1019600003', 'ACCOUNTANT', 1, '2025-01-01')`, [T, T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-bx-1', ?, 'عميل', '1019600010', 'ONLINE_EGYPT', 'branch-online-egypt'), ('sub-bx-2', ?, 'عميل الدقي', '1019600011', 'DAQQI', 'branch-daqqi')", [T, T]);
  await pool.query("INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES (?, '1100', 'نقدية وبنوك', 'asset', 1), (?, '5100', 'مصروفات تشغيل', 'expense', 1), (?, '4100', 'إيراد', 'revenue', 1)", [T, T, T]);
  await payment(CASH, 1000);
  await payment('خزنة  الدقي - كاش', 500);  // the same box typed with a double space
  await payment(CASH, -200, { source: 'refund' }); // a refund leaves the box it came from
  await payment('فودافون كاش', 300);
  await payment('انستا باي', 50, { branch: 'branch-daqqi', sub: 'sub-bx-2' });
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a box counts what came in under its name however it was typed, less refunds; a branch sees no balances', { skip }, async () => {
  assert.equal(await balanceOf(CASH), 1300, '1,000 + 500 − 200');
  assert.equal(await balanceOf('فودافون كاش'), 300);
  const cashBox = (await list()).boxes.find(box => box.method === CASH);
  assert.deepEqual([cashBox.totals[1], cashBox.counts[1]], [1300, 2], 'today: what came in today, net of the refund, and how many payments');
  assert.deepEqual([cashBox.yesterday.total, cashBox.yesterday.count], [0, 0], 'yesterday has its own window');
  const view = await list(VIEWER);
  assert.ok(view.balances, 'whoever reads the books sees the balances');
  assert.equal(view.balances.canManage, false, 'but cannot change them');
  const branch = await list(BRANCH);
  assert.equal(branch.balances, null, 'a branch\'s view has no balances');
  assert.ok(branch.boxes.every(box => box.balance === undefined), 'nor a box balance');
  assert.deepEqual(branch.boxes.map(box => box.method), ['انستا باي'], 'only its own money');
});

test('only the institute\'s main books with manage_financial change a box', { skip }, async () => {
  const reset = who => call('post', '/api/admin/finance/boxes/reset', { who, body: { method: 'فودافون كاش', currency: 'EGP' } });
  assert.equal((await reset(VIEWER)).statusCode, 403, 'view_financial alone');
  const branch = await reset(BRANCH);
  assert.equal(branch.statusCode, 403);
  assert.equal(branch.body.code, 'BOXES_MAIN_BOOKS_ONLY');
  assert.equal(await balanceOf('فودافون كاش'), 300, 'nothing changed');
});

test('setting a box to what was counted and resetting it start it again; later payments add to it, and every change is audited', { skip }, async () => {
  const set = await call('post', '/api/admin/finance/boxes/balance', { body: { method: 'فودافون كاش', currency: 'EGP', amount: 1000, note: 'جرد' } });
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  assert.deepEqual([set.body.before, set.body.after], [300, 1000]);
  assert.equal(await balanceOf('فودافون كاش'), 1000);
  await payment('فودافون كاش', 40);
  assert.equal(await balanceOf('فودافون كاش'), 1040, 'a later payment adds to the counted figure');
  const reset = await call('post', '/api/admin/finance/boxes/reset', { body: { method: 'فودافون كاش', currency: 'EGP', note: 'بداية جديدة' } });
  assert.equal(reset.statusCode, 200, JSON.stringify(reset.body));
  assert.equal(await balanceOf('فودافون كاش'), 0);
  await payment('فودافون كاش', 25, { later: true });
  assert.equal(await balanceOf('فودافون كاش'), 25, 'only what comes in after counts');
  const audit = (await pool.query("SELECT action FROM financial_audit_log WHERE tenant_id=? AND entity_type='cash_box' ORDER BY created_at, id", [T]))[0].map(item => item.action);
  assert.deepEqual(audit.filter(action => action !== 'box_withdraw').sort(), ['box_reset', 'box_set_balance']);
  const history = await call('get', '/api/admin/finance/boxes/history');
  assert.ok(history.body.length >= 2, 'the history says what was changed');
});

test('a withdrawal for a partner or an expense posts a balanced entry, a transfer posts none, more than the balance needs a confirmation, and a void reverses once', { skip }, async () => {
  const withdraw = body => call('post', '/api/admin/finance/boxes/withdraw', { body: { method: CASH, currency: 'EGP', ...body } });
  assert.equal((await withdraw({ kind: 'nonsense', amount: 10 })).statusCode, 400);
  assert.equal((await withdraw({ kind: 'partner', amount: 0, partner: 'mohab' })).body.code, 'WITHDRAW_AMOUNT');
  assert.equal((await withdraw({ kind: 'partner', amount: 10, partner: 'stranger' })).body.code, 'WITHDRAW_PARTNER');
  assert.equal((await withdraw({ kind: 'expense', amount: 10, accountCode: '4100' })).body.code, 'WITHDRAW_ACCOUNT', 'an expense goes to an expense account');
  const tooMuch = await withdraw({ kind: 'partner', amount: 5000, partner: 'mohab' });
  assert.equal(tooMuch.statusCode, 409);
  assert.equal(tooMuch.body.code, 'BOX_INSUFFICIENT');
  assert.equal(await balanceOf(CASH), 1300, 'nothing left the box');

  const partner = await withdraw({ kind: 'partner', amount: 300, partner: 'mohab', note: 'سحب شخصي' });
  assert.equal(partner.statusCode, 200, JSON.stringify(partner.body));
  assert.deepEqual([partner.body.before, partner.body.after], [1300, 1000]);
  assert.equal(await balanceOf(CASH), 1000);
  const [lines] = await pool.query('SELECT account_code, debit, credit FROM journal_entry_lines WHERE entry_id=?', [partner.body.journalId]);
  const by = Object.fromEntries(lines.map(line => [line.account_code, [Number(line.debit), Number(line.credit)]]));
  assert.deepEqual(by['3310'], [300, 0], 'the partner\'s drawings account');
  assert.deepEqual(by['1100'], [0, 300], 'out of cash');

  const expense = await withdraw({ kind: 'expense', amount: 100, accountCode: '5100' });
  assert.equal(expense.statusCode, 200, JSON.stringify(expense.body));
  const transfer = await withdraw({ kind: 'transfer', amount: 200, toMethod: 'انستا باي' });
  assert.equal(transfer.statusCode, 200, JSON.stringify(transfer.body));
  assert.equal(transfer.body.journalId, null, 'a transfer posts nothing: both boxes are in cash');
  assert.equal(await balanceOf(CASH), 700);
  assert.equal(await balanceOf('انستا باي'), 250, 'the other box gained what this one lost');
  assert.equal((await withdraw({ kind: 'transfer', amount: 10, toMethod: CASH })).body.code, 'WITHDRAW_TARGET', 'not to itself');
  const forced = await withdraw({ kind: 'other', amount: 800, accountCode: '5100', force: true });
  assert.equal(forced.statusCode, 200, 'confirmed, it goes through');

  const voided = await call('post', '/api/admin/finance/boxes/withdrawals/void', { body: { id: partner.body.id } });
  assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
  assert.equal(await balanceOf(CASH), 200, 'the partner 300 came back: 1,300 - 300 - 100 - 200 - 800 + 300');
  const again = await call('post', '/api/admin/finance/boxes/withdrawals/void', { body: { id: partner.body.id } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.code, 'WITHDRAW_VOIDED');
  assert.equal((await call('post', '/api/admin/finance/boxes/withdrawals/void', { body: { id: 'nope' } })).statusCode, 404);
  const [[net]] = await pool.query("SELECT SUM(CASE WHEN account_code='1100' THEN credit - debit ELSE 0 END) AS cash_out FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=? AND ref_type IN ('box_withdrawal','box_withdrawal_void') AND ref_id=?)", [T, partner.body.id]);
  assert.equal(Number(net.cash_out), 0, 'the voided withdrawal nets to nothing in the books');

  const listed = await call('get', '/api/admin/finance/boxes/withdrawals', { query: { kind: 'partner' } });
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.body.rows.some(row => row.id === partner.body.id && row.voided), 'the voided one is listed, marked');
  const mohab = listed.body.partners.find(item => item.key === 'mohab');
  assert.deepEqual([mohab.count, mohab.totals.EGP ?? 0], [0, 0], 'and left out of what the partner took');
});

test('merging a box into another adds the balances and reads its payments under the new name', { skip }, async () => {
  await payment('محفظة قديمة', 70);
  assert.equal(await balanceOf('محفظة قديمة'), 70);
  const before = await balanceOf('انستا باي');
  const merged = await call('post', '/api/admin/finance/boxes/merge', { body: { from: 'محفظة قديمة', into: 'انستا باي', note: 'نفس الحساب' } });
  assert.equal(merged.statusCode, 200, JSON.stringify(merged.body));
  assert.equal(await balanceOf('انستا باي'), before + 70, 'the balances are added');
  assert.equal(await balanceOf('محفظة قديمة'), undefined, 'the old name is no longer a box');
  await payment('محفظة قديمة', 5, { later: true });
  assert.equal(await balanceOf('انستا باي'), before + 75, 'a payment still typed with the old name lands in the new box');
});
