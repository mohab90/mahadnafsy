'use strict';

// «محتاجين نعمل تعديل في زر صلاحيات الكورسات ان يبقي في زي تغير العمله واقدر اغير العمله بتاعت العميل مع تغيير
// الارقام لسعر الكورس او المدفوع او المتبقي».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { changeClientCurrency, convertAmount } = require('../lib/clientCurrency');

const RATES = { EGP: 1, SAR: 14.5, USD: 48 };

function fakeDb(answers) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      for (const [pattern, answer] of answers) {
        if (pattern.test(flat)) return typeof answer === 'function' ? answer(params) : answer;
      }
      return [{ affectedRows: 0 }];
    },
  };
}
const find = (db, pattern) => db.calls.find(call => pattern.test(call.sql));
const writes = db => db.calls.filter(call => /^(UPDATE|INSERT)/.test(call.sql));

const client = (overrides = {}, crm = {}) => [
  [/FROM subscribers WHERE id=\?/, [[{ id: 's1', name: 'عميل', branch: 'ONLINE_SAUDI', crm_json: JSON.stringify({
    clientStatus: 'old_intl', market: 'saudi', customPrices: { c1: 790, 'bundle:b1': 1599 }, priorPaid: { c1: 400 }, ...crm,
  }), ...overrides }]]],
  [/SELECT currency FROM payments/, [[]]],
  [/SELECT currency, COUNT/, [[]]],
  [/FROM courses/, [[{ id: 'c1', title: 'الصحة النفسية', title_ar: null }]]],
  [/FROM bundles/, [[{ id: 'b1', title: 'دبلومة علم النفس المتكامل' }]]],
];
const args = extra => ({ tenantId: 't', subscriberId: 's1', rates: RATES, actor: 'محاسب', ...extra });

test('a riyal client moved to pounds: market, branch, status and every figure follow', async () => {
  const db = fakeDb(client());
  const result = await changeClientCurrency(db, args({ currency: 'EGP' }));
  assert.equal(result.from, 'SAR');
  assert.equal(result.branch, 'ONLINE_EGYPT');
  const update = find(db, /^UPDATE subscribers SET branch=/);
  assert.equal(update.params[0], 'ONLINE_EGYPT');
  const crm = JSON.parse(update.params[2]);
  assert.equal(crm.market, 'local');
  assert.equal(crm.clientStatus, 'old_local', 'the old-data tabs tell local from foreign by the status');
  assert.deepEqual(crm.customPrices, { c1: 11455, 'bundle:b1': 23186 });
  assert.deepEqual(crm.priorPaid, { c1: 5800 });
  assert.ok(find(db, /^UPDATE enrollments SET branch_id=/), 'their courses follow the branch');
  assert.match(find(db, /^INSERT INTO activity_logs/).params[5], /من ريال إلى جنيه/);
});

test('without «convert» the market moves and the figures stay as they are', async () => {
  const db = fakeDb(client());
  const result = await changeClientCurrency(db, args({ currency: 'EGP', convert: false }));
  assert.equal(result.converted, false);
  const crm = JSON.parse(find(db, /^UPDATE subscribers SET branch=/).params[2]);
  assert.deepEqual(crm.customPrices, { c1: 790, 'bundle:b1': 1599 });
  assert.deepEqual(crm.priorPaid, { c1: 400 });
  assert.match(find(db, /^INSERT INTO activity_logs/).params[5], /من غير تحويل/);
});

test('a dry run says what would change and writes nothing', async () => {
  const db = fakeDb(client());
  const result = await changeClientCurrency(db, args({ currency: 'USD', dryRun: true }));
  assert.equal(writes(db).length, 0);
  assert.equal(result.to, 'USD');
  const first = result.changes.find(change => change.item === 'c1');
  assert.equal(first.title, 'الصحة النفسية');
  assert.deepEqual(first.price, { was: 790, now: 239 });
  assert.deepEqual(first.priorPaid, { was: 400, now: 121 });
});

test('a client with course payments in another currency is refused, not shown with two currencies in one balance', async () => {
  const db = fakeDb([[/SELECT currency, COUNT/, [[{ currency: 'SAR', n: 2 }]]], ...client()]);
  await assert.rejects(changeClientCurrency(db, args({ currency: 'EGP' })), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'PAYMENTS_IN_OTHER_CURRENCY');
    return true;
  });
  assert.equal(writes(db).length, 0);
});

test('a branch client, the same currency, and a currency nobody has are refused', async () => {
  await assert.rejects(changeClientCurrency(fakeDb(client({ branch: 'DAQQI' })), args({ currency: 'SAR' })), { code: 'BRANCH_CLIENT' });
  await assert.rejects(changeClientCurrency(fakeDb(client()), args({ currency: 'SAR' })), { code: 'SAME_CURRENCY' });
  await assert.rejects(changeClientCurrency(fakeDb(client()), args({ currency: 'GBP' })), { statusCode: 400 });
});

test('an old local client moved abroad becomes an old foreign one', async () => {
  const db = fakeDb(client({ branch: 'ONLINE_EGYPT' }, { clientStatus: 'old_local', market: 'local' }));
  await changeClientCurrency(db, args({ currency: 'SAR' }));
  const crm = JSON.parse(find(db, /^UPDATE subscribers SET branch=/).params[2]);
  assert.equal(crm.clientStatus, 'old_intl');
  assert.equal(crm.market, 'saudi');
});

test('converting needs a rate: no rate, no guess', async () => {
  await assert.rejects(changeClientCurrency(fakeDb(client()), args({ currency: 'EGP', rates: null })), { code: 'NO_RATE' });
});

test('a figure that was something never rounds down to nothing', () => {
  assert.equal(convertAmount(3, 'EGP', 'USD', RATES), 1);
  assert.equal(convertAmount(0, 'EGP', 'USD', RATES), 0);
  assert.equal(convertAmount(480, 'EGP', 'EGP', RATES), 480);
});

test('the route is the money desk\'s: item-money\'s permission, and never collection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'core', 'content.js'), 'utf8');
  const route = source.slice(source.indexOf("router.post('/api/admin/subscribers/:id/currency'"));
  assert.match(route.slice(0, 400), /requirePermission\('manage_financial'\)/);
  assert.match(route.slice(0, 600), /refuseCollection\(req, res,/);
  assert.match(route.slice(0, 1800), /static-fallback/, 'a rate nobody configured is not used to convert a client\'s money');
});

test('the panel offers it only to online clients, and asks before it writes', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'online-clients-sections', 'ClientCourseAccessPanel.tsx'), 'utf8');
  assert.match(panel, /!inBranch && role !== 'collection' \?/);
  assert.ok(panel.indexOf('dryRun: true') < panel.indexOf("await api(`${base}/currency`, 'POST', body)"), 'the preview comes first');
});
