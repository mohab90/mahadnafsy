'use strict';

// «في ارصدة الخزن زر سحب من الرصيد ونحدد التوجيه المحاسبي له، ممكن يكون سحب شخصي مهاب أو وليد لأنهم شركاء، وجدول بالأرصدة اللي سحبها مهاب واللي سحبها وليد من كل
// الخزن … وفودافون كاش 1010 هو هو فودافون كاش 1079» (28 Oct 2026).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-box-withdrawals-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const finance = require('../lib/finance');
const boxes = require('../lib/boxBalances');
const withdrawals = require('../lib/boxWithdrawals');

const flat = sql => String(sql).replace(/\s+/g, ' ').trim();
const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

/** The tables the boxes read and write, kept in memory, with a clock the test moves. */
function world({ payments = [], chart = [] } = {}) {
  const state = { balances: new Map(), events: [], aliases: new Map(), withdrawals: [], chart: [...chart], clock: 1000, journals: [] };
  const key = (method, currency) => `${method}|${currency}`;
  return {
    state,
    async query(sql, params = []) {
      const text = flat(sql);
      if (/^SELECT method, currency, opening_amount, baseline_at FROM box_balances/.test(text)) {
        return [[...state.balances].map(([k, v]) => ({ method: k.split('|')[0], currency: k.split('|')[1], opening_amount: v.opening, baseline_at: v.baseline }))];
      }
      if (/^SELECT alias, target FROM box_aliases/.test(text)) return [[...state.aliases].map(([alias, target]) => ({ alias, target }))];
      if (/^INSERT INTO box_aliases/.test(text)) { state.aliases.set(params[1], params[2]); return [{ affectedRows: 1 }]; }
      if (/^UPDATE box_aliases SET target = \?/.test(text)) { for (const [alias, target] of state.aliases) if (target === params[2]) state.aliases.set(alias, params[0]); return [{ affectedRows: 1 }]; }
      if (/^DELETE FROM box_balances WHERE tenant_id = \? AND method = \?/.test(text)) {
        for (const k of [...state.balances.keys()]) if (k.startsWith(`${params[1]}|`)) state.balances.delete(k);
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT p\.payment_method AS method, p\.currency, SUM\(p\.amount\) AS total FROM payments p/.test(text)) {
        const since = /p\.created_at > \?/.test(text) ? params[1] : null;
        const sums = new Map();
        for (const payment of payments.filter(row => since === null || row.at > since)) {
          sums.set(key(payment.method, payment.currency), (sums.get(key(payment.method, payment.currency)) || 0) + payment.amount);
        }
        return [[...sums].map(([k, total]) => ({ method: k.split('|')[0], currency: k.split('|')[1], total }))];
      }
      if (/^SELECT method, to_method, currency, kind, SUM\(amount\) AS total FROM box_withdrawals/.test(text)) {
        const since = /created_at > \?/.test(text) ? params[1] : null;
        const groups = new Map();
        for (const row of state.withdrawals.filter(item => !item.voided && (since === null || item.at > since))) {
          const k = [row.method, row.to_method, row.currency, row.kind].join('|');
          groups.set(k, { method: row.method, to_method: row.to_method, currency: row.currency, kind: row.kind, total: (groups.get(k)?.total || 0) + row.amount });
        }
        return [[...groups.values()]];
      }
      if (/^INSERT INTO box_balances/.test(text)) {
        const [, method, currency, opening] = params;
        const previous = state.balances.get(key(method, currency));
        state.balances.set(key(method, currency), { opening, baseline: /baseline_at=NOW\(\)/.test(text) ? state.clock : (previous?.baseline ?? null) });
        return [{ affectedRows: 1 }];
      }
      if (/^INSERT INTO box_balance_events/.test(text)) { state.events.push({ kind: params[4], before: params[5], after: params[6], method: params[2], note: params[7] }); return [{}]; }
      if (/^SELECT code, name, type, is_active FROM tenant_chart_of_accounts/.test(text)) return [[state.chart.find(row => row.code === params[1])].filter(Boolean)];
      if (/^INSERT INTO tenant_chart_of_accounts/.test(text)) { if (!state.chart.some(row => row.code === params[1])) state.chart.push({ code: params[1], name: params[2], type: 'equity', is_active: 1 }); return [{}]; }
      if (/^INSERT INTO box_withdrawals/.test(text)) {
        const [id, , method, currency, amount, kind, partner, to_method, account_code, account_name, journal_entry_id, note, withdrawn_on, actor] = params;
        state.withdrawals.push({ id, method, currency, amount, kind, partner, to_method, account_code, account_name, journal_entry_id, note, withdrawn_on, actor, at: state.clock, voided: false });
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT \* FROM box_withdrawals WHERE tenant_id = \? AND id = \?/.test(text)) {
        const row = state.withdrawals.find(item => item.id === params[1]);
        return [row ? [{ ...row, voided_at: row.voided ? 'x' : null }] : []];
      }
      if (/^UPDATE box_withdrawals SET voided_at = NOW\(\)/.test(text)) { state.withdrawals.find(item => item.id === params[2]).voided = true; return [{ affectedRows: 1 }]; }
      if (/^SELECT id, method, currency, amount, kind, partner, to_method/.test(text)) {
        return [state.withdrawals.slice().reverse().map(row => ({ ...row, withdrawn_on: row.withdrawn_on, voided_at: row.voided ? 'x' : null, created_at: row.at }))];
      }
      throw new Error(`unexpected: ${text}`);
    },
  };
}

const pay = (method, amount, at, currency = 'EGP') => ({ method, currency, amount, at });
const balance = async (db, method, currency = 'EGP') => (await boxes.currentBalances(db, { tenantId: 't1' })).get(`${method}|${currency}`)?.balance;

// The books: every journal posted is kept, and the FX is 1:1 for EGP.
let posted = [];
const originalPost = finance.postJournalEntry;
const originalToEgp = finance.toEgp;
test.before(() => {
  finance.postJournalEntry = async (refType, refId, date, description, lines) => { posted.push({ refType, refId, date, description, lines }); return `je-${posted.length}`; };
  finance.toEgp = async (amount, currency) => (currency === 'EGP' ? amount : amount * 14);
});
test.after(() => { finance.postJournalEntry = originalPost; finance.toEgp = originalToEgp; });
const take = (db, input, extra = {}) => withdrawals.withdraw(db, { tenantId: 't1', actor: 'محاسب', today: '2026-10-28', input, ...extra });

test('a partner\'s drawing takes the money out of the box and is booked to his drawings account against cash', async () => {
  posted = [];
  const db = world({ payments: [pay('خزنة الدقي - كاش', 5000, 1)] });
  const result = await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 1200, kind: 'partner', partner: 'mohab', note: 'سحب شخصي' });
  assert.deepEqual([result.before, result.after], [5000, 3800]);
  assert.equal(await balance(db, 'خزنة الدقي - كاش'), 3800, 'the box balance follows');
  assert.deepEqual(db.state.chart, [{ code: '3310', name: 'مسحوبات شخصية — مهاب', type: 'equity', is_active: 1 }], 'his account is made in the chart on first use');
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].lines, [
    { account_code: '3310', account_name: 'مسحوبات شخصية — مهاب', debit: 1200, credit: 0 },
    { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0, credit: 1200 },
  ]);
  assert.equal(posted[0].refType, 'box_withdrawal');
  assert.equal(posted[0].date, '2026-10-28');
  assert.equal(db.state.events.at(-1).kind, 'withdraw');
  assert.match(db.state.events.at(-1).note, /سحب شخصي — مهاب/);
});

test('an expense is directed to an expense account of the chart, any other account to that account, and nothing else is accepted', async () => {
  posted = [];
  const chart = [{ code: '5100', name: 'مصروفات عامة', type: 'expense', is_active: 1 }, { code: '2100', name: 'دائنون', type: 'liability', is_active: 1 }, { code: '5900', name: 'موقوف', type: 'expense', is_active: 0 }];
  const db = world({ payments: [pay('انستا باي 1010', 9000, 1)], chart });
  await take(db, { method: 'انستا باي 1010', currency: 'EGP', amount: 400, kind: 'expense', accountCode: '5100' });
  await take(db, { method: 'انستا باي 1010', currency: 'EGP', amount: 100, kind: 'other', accountCode: '2100' });
  assert.deepEqual(posted.map(entry => entry.lines[0].account_code), ['5100', '2100']);
  assert.equal(await balance(db, 'انستا باي 1010'), 8500);
  const refuses = (input, code) => assert.rejects(take(db, { method: 'انستا باي 1010', currency: 'EGP', amount: 10, ...input }), { code }, JSON.stringify(input));
  await refuses({ kind: 'expense', accountCode: '2100' }, 'WITHDRAW_ACCOUNT');   // a liability is not an expense
  await refuses({ kind: 'other', accountCode: '1100' }, 'WITHDRAW_ACCOUNT');   // cash against cash
  await refuses({ kind: 'other', accountCode: '5900' }, 'WITHDRAW_ACCOUNT');   // a stopped account
  await refuses({ kind: 'other', accountCode: '' }, 'WITHDRAW_ACCOUNT');
  await refuses({ kind: 'partner', partner: 'ahmed' }, 'WITHDRAW_PARTNER');
  await refuses({ kind: 'nonsense' }, 'WITHDRAW_KIND');
  await refuses({ kind: 'partner', partner: 'walid', amount: 0 }, 'WITHDRAW_AMOUNT');
  await refuses({ kind: 'partner', partner: 'walid', currency: 'GBP' }, 'BOX_CURRENCY');
  assert.equal(posted.length, 2, 'a refusal posts nothing');
});

test('a withdrawal larger than the box is refused unless it is confirmed', async () => {
  posted = [];
  const db = world({ payments: [pay('كاش', 300, 1)] });
  await assert.rejects(take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 500, kind: 'partner', partner: 'walid' }), { code: 'BOX_INSUFFICIENT', statusCode: 409 });
  assert.equal(posted.length, 0);
  const forced = await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 500, kind: 'partner', partner: 'walid', force: true });
  assert.deepEqual([forced.before, forced.after], [300, -200]);
});

test('a transfer moves money between two boxes and posts nothing; a foreign currency is booked in EGP', async () => {
  posted = [];
  const db = world({ payments: [pay('فودافون كاش 1010', 1000, 1), pay('أونلاين', 200, 1, 'SAR')] });
  await take(db, { method: 'فودافون كاش 1010', currency: 'EGP', amount: 400, kind: 'transfer', toMethod: 'خزنة الدقي - كاش' });
  assert.equal(await balance(db, 'فودافون كاش 1010'), 600);
  assert.equal(await balance(db, 'خزنة الدقي - كاش'), 400);
  assert.equal(boxes.totalOf(await boxes.currentBalances(db, { tenantId: 't1' }), 'EGP'), 1000, 'the total does not move');
  assert.equal(posted.length, 0);
  await assert.rejects(take(db, { method: 'فودافون كاش 1010', currency: 'EGP', amount: 1, kind: 'transfer', toMethod: 'فودافون كاش 1010' }), { code: 'WITHDRAW_TARGET' });
  await take(db, { method: 'أونلاين', currency: 'SAR', amount: 50, kind: 'partner', partner: 'mohab' });
  assert.equal(posted[0].lines[0].debit, 700, '50 SAR is booked as its EGP value');
  assert.equal(await balance(db, 'أونلاين', 'SAR'), 150);
});

test('only what is withdrawn after a reset counts against the box, and a voided withdrawal gives the money back and reverses the entry', async () => {
  posted = [];
  const payments = [pay('كاش', 1000, 1)];
  const db = world({ payments });
  db.state.clock = 2;
  const first = await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 300, kind: 'partner', partner: 'walid' });
  assert.equal(await balance(db, 'خزنة الدقي - كاش'), 700);
  db.state.clock = 10;
  await boxes.resetBox(db, { tenantId: 't1', method: 'خزنة الدقي - كاش', currency: 'EGP', actor: 'منى' });
  assert.equal(await balance(db, 'خزنة الدقي - كاش'), 0, 'the earlier withdrawal does not count after the reset');
  db.state.clock = 20;
  db.state.balances.set('خزنة الدقي - كاش|EGP', { opening: 500, baseline: 10 });
  const second = await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 200, kind: 'partner', partner: 'walid' }, { today: '2026-10-29' });
  assert.equal(await balance(db, 'خزنة الدقي - كاش'), 300);
  const voided = await withdrawals.voidWithdrawal(db, { tenantId: 't1', id: second.id, actor: 'مدير', today: '2026-10-30' });
  assert.deepEqual([voided.before, voided.after], [300, 500]);
  assert.equal(await balance(db, 'خزنة الدقي - كاش'), 500);
  const reversal = posted.at(-1);
  assert.equal(reversal.refType, 'box_withdrawal_void');
  assert.deepEqual(reversal.lines.map(line => [line.account_code, line.debit, line.credit]), [['1100', 200, 0], ['3320', 0, 200]]);
  await assert.rejects(withdrawals.voidWithdrawal(db, { tenantId: 't1', id: second.id, today: '2026-10-30' }), { code: 'WITHDRAW_VOIDED' });
  await assert.rejects(withdrawals.voidWithdrawal(db, { tenantId: 't1', id: 'nope', today: '2026-10-30' }), { code: 'WITHDRAW_MISSING' });
  assert.ok(first.id);
});

test('merging two boxes: one name from now on, one balance that is exactly the two added, and the merged box\'s own row is gone', async () => {
  const payments = [pay('فودافون كاش 1010', 700, 1), pay('فودافون كاش 1079', 300, 2)];
  const db = world({ payments });
  db.state.balances.set('فودافون كاش 1010|EGP', { opening: 50, baseline: null });
  db.state.balances.set('فودافون كاش 1079|EGP', { opening: -20, baseline: null });
  assert.equal(await balance(db, 'فودافون كاش 1010'), 750);
  assert.equal(await balance(db, 'فودافون كاش 1079'), 280);
  const result = await boxes.mergeBoxes(db, { tenantId: 't1', from: 'فودافون كاش 1079', into: 'فودافون كاش 1010', note: 'نفس الرقم', actor: 'محاسب' });
  assert.equal(result.into, 'فودافون كاش 1010');
  assert.deepEqual(result.balances, [{ currency: 'EGP', balance: 1030 }]);
  const after = await boxes.currentBalances(db, { tenantId: 't1' });
  assert.equal(after.get('فودافون كاش 1010|EGP').balance, 1030, 'the two balances added: 750 + 280');
  assert.equal(after.has('فودافون كاش 1079|EGP'), false, 'one box now');
  assert.equal(boxes.totalOf(after, 'EGP'), 1030);
  assert.equal(db.state.events.at(-1).kind, 'merge');
  assert.match(db.state.events.at(-1).method, /فودافون كاش 1079 ← دُمجت في فودافون كاش 1010/);
  // new payments typed either way join the one box, and a withdrawal named for the old one comes out of it
  payments.push(pay('فودافون كاش 1079', 100, 3));
  assert.equal(await balance(db, 'فودافون كاش 1010'), 1130);
  await take(db, { method: 'فودافون كاش 1079', currency: 'EGP', amount: 130, kind: 'partner', partner: 'mohab' });
  assert.equal(await balance(db, 'فودافون كاش 1010'), 1000);
});

test('a box cannot be merged into itself, into its own alias, or in a loop; a merge of merges ends at one name', async () => {
  const db = world({ payments: [pay('فودافون كاش 1010', 1, 1), pay('فودافون كاش 1079', 1, 1), pay('فودافون كاش 2222', 1, 1)] });
  await assert.rejects(boxes.mergeBoxes(db, { tenantId: 't1', from: 'فودافون كاش 1010', into: 'فودافون كاش 1010' }), { code: 'BOX_SAME' });
  await assert.rejects(boxes.mergeBoxes(db, { tenantId: 't1', from: '', into: 'فودافون كاش 1010' }), { code: 'BOX_REQUIRED' });
  await boxes.mergeBoxes(db, { tenantId: 't1', from: 'فودافون كاش 1079', into: 'فودافون كاش 1010' });
  await assert.rejects(boxes.mergeBoxes(db, { tenantId: 't1', from: 'فودافون كاش 1079', into: 'فودافون كاش 1010' }), { code: 'BOX_SAME' });
  await assert.rejects(boxes.mergeBoxes(db, { tenantId: 't1', from: 'فودافون كاش 1010', into: 'فودافون كاش 1079' }), { code: 'BOX_SAME' }, 'the other way round is the same box too');
  await boxes.mergeBoxes(db, { tenantId: 't1', from: 'فودافون كاش 1010', into: 'فودافون كاش 2222' });
  assert.deepEqual([...db.state.aliases].sort(), [['فودافون كاش 1010', 'فودافون كاش 2222'], ['فودافون كاش 1079', 'فودافون كاش 2222']], 'everything that pointed at 1010 points at 2222');
  assert.equal(await balance(db, 'فودافون كاش 2222'), 3);
});

test('the partners\' table: what each took, in total and from each box, voided ones left out, other withdrawals not in it', async () => {
  posted = [];
  const db = world({ payments: [pay('خزنة الدقي - كاش', 9000, 1), pay('فودافون كاش 1010', 9000, 1)], chart: [{ code: '5100', name: 'مصروفات', type: 'expense', is_active: 1 }] });
  await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 1000, kind: 'partner', partner: 'mohab' });
  await take(db, { method: 'فودافون كاش 1010', currency: 'EGP', amount: 500, kind: 'partner', partner: 'mohab' });
  await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 700, kind: 'partner', partner: 'walid' });
  const cancelled = await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 999, kind: 'partner', partner: 'walid' });
  await take(db, { method: 'خزنة الدقي - كاش', currency: 'EGP', amount: 50, kind: 'expense', accountCode: '5100' });
  await withdrawals.voidWithdrawal(db, { tenantId: 't1', id: cancelled.id, today: '2026-10-28' });
  const report = await withdrawals.listWithdrawals(db, { tenantId: 't1' });
  const mohab = report.partners.find(partner => partner.key === 'mohab');
  const walid = report.partners.find(partner => partner.key === 'walid');
  assert.deepEqual(mohab.totals, { EGP: 1500 });
  assert.deepEqual(mohab.boxes, [{ box: 'خزنة الدقي - كاش', currency: 'EGP', total: 1000 }, { box: 'فودافون كاش 1010', currency: 'EGP', total: 500 }]);
  assert.deepEqual(walid.totals, { EGP: 700 });
  assert.equal(walid.count, 1);
  assert.equal(report.rows.length, 5, 'every withdrawal is listed');
  assert.equal(report.rows.filter(row => row.voided).length, 1, 'and the cancelled one is marked');
  assert.deepEqual(report.partners.map(partner => partner.name), ['مهاب', 'وليد']);
});

test('the routes are the main books\' and the manage_financial permission\'s, the screen has the buttons and the partners\' table', () => {
  const route = read('api/routes/finance/budgets.js');
  assert.match(route, /router\.post\('\/api\/admin\/finance\/boxes\/withdraw', \.\.\.mainBooks, boxChange/);
  assert.match(route, /router\.post\('\/api\/admin\/finance\/boxes\/withdrawals\/void', \.\.\.mainBooks, boxChange/);
  assert.match(route, /router\.post\('\/api\/admin\/finance\/boxes\/merge', \.\.\.mainBooks, boxChange/);
  assert.match(route, /router\.get\('\/api\/admin\/finance\/boxes\/withdrawals', requireAuth, requireAdminOrStaff, requirePermission\('view_financial'\)/);
  assert.match(route, /const method = applyAlias\(canonicalChannel\(row\.method\), aliases\);/);
  assert.match(read('api/migrations/309_v26_box_withdrawals_and_merges.sql'), /CREATE TABLE IF NOT EXISTS box_withdrawals[\s\S]*CREATE TABLE IF NOT EXISTS box_aliases[\s\S]*'merge','void_withdrawal'/);
  assert.match(read('api/schema.sql'), /CREATE TABLE `box_withdrawals`[\s\S]*CREATE TABLE `box_aliases`/);
});
