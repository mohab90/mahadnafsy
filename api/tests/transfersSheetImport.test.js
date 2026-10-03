'use strict';

// «ملف التحويلات»: the accounts team's workbook, a tab per account the money
// arrived on, uploaded onto the transfers ledger. The cells here are the shapes
// the September–October 2026 workbook holds: a heading that is the account
// number, a tab without a date heading, typed dates «2/9/0206» and serial 2029,
// wallets with the zero dropped, InstaPay names, a Saudi tab with no operation
// number, one operation number typed twice.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { importTransfers } = require('../lib/incomingTransfers');

let sheet = null;
try {
  const esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'shared/transferSheet.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', absWorkingDir: ROOT,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  sheet = module.exports;
} catch { sheet = null; }
const skip = !sheet && 'esbuild is not installed';

// Excel's serial for a day.
const serial = iso => Date.parse(`${iso}T00:00:00Z`) / 86400000 + 25569;
const TODAY = '2026-10-03';

test('a wallet tab: the amount under the account number, the zero put back', { skip }, () => {
  const tab = { name: '1020107711', rows: [
    ['التاريخ', 'اسم العميل\n(بيان العملية)', 'اسم السيلز', 'الكورس', 'قسط / جديد', 'مكان الحضور', 'رقم العملية', 'الرقم المحول منه', '1020107711\nحسابات'],
    [serial('2026-09-01'), 'نهي صادق', 'دندن', 'تخاطب وتربيه خاصه', 'حجز', 'online', 23253587161, 1080676388, 900],
    [serial('2026-10-02'), null, null, null, null, null, 24282618518, 1067230770, 800],
    [serial('2027-09-25'), 'سارة', 'رودي', 'صحه', 'قسط', 'online', 24051883528, 1012345678, 500],
  ] };
  const { transfers, skipped } = sheet.readTransferTab(tab, TODAY);
  assert.deepStrictEqual(skipped, []);
  assert.strictEqual(transfers.length, 3);
  assert.deepStrictEqual(
    { ...transfers[0], note: undefined },
    { row: 2, receivedOn: '2026-09-01', amount: 900, reference: '23253587161', builtReference: false, senderName: null,
      senderPhone: '01080676388', customerName: 'نهي صادق', note: undefined, warnings: [] });
  assert.match(transfers[0].note, /العميل: نهي صادق · السيلز: دندن · الكورس: تخاطب وتربيه خاصه · النوع: حجز · الحضور: online/);
  assert.strictEqual(transfers[1].customerName, null, 'a transfer nobody has claimed yet is still a transfer');
  // A year typed wrong takes the row above's day, and says so.
  assert.strictEqual(transfers[2].receivedOn, '2026-10-02');
  assert.match(transfers[2].warnings[0], /مش مقروء/);
});

test('no date heading, a typed «2/9/0206», a withdrawal column', { skip }, () => {
  const tab = { name: '1020107722', rows: [
    [null, 'اسم العميل', 'اسم السيلز', 'الكورس', 'قسط / جديد', 'مكان الحضور', 'رقم العملية', 'الرقم المحول منه', 'ايداع', 'السحب'],
    [serial('2026-09-01'), 'حمدي سلطان', 'هنونه', 'متكامل', 'قسط', 'اونلاين', 23250495026, 1021125513, 2000, null],
    ['2/9/0206', 'منى', 'هنونه', 'متكامل', 'قسط', 'اونلاين', 23293295028, 1021125514, 1000, null],
    [serial('2026-09-03'), null, null, null, null, null, 23293295099, 1021125515, 1500, null],
    [serial('2026-09-04'), null, null, null, null, null, null, null, null, 3000],
    [serial('2026-09-05'), null, null, null, null, null, null, null, null, null],
  ] };
  const { transfers, skipped, layout } = sheet.readTransferTab(tab, TODAY);
  assert.strictEqual(layout.columns.date, 0);
  assert.strictEqual(layout.columns.amount, 8);
  assert.deepStrictEqual(transfers.map(t => [t.receivedOn, t.amount]), [['2026-09-01', 2000], ['2026-09-01', 1000], ['2026-09-03', 1500]]);
  assert.deepStrictEqual(skipped, [{ row: 5, reason: 'سحب — مش تحويل وارد' }], 'a line with only its date is not reported');
});

test('InstaPay: the sender is a name; one operation number typed twice', { skip }, () => {
  const tab = { name: 'انستا باى 01505887720', rows: [
    ['التاريخ', 'اسم العميل\n(بيان العملية)', 'اسم السيلز', 'الكورس', 'قسط / جديد', 'مكان الحضور', 'رقم العملية', 'الرقم المحول منه', 'ايداع'],
    [serial('2026-09-21'), null, null, null, null, null, 996769930516, 'MOHAMED ZAKARYA ELATIMA', 700],
    [serial('2026-09-21'), 'عمر محمد زكريا', 'دندن', 'صحة', 'حجز', 'اونلاين', 996769930516, 'OMAR MOHAMED ZAKARYA', 700],
    [serial('2026-09-23'), 'ساره اكرامي', 'ياسمين فريد', 'مظلم', 'شهادات و قسط', 'اونلاين', 414851062036, 'SARA EKRAMY', 7500],
    [serial('2026-09-22'), 'مروة منير', 'السمسوم', 'ايجابي', 'حجز', 'اونلاين', 414851062036, 'مروة منير', 800],
  ] };
  const { transfers, skipped } = sheet.readTransferTab(tab, TODAY);
  // Same amount: the same transfer, kept once — the row that names the customer.
  assert.deepStrictEqual(transfers.map(t => [t.row, t.reference, t.senderName]),
    [[3, '996769930516', 'OMAR MOHAMED ZAKARYA'], [4, '414851062036', 'SARA EKRAMY']]);
  assert.strictEqual(skipped.length, 2);
  assert.match(skipped[0].reason, /نفس التحويل متكرر/);
  assert.strictEqual(skipped[0].row, 2);
  // Another amount: a typo, left for the sheet to be corrected.
  assert.match(skipped[1].reason, /متكرر \(صف 4\) بمبلغ تاني/);
});

test('the Saudi tab: no operation number, a reference built the same on every upload', { skip }, () => {
  const tab = { name: 'البنك السعودى', rows: [
    ['التاريخ', 'اسم العميل\n(بيان العملية)', 'اسم السيلز', 'الكورس', 'قسط / جديد', 'اسم الشخص الى حول الفلوس الى حساب البنك', 'الايداع'],
    [serial('2029-09-01'), 'شال مني', 'ياسمين فريد', 'تربيه خاصة وتخاطب', 'قسط', 'يوسف بابكر', 510],
    [serial('2026-09-02'), 'زينب حمزه', 'دعاء', 'سكيما 1 و 2', 'حجز', 'ZIENAB HAMZA ABD ALLA', 1000],
    [serial('2026-09-02'), 'زينب حمزه', 'دعاء', 'سكيما 1 و 2', 'حجز', 'ZIENAB HAMZA ABD ALLA', 1000],
  ] };
  const first = sheet.readTransferTab(tab, TODAY);
  const again = sheet.readTransferTab(tab, TODAY);
  assert.deepStrictEqual(first.skipped, []);
  // The first row's 2029 has no row above: it takes the row below's day.
  assert.strictEqual(first.transfers[0].receivedOn, '2026-09-02');
  assert.match(first.transfers[0].warnings[0], /تحته/);
  assert.ok(first.transfers.every(t => t.builtReference));
  assert.strictEqual(new Set(first.transfers.map(t => t.reference)).size, 3, 'two identical rows are two transfers');
  assert.deepStrictEqual(first.transfers.map(t => t.reference), again.transfers.map(t => t.reference));
  assert.strictEqual(sheet.guessCurrency(tab.name, null), 'SAR');
});

test('the box a tab is: its number, and not a box on another rail', { skip }, () => {
  const boxes = ['خزنة الدقي', 'فودافون كاش 2020', 'اورانج كاش 7720', 'انستا باي', 'احمد السعودية', 'وي باي 7720'];
  assert.strictEqual(sheet.guessBox('1020202954', boxes), 'فودافون كاش 2020');
  assert.strictEqual(sheet.guessBox('انستا باى 01505887720', boxes), 'انستا باي');
  assert.strictEqual(sheet.guessBox('البنك السعودى', boxes), 'احمد السعودية');
  assert.strictEqual(sheet.guessBox('1094124645', boxes), null, 'nothing fits: the person picks');
});

test('the «ربط» lists put the likeliest transfer first', { skip }, () => {
  const payment = { amount: 900, currency: 'EGP', method: 'فودافون كاش 7711', reference: null, customerName: 'نهي صادق محمد', date: '2026-09-01T10:00:00Z' };
  const ledger = [
    { amount: 900, currency: 'EGP', method: 'انستا باي', reference: '1', senderName: 'X', note: null, receivedOn: '2026-08-01' },
    { amount: 900, currency: 'EGP', method: 'فودافون كاش 7711', reference: '2', senderName: null, note: 'العميل: نهي صادق · السيلز: دندن', receivedOn: '2026-09-01' },
    { amount: 500, currency: 'EGP', method: 'فودافون كاش 7711', reference: '3', senderName: null, note: null, receivedOn: '2026-09-01' },
  ];
  const ranked = ledger.map(t => ({ t, ...sheet.transferMatch(payment, t) })).sort((a, b) => b.score - a.score);
  assert.strictEqual(ranked[0].t.reference, '2');
  assert.deepStrictEqual(ranked[0].reasons, ['نفس المبلغ', 'نفس الاسم', 'نفس الحساب']);
  assert.deepStrictEqual(sheet.transferMatch({ ...payment, reference: '3' }, ledger[2]).reasons[0], 'نفس رقم العملية');
});

test('importing: each row alone, an operation number already on the box counted, not refused', async () => {
  const seen = new Set();
  const db = {
    async query(sql, params) {
      assert.match(sql, /INSERT INTO incoming_transfers/);
      const key = `${params[4]}|${params[5]}`;
      if (seen.has(key)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      seen.add(key);
      return [{ affectedRows: 1 }];
    },
  };
  const row = (reference, amount = 900) => ({ amount, currency: 'EGP', method: 'فودافون كاش 7711', reference, receivedOn: '2026-09-01' });
  const first = await importTransfers(db, { tenantId: 't', transfers: [row('1'), row('2'), row('3', 0)] });
  assert.deepStrictEqual(first, { created: 2, existing: 0, failed: [{ index: 2, error: 'مبلغ التحويل غير صحيح' }] });
  const again = await importTransfers(db, { tenantId: 't', transfers: [row('1'), row('2'), row('4')] });
  assert.deepStrictEqual(again, { created: 1, existing: 2, failed: [] });
  await assert.rejects(importTransfers(db, { tenantId: 't', transfers: [] }), /مافيهوش تحويلات/);
  // A database failure is not a row's fault: it stops the upload.
  const broken = { async query() { throw new Error('connection lost'); } };
  await assert.rejects(importTransfers(broken, { tenantId: 't', transfers: [row('9')] }), /connection lost/);
});

test('the route and the screen', () => {
  const route = read('api/routes/core/financepay.js');
  const handler = route.slice(route.indexOf("router.post('/api/admin/incoming-transfers/import'"));
  assert.match(handler, /requirePermission\('manage_financial'\)/);
  assert.match(handler, /=== 'collection'\) \{\s+return res\.status\(403\)/, 'recording what arrived is the manager\'s, as for one transfer');
  assert.match(route, /ORDER BY t\.received_on DESC, t\.created_at DESC LIMIT 3000/, 'every free transfer reaches the «ربط» lists');
  const tab = read('admin/pages/dashboard/tabs/OrdersTab.tsx');
  assert.match(tab, /<ImportTransfersModal boxes=\{paymentBoxes\}/);
  assert.match(tab, /rankedTransfers = availableTransfers/);
  const modal = read('admin/pages/dashboard/tabs/orders/ImportTransfersModal.tsx');
  assert.match(modal, /adminPost<ImportResult>\('\/admin\/incoming-transfers\/import', \{ transfers: rows \}\)/);
  assert.match(modal, /disabled=\{!total \|\| missingBox\.length > 0/, 'a tab is not uploaded before its box is chosen');
});
