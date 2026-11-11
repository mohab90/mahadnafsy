'use strict';
/**
 * The owner's complaint about «الخزن»: «مش بيظهر كل الخزن المضافة» and «فودافون كاش مصري ظاهر فيه بالريال». On a real MariaDB, with the boxes the way an institute really
 * has them: pounds, riyals and dollars, an Egyptian Vodafone wallet beside a Saudi one, a box added in the settings that nothing has moved in yet, one whose only
 * movement is an expense, one merged into another, one with money in two currencies, and one that was removed from the settings and still holds money.
 * Before the fix: «بنك الراجحي» was read as pounds and shown as «تحويل بنكي»; every riyal went to whichever riyal box was listed first (the Saudi Vodafone shown as plain
 * «فودافون كاش» in riyals, holding the other boxes' money, while أحمد السعودية showed 0); a Saudi box in the settings was not on the screen under its own name.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-box-list-it';
let pool; let boxes;

const staff = (id, permissions, extra = {}) => ({ id, name: id, role: 'accountant', permissions_json: JSON.stringify(permissions), ...extra });
const ACCOUNTS = staff('st-bl-acc', ['view_financial', 'manage_financial']);
const BRANCH = staff('st-bl-br', ['view_financial'], { data_scope: 'branch:DAQQI', branch_id: 'branch-daqqi' });

const LISTED = [
  'خزنة الدقي - كاش', 'فودافون كاش 4645', 'فودافون كاش السعودية', 'تحويل لأحمد السعودية', 'ويسترن يونيون', 'انستا باي 7720', 'بنك الراجحي', 'محفظة جديدة 9090',
  'فودافون كاش 1079', 'انستا باي 6046',
];

async function call(method, path, { who = ACCOUNTS, body = {} } = {}) {
  const layer = boxes.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: {}, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-bl@example.test', tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const report = async who => (await call('get', '/api/admin/finance/boxes', { who })).body;
const options = async who => (await call('get', '/api/admin/finance/box-options', { who })).body;
const find = (rows, method, currency) => rows.find(row => row.method === method && row.currency === currency);

let seq = 0;
const payment = (method, amount, currency = 'EGP', extra = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, status, payment_type, payment_method, date, branch_id, created_at, deleted_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'OTHER', ?, NOW(), ?, NOW(), ?)`,
  [`bl-p-${++seq}`, T, extra.sub || 'sub-bl-1', amount, amount, currency, extra.status || 'paid', method, extra.branch || 'branch-online-egypt', extra.deleted ? new Date() : null]);
const expense = (box, amount, currency = 'EGP') => pool.query(
  `INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, category, date, box_method) VALUES (?, ?, 'مصروف', ?, ?, ?, 'OTHER', NOW(), ?)`,
  [`bl-e-${++seq}`, T, amount, currency, amount, box]);

async function clean() {
  for (const table of ['accounting_periods', 'box_withdrawals', 'box_aliases', 'box_balance_events', 'box_balances', 'expenses', 'payments', 'subscribers', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  boxes = require('../../routes/finance/budgets');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-bl-1', ?, 'عميل', '1019700010', 'ONLINE_EGYPT', 'branch-online-egypt'), ('sub-bl-2', ?, 'عميل الدقي', '1019700011', 'DAQQI', 'branch-daqqi')", [T, T]);
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('content', { 'finance.payment_methods': LISTED.join('||') }, { tenantId: T });
  await pool.query("INSERT INTO box_aliases (tenant_id, alias, target) VALUES (?, 'فودافون كاش 1010', 'فودافون كاش 1079')", [T]);

  await payment('فودافون كاش 4645', 1000); // the Egyptian wallet, in pounds
  await payment('فودافون كاش 4645', 200, 'SAR'); // a Saudi client's riyals typed on the Egyptian wallet's name
  await payment('فودافون كاش السعودية', 300, 'SAR');
  await payment('بنك الراجحي', 500, 'SAR');
  await payment('تحويل لأحمد السعودية', 40, 'SAR');
  await payment('ويسترن يونيون', 100, 'USD');
  await payment('ويسترن يونيون', 25); // a box with money in two currencies: pounds are not the dollar box's
  await payment('فودافون كاش 1010', 70); // merged into 1079
  await payment('بنك قديم', 77); // a box removed from the settings that still holds money
  await payment('فودافون كاش 4645', 5000, 'EGP', { status: 'pending' }); // not paid: nobody's balance
  await payment('فودافون كاش 4645', 9000, 'EGP', { deleted: true }); // deleted: nobody's balance
  await expense('انستا باي 7720', 60); // a box whose only movement is an expense
  await expense('انستا باي 6046', 15, 'SAR');
  await payment('انستا باي 6046', 10, 'EGP', { branch: 'branch-daqqi', sub: 'sub-bl-2' });
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('every box in the settings is on the boxes screen under its own name, with a zero balance when nothing moved in it', { skip }, async () => {
  const { boxes: shown } = await report();
  for (const [method, currency] of [
    ['خزنة الدقي - كاش', 'EGP'], ['فودافون كاش 4645', 'EGP'], ['فودافون كاش السعودية', 'SAR'], ['أحمد السعودية', 'SAR'], ['ويسترن يونيون', 'USD'],
    ['انستا باي 7720', 'EGP'], ['بنك الراجحي', 'SAR'], ['محفظة جديدة 9090', 'EGP'], ['فودافون كاش 1079', 'EGP'], ['انستا باي 6046', 'EGP'],
  ]) assert.ok(find(shown, method, currency), `${method} (${currency}) is on the screen`);
  assert.equal(find(shown, 'محفظة جديدة 9090', 'EGP').balance, 0, 'a box nothing moved in yet');
  assert.equal(find(shown, 'محفظة جديدة 9090', 'EGP').listed, true);
});

test('each box is in its own currency and holds only its own money', { skip }, async () => {
  const { boxes: shown } = await report();
  assert.equal(find(shown, 'فودافون كاش 4645', 'EGP').balance, 1000, 'the Egyptian wallet: its pounds only — not the pending or the deleted payment');
  assert.equal(find(shown, 'فودافون كاش 4645', 'SAR'), undefined, 'the Egyptian wallet is never a riyal box');
  assert.equal(shown.filter(box => /^فودافون كاش/.test(box.method) && box.currency === 'SAR').map(box => box.method).join(), 'فودافون كاش السعودية', 'the only Vodafone in riyals is the Saudi one');
  assert.equal(find(shown, 'فودافون كاش السعودية', 'SAR').balance, 300, 'the Saudi wallet holds what was paid on it, not every riyal there is');
  assert.equal(find(shown, 'بنك الراجحي', 'SAR').balance, 500, 'a Saudi bank is a riyal box, not «تحويل بنكي» in pounds');
  assert.equal(find(shown, 'أحمد السعودية', 'SAR').balance, 40);
  assert.equal(find(shown, 'ويسترن يونيون', 'USD').balance, 100);
  assert.equal(find(shown, 'ويسترن يونيون', 'EGP'), undefined, 'pounds typed on the dollar box are not a box of its own');
  assert.equal(find(shown, 'فودافون كاش 1079', 'EGP').balance, 70, 'the merged number is the box it was merged into');
  assert.equal(find(shown, 'انستا باي 7720', 'EGP').balance, -60, 'a box whose only movement is an expense');
  assert.equal(find(shown, 'انستا باي 6046', 'EGP').balance, 10, 'a riyal expense is not taken from the pound box');
  assert.ok(shown.filter(box => !box.unlisted && box.currency === 'SAR').every(box => /السعودية|الراجحي/.test(box.method)), 'riyals only on the Saudi boxes');
});

test('money in no listed box is on the screen as «أخرى», marked as unlisted, with what it holds', { skip }, async () => {
  const { boxes: shown } = await report();
  const other = find(shown, 'أخرى', 'EGP');
  assert.deepEqual([other.balance, other.unlisted, other.listed], [77 + 25, true, false], 'the removed box (77) and the pounds typed on the dollar box (25)');
  const riyals = find(shown, 'أخرى', 'SAR');
  assert.deepEqual([riyals.balance, riyals.unlisted], [200 - 15, true], 'riyals typed on a wallet that is not Saudi, with three riyal boxes to choose from, less the riyal expense of a pound box');
});

test('the expense form and the withdrawal pick from exactly the boxes the report shows, in the same currency and with the same balance', { skip }, async () => {
  const { boxes: shown } = await report();
  const picker = await options();
  const flat = rows => rows.map(box => `${box.method}|${box.currency}|${box.balance}`).sort();
  assert.deepEqual(flat(picker), flat(shown));
  const noBooks = await options(staff('st-bl-x', ['manage_financial'], { data_scope: 'branch:DAQQI' }));
  assert.deepEqual(noBooks.map(box => `${box.method}|${box.currency}`).sort(), shown.map(box => `${box.method}|${box.currency}`).sort(), 'whoever records an expense sees every box');
  assert.ok(noBooks.every(box => box.balance === null), 'but not the balances');
});

test('a transfer goes only to a listed box that holds the same currency', { skip }, async () => {
  const transfer = body => call('post', '/api/admin/finance/boxes/withdraw', { body: { kind: 'transfer', amount: 100, ...body } });
  const wrongCurrency = await transfer({ method: 'بنك الراجحي', currency: 'SAR', toMethod: 'فودافون كاش 4645' });
  assert.equal(wrongCurrency.statusCode, 400, JSON.stringify(wrongCurrency.body));
  assert.equal(wrongCurrency.body.code, 'WITHDRAW_TARGET_CURRENCY');
  const unknown = await transfer({ method: 'بنك الراجحي', currency: 'SAR', toMethod: 'خزنة مش موجودة' });
  assert.equal(unknown.body.code, 'WITHDRAW_TARGET_CURRENCY');
  assert.equal(find((await report()).boxes, 'بنك الراجحي', 'SAR').balance, 500, 'nothing moved');
  const ok = await transfer({ method: 'بنك الراجحي', currency: 'SAR', toMethod: 'فودافون كاش السعودية' });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const { boxes: shown } = await report();
  assert.equal(find(shown, 'بنك الراجحي', 'SAR').balance, 400);
  assert.equal(find(shown, 'فودافون كاش السعودية', 'SAR').balance, 400);
});

test('a branch sees only its own clients\' money, in the boxes it was paid into', { skip }, async () => {
  const view = await report(BRANCH);
  assert.equal(view.balances, null);
  assert.deepEqual(view.boxes.map(box => [box.method, box.currency]), [['انستا باي 6046', 'EGP']]);
});

test('a withdrawal dated in a closed accounting period is refused with the period\'s own message, whatever its kind — a transfer included', { skip }, async () => {
  await pool.query("INSERT INTO accounting_periods (id, period_label, status, tenant_id, closed_at) VALUES ('bl-period-1', '2026-03', 'closed', ?, NOW())", [T]);
  try {
    const before = find((await report()).boxes, 'بنك الراجحي', 'SAR').balance;
    const attempts = [
      { kind: 'transfer', toMethod: 'فودافون كاش السعودية' },
      { kind: 'partner', partner: 'mohab' },
      { kind: 'expense', accountCode: '5100' },
    ];
    for (const extra of attempts) {
      const res = await call('post', '/api/admin/finance/boxes/withdraw', { body: { method: 'بنك الراجحي', currency: 'SAR', amount: 10, date: '2026-03-15', ...extra } });
      assert.equal(res.statusCode, 409, `${extra.kind}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'ACCOUNTING_PERIOD_CLOSED', extra.kind);
      assert.match(res.body.error, /مقفولة/, extra.kind);
    }
    assert.equal(find((await report()).boxes, 'بنك الراجحي', 'SAR').balance, before, 'nothing was taken out');
    const open = await call('post', '/api/admin/finance/boxes/withdraw', { body: { kind: 'transfer', toMethod: 'فودافون كاش السعودية', method: 'بنك الراجحي', currency: 'SAR', amount: 10, date: '2026-04-15' } });
    assert.equal(open.statusCode, 200, 'a date in an open period still works');
  } finally {
    await pool.query("DELETE FROM accounting_periods WHERE tenant_id=?", [T]);
  }
});
