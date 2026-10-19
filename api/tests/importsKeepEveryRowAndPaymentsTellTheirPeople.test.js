'use strict';

// «محتاجين نعدل الفرع» in the payment edit, «لما عميل بيتحط له دفعه وتترفض لازم يظهر علامه مميزه»,
// «لما عميل يتقبل او يترفض او حجز جديد … يروحله اشعار مهم», and «وقت استيراد داتا … لازم تقبل ترفع كل العملاء
// ماعدا المكرر ولو في غلط اكتب ان الرقم فيه غلط» (18 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanImportedPhone } = require('../lib/phoneNumber');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

// ── the payment edit: the branch ───────────────────────────────────────────────────────────────────

test('the payment edit can change the branch, and the books follow it', () => {
  const lib = read('api/lib/paymentCorrections.js');
  assert.match(lib, /if \(changes\.branch !== undefined\) \{/);
  assert.match(lib, /put\('branch', newBranch\.branch\);\s*put\('branch_id', newBranch\.branchId\);/);
  // The journal entry the payment posted moves with it: the branch P&L and the vault read that column.
  assert.match(lib, /UPDATE journal_entries SET branch=\?, branch_id=\? WHERE tenant_id=\? AND ref_type='payment' AND ref_id=\?/);
  // A numbered receipt belongs to its branch's sequence.
  assert.match(lib, /RECEIPT_BRANCH/);
  const route = read('api/routes/payment-corrections.js');
  assert.match(route, /transactionId: body\.transactionId, branch: body\.branch \}/);
  assert.match(route, /branch: body\.branch \? \(normalizeBranch\(body\.branch\) \|\| pay\.branch \|\| undefined\)/, 'a corrected payment keeps the new branch too');
  const modal = read('admin/components/PaymentCorrectionModal.tsx');
  assert.match(modal, /if \(branch && branch !== originalBranch\) body\.branch = branch;/);
  assert.match(modal, /الفرع اللي اتدفعت فيه/);
  assert.match(read('admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx'), /branch: correcting\.row\.branchId,/);
});

// ── a rejected payment shows on the client ────────────────────────────────────────────────────────

test('a client whose payment was rejected, and who paid nothing since, wears the mark', () => {
  const lib = bundle('admin/lib/rejectedPayment.ts');
  if (!lib) return;
  const { rejectedPaymentOf, rejectedPaymentTitle } = lib;
  const failed = { id: 'p1', amount: 800, currency: 'EGP', status: 'failed', at: '2026-10-10', note: 'x | Review: التحويل مش وصل' };
  const paid = day => ({ id: `paid-${day}`, amount: 800, currency: 'EGP', status: 'paid', at: day });
  const rejected = rejectedPaymentOf({ paymentHistory: [paid('2026-09-01'), failed] });
  assert.equal(rejected.payment.id, 'p1');
  assert.equal(rejected.reason, 'التحويل مش وصل');
  assert.match(rejectedPaymentTitle(rejected), /التحويل مش وصل/);
  assert.equal(rejectedPaymentOf({ paymentHistory: [failed, paid('2026-10-12')] }), null, 'paid again afterwards: resolved');
  assert.equal(rejectedPaymentOf({ paymentHistory: [failed, { ...paid('2026-10-11'), status: 'pending' }] }), null, 'tried again, waiting: not a rejected client');
  assert.equal(rejectedPaymentOf({ paymentHistory: [paid('2026-10-10')] }), null);
  assert.equal(rejectedPaymentOf({ paymentHistory: [] }), null);
  assert.equal(rejectedPaymentOf(null), null);
  // Where it is drawn: the client's name in the table, and the client page.
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/ClientNameCell.tsx'), /rejectedPaymentOf\(row\)/);
  assert.match(read('admin/pages/unified-client/UnifiedClientHeroHeader.tsx'), /rejectedPaymentOf\(subscriber\)/);
});

// ── the people behind a client are told ───────────────────────────────────────────────────────────

test('an accepted payment and a booking on a rep\'s client tell the rep and the collector, not the one who did it', async () => {
  const { notifyPaymentOutcome } = require('../lib/paymentNotices');
  const sent = [];
  const db = { query: async () => [[{ name: 'أحمد علي', client_code: 'C77', assigned_sales_id: 'rep1', assigned_cs_id: 'cs1' }]] };
  const notify = (...args) => { sent.push(args); return Promise.resolve(); };

  const told = await notifyPaymentOutcome({
    outcome: 'approved', tenantId: 't1', subscriberId: 's1', amount: 1500, currency: 'EGP', recordedBy: 'rep1', actorId: 'acc1', actorName: 'سارة',
  }, { db, notify });
  assert.equal(told, 2, 'the rep (who also recorded it) once, and the collector');
  assert.deepEqual(sent.map(args => args[5]).sort(), ['cs1', 'rep1']);
  const [type, title, message, data] = sent[0];
  assert.equal(type, 'payment');
  assert.match(title, /دفعة اتقبلت/);
  assert.match(message, /أحمد علي/);
  assert.match(message, /1,500 EGP/);
  assert.match(message, /بواسطة سارة/);
  assert.equal(data.importance, 'high');
  assert.equal(data.clientCode, 'C77');

  sent.length = 0;
  const booked = await notifyPaymentOutcome({
    outcome: 'booked', tenantId: 't1', subscriberId: 's1', amount: 900, currency: 'SAR', actorId: 'rep1', actorName: 'المندوب', pending: true,
  }, { db, notify });
  assert.equal(booked, 1, 'the rep who booked it is not told of their own booking');
  assert.equal(sent[0][5], 'cs1');
  assert.match(sent[0][1], /حجز جديد/);
  assert.match(sent[0][2], /مستني الاعتماد/);

  // Nobody to name, nobody told (the managers have their own line for a booking waiting).
  sent.length = 0;
  const none = await notifyPaymentOutcome({ outcome: 'booked', tenantId: 't1', subscriberId: 's1', actorId: 'rep1' }, {
    db: { query: async () => [[{ name: 'س', assigned_sales_id: 'rep1', assigned_cs_id: null }]] }, notify });
  assert.equal(none, 0);
  assert.equal(sent.length, 0);
  assert.equal(await notifyPaymentOutcome({ outcome: 'nonsense' }, { db, notify }), 0);
});

test('every road that accepts, rejects or books money tells the people behind the client', () => {
  assert.match(read('api/lib/paymentRejection.js'), /importance: 'critical'/, 'a rejection is the loudest');
  for (const [rel, expect] of [
    ['api/routes/core/financepay.js', /outcome: 'approved', tenantId, subscriberId: payment\.subscriber_id/],
    ['api/routes/orders.js', /outcome: 'approved', tenantId: req\.tenantId, subscriberId: order\.subscriber_id/],
    ['api/routes/payment-proofs.js', /outcome: 'approved', tenantId, subscriberId: proof\.subscriber_id/],
    ['api/routes/subscriber-payments.js', /outcome: 'booked', tenantId: paymentTenantId/],
  ]) assert.match(read(rel), expect, rel);
  const bookings = read('api/routes/subscriber-payments.js');
  assert.match(bookings, /if \(!approvingRequest && !req\.isPaymentCorrection\) \{/, 'a correction and an approved request are not a new booking');
  assert.match(bookings, /importance: 'high', tab: 'online_clients' \}, req\.tenantId, approvingRequest\.requested_by/);
  // A refusal is a message to the officer, with the reason (19 Oct 2026), not a bell notification.
  assert.match(bookings, /staffId: request\.requested_by, authorId: req\.staffRecord\?\.id \|\| null/);
  assert.match(read('api/routes/payment-corrections.js'), /asRecording\.isPaymentCorrection = true;/);
  const bell = read('admin/pages/dashboard/NotificationsBell.tsx');
  assert.match(bell, /if \(set === 'critical'\) return 'critical';\s*if \(set === 'high'\) return 'important';/);
  assert.match(bell, /\['critical', 'repeated', 'important'\]\.includes\(severityOf\(row\)/, 'they sit under «مهم»');
  assert.match(bell, /label: 'افتح العميل'/);
});

// ── imports keep every row ────────────────────────────────────────────────────────────────────────

test('an imported number: 966 in front of a Saudi mobile, a wrong one kept and named, none said', () => {
  assert.deepEqual(cleanImportedPhone('501234567'), { phone: '966501234567', problem: '', saudi: true });
  assert.deepEqual(cleanImportedPhone('0501234567'), { phone: '966501234567', problem: '', saudi: true });
  assert.deepEqual(cleanImportedPhone('٠٥٠١٢٣٤٥٦٧'), { phone: '966501234567', problem: '', saudi: true }, 'Arabic digits');
  assert.equal(cleanImportedPhone('+966 50 123 4567').phone, '966501234567');
  assert.equal(cleanImportedPhone('01012345678').problem, '');
  assert.equal(cleanImportedPhone('1012345678').problem, '', 'Excel dropped the zero');
  const short = cleanImportedPhone('0101234567');
  assert.equal(short.phone, '0101234567', 'kept as typed');
  assert.match(short.problem, /الرقم فيه غلط أو ناقص: 0101234567/);
  assert.match(cleanImportedPhone('01000000000').problem, /غلط/, 'a filler');
  assert.match(cleanImportedPhone('abc').problem, /غلط/);
  assert.deepEqual(cleanImportedPhone('  '), { phone: '', problem: 'مفيش رقم تليفون', saudi: false });
  assert.deepEqual(cleanImportedPhone(null), { phone: '', problem: 'مفيش رقم تليفون', saudi: false });
});

test('the lead file, the sheet and the Dokki file keep every row that has anything in it', () => {
  const leads = read('api/routes/communication-admin.js');
  assert.match(leads, /if \(!name && !String\(l\.phone \|\| ''\)\.trim\(\) && !email\) \{ errors\.push\(`سطر فاضي/, 'only an empty row is left out');
  assert.doesNotMatch(leads, /سطر مفقود الاسم أو الهاتف/);
  assert.match(leads, /l\.saudi \? 'ONLINE_SAUDI'/, 'a Saudi number lands in the Saudi branch');
  assert.match(leads, /⚠ مشاكل في الاستيراد/);
  assert.match(leads, /res\.json\(\{ ok: true, imported, skipped, flagged,/);
  assert.match(read('admin/pages/dashboard/tabs/leads/CsvImportButton.tsx'), /\.filter\(lead => lead\.name \|\| lead\.phone \|\| lead\.email\)/);
  assert.match(read('api/routes/gsheets.js'), /const cleaned = cleanImportedPhone\(phone\);/);
  const dokki = read('api/routes/admin/leads/importDaqqi.js');
  assert.doesNotMatch(dokki, /بيانات ناقصة أو غير صحيحة/, 'a row with no email or a short number is no longer an error');
  assert.match(dokki, /⚠ مشاكل في الاستيراد/);
  // The screens let a row without a usable number through, and say what is missing.
  const panel = read('admin/pages/dashboard/tabs/online/OldDataImportPanel.tsx');
  assert.match(panel, /const usable = \(row: SheetClientRow\) => Boolean\(row\._name \|\| row\._phone \|\| row\._email\);/);
  assert.match(panel, /مفيش رقم صالح — العميل هيتعمل والمشكلة هتتكتب في ملاحظاته/);
});

test('a sheet row with no number and no email is a client, once', async () => {
  const stubs = {
    '../lib/entitlements': { grantCourseSelections: async () => ({ granted: 1 }) },
    '../lib/leadMatching': { findLeadByContact: async () => null },
    '../lib/leadState': { transitionLead: async () => {} },
  };
  const previous = {};
  for (const [rel, exports] of Object.entries(stubs)) {
    const file = require.resolve(rel);
    previous[file] = require.cache[file];
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  }
  const libPath = require.resolve('../lib/collectionSheets');
  delete require.cache[libPath];
  const lib = require('../lib/collectionSheets');
  try {
    const inserted = [];
    let code = 100;
    const existing = [{ id: 's-kept', name: 'مها من الشيت', phone: null, email: null, assigned_cs_id: null }];
    const conn = {
      async query(sql, params) {
        if (/FROM subscribers WHERE tenant_id=\? AND deleted_at IS NULL/.test(sql)) return [existing];
        if (/FROM courses/.test(sql)) return [[]];
        if (/FROM bundles/.test(sql)) return [[]];
        if (/UPDATE client_code_counter/.test(sql)) { code += 1; return [{}]; }
        if (/SELECT next_value FROM client_code_counter/.test(sql)) return [[{ next_value: code }]];
        if (/INSERT INTO subscribers/.test(sql)) { inserted.push(params); return [{}]; }
        if (/UPDATE subscribers SET assigned_cs_id/.test(sql)) return [{}];
        throw new Error(`unexpected query: ${sql}`);
      },
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    };
    const db = { getConnection: async () => conn };
    const result = await lib.importCollectionRows({
      tenantId: 't1', staff: { id: 'cs-1', name: 'منة' }, source: 'شيت',
      rows: [
        { _name: 'مها من الشيت', _phone: '' },                       // kept by an earlier run: the same one
        { _name: 'نور', _phone: '', _issues: ['رقم مش سليم: 1234 (ناقص أو زيادة أرقام)'], _course: 'كورس مش معروف' },
        { _name: 'نور', _phone: '' },                                // repeated in the file
        { _name: '', _phone: '501234567' },                          // a Saudi mobile with no name
      ],
    }, db);
    assert.equal(result.created, 2);
    assert.equal(result.assigned, 1, 'the one kept by an earlier run is that client, handed to the officer — not created again');
    assert.equal(result.skipped, 1, 'the repeat in the file');
    assert.equal(result.flagged, 2);
    const [nour, nameless] = inserted;
    assert.equal(nour[3], 'نور');
    assert.equal(nour[5], null, 'no number to store');
    assert.match(nour[8], /^⚠ مشاكل في الاستيراد: رقم مش سليم: 1234/);
    assert.match(nour[8], /الكورس «كورس مش معروف» مش موجود في السيستم/);
    assert.equal(nameless[3], '+966501234567', 'a client with no name is called by their number');
    assert.equal(nameless[5], '966501234567', 'stored as the identity, with the Saudi code in front');
    assert.match(nameless[8], /الاسم ناقص/);
  } finally {
    for (const [file, entry] of Object.entries(previous)) { if (entry) require.cache[file] = entry; else delete require.cache[file]; }
    delete require.cache[libPath];
  }
});
