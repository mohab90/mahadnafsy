'use strict';

// «اقدر اضيف لينك الشيت وتنزل الداتا باسمه ولازم تمنع ان يكون في مكرر واي
// عميل بيترفع لازم يسجل باسم مسئول التحصيل» — and «لازم تحدد اقصي عدد في مدة
// اد ايه يوميا ولا اسبوعيا ولا 15 يوم ولا في الشهر».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// The import with its collaborators replaced: the enrolment and lead steps are
// recorded rather than run, so the test is about what lands where.
function loadImport(extra = {}) {
  const granted = [];
  const stubs = {
    '../lib/entitlements': { grantCourseSelections: async args => { granted.push(args); return { granted: 1 }; } },
    '../lib/leadMatching': { findLeadByContact: async () => null },
    '../lib/leadState': { transitionLead: async () => {} },
    ...extra,
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
  const restore = () => {
    for (const [file, entry] of Object.entries(previous)) {
      if (entry) require.cache[file] = entry; else delete require.cache[file];
    }
    delete require.cache[libPath];
  };
  return { lib, granted, restore };
}

function fakeDb(existing) {
  const inserted = [];
  const assigned = [];
  let code = 100;
  const conn = {
    async query(sql, params) {
      if (/SELECT id, phone, email, assigned_cs_id FROM subscribers/.test(sql)) return [existing];
      if (/FROM courses/.test(sql)) return [[{ id: 'c-life', title: 'دبلومة اللايف كوتش' }]];
      if (/FROM bundles/.test(sql)) return [[]];
      if (/UPDATE client_code_counter/.test(sql)) { code += 1; return [{}]; }
      if (/SELECT next_value FROM client_code_counter/.test(sql)) return [[{ next_value: code }]];
      if (/INSERT INTO subscribers/.test(sql)) { inserted.push(params); return [{}]; }
      if (/UPDATE subscribers SET assigned_cs_id/.test(sql)) { assigned.push(params); return [{}]; }
      throw new Error(`unexpected query: ${sql}`);
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  return { db: { getConnection: async () => conn }, inserted, assigned };
}

const officer = { id: 'cs-1', name: 'منة' };

test('a sheet reads the way the old-data screen reads a file', () => {
  const { lib, restore } = loadImport();
  try {
    const csv = '\uFEFFالاسم,الهاتف,الكورس,المحصل,قيمة الكورس\n"Ali, M",01012345678,دبلومة اللايف كوتش,"1,500",3000\n,,,,\n';
    const [row, ...rest] = lib.sheetRows(csv);
    assert.equal(rest.length, 0, 'an empty row is not a client');
    assert.equal(row._name, 'Ali, M');
    assert.equal(row._phone, '01012345678');
    assert.equal(row._course, 'دبلومة اللايف كوتش');
    assert.equal(row._paid, '1500', 'the amount as a number, the thousands comma gone');
    assert.equal(row._expected, '3000');
    assert.deepEqual(lib.parseCsv('a;b\n"x;y";2'), [['a', 'b'], ['x;y', '2']], 'the separator is detected');
  } finally { restore(); }
});

test('every row lands under the officer, once, and nobody else\'s client moves', async () => {
  const { lib, granted, restore } = loadImport();
  try {
    const { db, inserted, assigned } = fakeDb([
      { id: 's-free', phone: '+201011111111', email: null, assigned_cs_id: null },
      { id: 's-mine', phone: '01022222222', email: null, assigned_cs_id: 'cs-1' },
      { id: 's-other', phone: null, email: 'held@x.com', assigned_cs_id: 'cs-2' },
    ]);
    const result = await lib.importCollectionRows({
      tenantId: 't1', staff: officer, kind: 'old_intl', source: 'شيت منة',
      rows: [
        { _name: 'جديد', _phone: '01033333333', _course: 'دبلومة اللايف كوتش', _paid: '1,500', _expected: '3000' },
        { _name: 'نفس الجديد برقم دولي', _phone: '+20 103 333 3333' },   // the same person again
        { _name: 'موجود من غير مسئول', _phone: '01011111111' },
        { _name: 'موجود معاها', _phone: '+201022222222' },
        { _name: 'مع مسئول تاني', _phone: '', _email: 'HELD@x.com' },
        { _name: 'من غير رقم ولا إيميل', _phone: '' },
      ],
    }, db);
    assert.deepEqual(result, { created: 1, assigned: 1, skipped: 3, others: 1, failed: 0 });

    const [row] = inserted;
    const columns = ['id', 'tenant_id', 'client_code', 'name', 'email', 'phone', 'branch', 'branch_id', 'notes',
      'assigned_cs_id', 'assigned_cs_name', 'crm_json', 'source'];
    const created = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    assert.equal(created.assigned_cs_id, 'cs-1');
    assert.equal(created.assigned_cs_name, 'منة');
    assert.equal(created.branch, 'ONLINE_ABROAD');
    assert.equal(created.client_code, 'C100');
    const crm = JSON.parse(created.crm_json);
    assert.equal(crm.clientStatus, 'old_intl');
    // The sheet's price and what it collected: the client's price and
    // «مدفوع قبل السيستم», never a payment.
    assert.deepEqual(crm.customPrices, { 'c-life': 3000 });
    assert.deepEqual(crm.priorPaid, { 'c-life': 1500 });
    assert.deepEqual(granted.map(grant => grant.selections), [[{ courseId: 'c-life' }]]);

    assert.deepEqual(assigned, [['cs-1', 'منة', 's-free', 't1']], 'only the unheld client is handed over');
  } finally { restore(); }
});

test('a course the sheet names that is not in the catalogue stays readable', async () => {
  const { lib, granted, restore } = loadImport();
  try {
    const { db, inserted } = fakeDb([]);
    await lib.importCollectionRows({
      tenantId: 't1', staff: officer, rows: [{ _name: 'س', _phone: '01044444444', _course: 'كورس قديم', _paid: '500', _expected: '900', _refund: '100' }],
    }, db);
    const notes = inserted[0][8];
    assert.match(notes, /الكورس: كورس قديم/);
    assert.match(notes, /المحصل: 500/);
    assert.match(notes, /قيمة الكورس: 900/);
    assert.match(notes, /استرداد سابق: 100/);
    assert.equal(granted.length, 0, 'nothing to enrol in');
    assert.equal(inserted[0][6], 'ONLINE_EGYPT', 'محلي قديم by default');
  } finally { restore(); }
});

test('linked sheets sync on demand and every half hour; an upload goes through the same import', () => {
  const routes = read('api/routes/collection-distribution.js');
  assert.match(routes, /router\.post\('\/api\/admin\/collection-sheets\/:id\/sync', \.\.\.guard,/);
  assert.match(routes, /router\.post\('\/api\/admin\/collection-sheets\/import', \.\.\.guard,/);
  const scheduler = read('api/lib/backgroundScheduler.js');
  assert.match(scheduler, /require\('\.\/collectionSheets'\)\.syncAllCollectionSheets\(\)/);
  const modal = read('admin/pages/dashboard/tabs/online-clients-sections/CollectionSettingsModal.tsx');
  assert.match(modal, /\/admin\/collection-sheets\/\$\{encodeURIComponent\(id\)\}\/sync/);
  assert.doesNotMatch(modal, /saveSubscriber/, 'no row-by-row save that cannot see duplicates');
  // The old-data screens go through the same import, prices and all.
  const oldImport = read('admin/pages/dashboard/tabs/online-clients-sections/OldDataImportSection.tsx');
  assert.match(oldImport, /'\/admin\/old-data\/import'/);
  assert.doesNotMatch(oldImport, /saveSubscriber|paymentHistory/);
});

test('a row lands with the sheet\'s remaining, its date, its numbers cleaned, and an officer by the rules', async () => {
  const picked = [];
  const { lib, granted, restore } = loadImport({
    '../lib/collectionDistribution': {
      loadCollectionConfig: async () => ({ sheets: [] }),
      pickCollectionOfficer: async (conn, tenantId, options) => { picked.push(options); return { id: 'cs-9', name: 'دعاء' }; },
      subscriberMarket: ({ branch }) => (branch === 'ONLINE_ABROAD' ? 'intl' : 'local'),
    },
  });
  try {
    const { db, inserted } = fakeDb([{ id: 's-old', phone: '1050954780', email: null, assigned_cs_id: null }]);
    const result = await lib.importCollectionRows({
      tenantId: 't1', staff: null, autoAssign: true, kind: 'active', branch: 'DAQQI', source: 'داتا قديمة دقي',
      rows: [
        // Price 4600, 1000 collected, 2900 still owed: 1700 was paid before the system.
        { _name: 'جديدة', _phone: '1009441632', _date: '2026-01-08', _course: 'دبلومة اللايف كوتش',
          _expected: '4600', _paid: '1000', _remaining: '2900', _otherPhones: '+249999147035', _issues: ['رقم مش سليم: 114785023 (ناقص أو زيادة أرقام)'] },
        // Glued to a number already on the system: that client, not a new one.
        { _name: 'موجودة', _phone: '01558282609-01050954780' },
        { _name: 'بكرة', _phone: '01011119999', _date: '2999-01-01' },
      ],
    }, db);
    assert.deepEqual(result, { created: 2, assigned: 0, skipped: 1, others: 0, failed: 0 });
    const columns = ['id', 'tenant_id', 'client_code', 'name', 'email', 'phone', 'branch', 'branch_id', 'notes',
      'assigned_cs_id', 'assigned_cs_name', 'crm_json', 'source', 'created_at'];
    const [first, second] = inserted.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
    assert.equal(first.phone, '01009441632', 'the zero Excel dropped is back');
    assert.equal(first.branch, 'DAQQI');
    assert.equal(first.created_at, '2026-01-08 12:00:00');
    assert.equal(second.created_at, null, 'a date ahead of today is not a date');
    assert.equal(first.assigned_cs_id, 'cs-9');
    assert.deepEqual(picked, [{ market: 'local' }, { market: 'local' }]);
    const crm = JSON.parse(first.crm_json);
    assert.deepEqual(crm.customPrices, { 'c-life': 4600 });
    assert.deepEqual(crm.priorPaid, { 'c-life': 1700 });
    assert.match(first.notes, /أرقام تانية: \+249999147035/);
    assert.match(first.notes, /رقم مش سليم: 114785023/);
    assert.match(first.notes, /المحصل في الملف 1000 والمتبقي 2900/);
    assert.deepEqual(granted.map(grant => grant.selections), [[{ courseId: 'c-life' }]]);
  } finally { restore(); }
});

test('an officer\'s cap counts from when each client reached them', () => {
  const migration = read('api/migrations/220_v26_subscribers_assigned_cs_at.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS assigned_cs_at DATETIME NULL/);
  assert.match(migration, /CREATE OR REPLACE TRIGGER trg_subscribers_cs_at_insert BEFORE INSERT ON subscribers/);
  assert.match(migration, /CREATE OR REPLACE TRIGGER trg_subscribers_cs_at_update BEFORE UPDATE ON subscribers/);
  // Every path that hands a new client to collection keeps to the caps.
  for (const file of ['api/routes/admin/leads.js', 'api/routes/admin/subscribers.js', 'api/routes/subscriber-payments.js']) {
    assert.match(read(file), /pickCollectionOfficer\(/, file);
  }
  assert.match(read('api/routes/admin/stafflists.js'), /await loadCollectionPicker\(conn, req\.tenantId\)/);
});

test('the picker skips an officer at their cap for the period', () => {
  const { createCollectionPicker, sanitizeCollectionConfig } = require('../lib/collectionDistribution');
  const config = sanitizeCollectionConfig({ members: [
    { staffId: 'a', intakeLimit: 2, intakePeriod: 'week' },
    { staffId: 'b', intakeLimit: 1, intakePeriod: 'month' },
  ] });
  const staff = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const picker = createCollectionPicker(staff, config, new Map([['a', 1]]));
  const handed = [picker.next('local'), picker.next('local'), picker.next('local')].map(person => person?.id || null);
  // A has one left this week, B one this month, then nobody.
  assert.deepEqual(handed.filter(Boolean).sort(), ['a', 'b']);
  assert.equal(handed[2], null);
});

test('the online import lands where the desk says, unassigned unless an officer is chosen', async () => {
  const { lib, restore } = loadImport();
  try {
    const { db, inserted, assigned } = fakeDb([{ id: 's-free', phone: '01011111111', email: null, assigned_cs_id: null }]);
    const result = await lib.importCollectionRows({
      tenantId: 't1', staff: null, kind: 'active', branch: 'ONLINE_SAUDI', source: 'استيراد الأونلاين',
      rows: [{ _name: 'جديد', _phone: '0555000111' }, { _name: 'موجود', _phone: '+201011111111' }],
    }, db);
    assert.deepEqual(result, { created: 1, assigned: 0, skipped: 1, others: 0, failed: 0 });
    assert.equal(assigned.length, 0, 'nobody already on the system is handed to anyone');
    assert.equal(inserted[0][6], 'ONLINE_SAUDI');
    assert.equal(inserted[0][9], null, 'no officer');
    assert.equal(JSON.parse(inserted[0][11]).clientStatus, 'active');
  } finally { restore(); }

  const routes = read('api/routes/collection-distribution.js');
  assert.match(routes, /router\.post\('\/api\/admin\/online-clients\/import', \.\.\.guard,/);
  const bar = read('admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx');
  assert.match(bar, /📥 استيراد عملاء/);
});
