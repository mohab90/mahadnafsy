'use strict';

// The Dokki requests of 9 Oct 2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

// «اعمل زر ادوس عليه يظهر الكورسات المنتهي … عشان الكورس المنتهيه استخدامها قليل جدا».
test('finished rounds are hidden until asked for', () => {
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /const \[showFinished, setShowFinished\] = useState\(false\);/);
  assert.match(tab, /\(showFinished \|\| daqqiFilterStatus === 'finished' \|\| r\.status !== 'finished'\) &&/);
});

// «زر بحث وحجز دفعه … البحث صحيح لما اكتب اول حرفين».
function matcher() {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { matchesSearch } from './lib/clientSearch';", resolveDir: path.join(__dirname, '../../admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.matchesSearch;
}
const matchesSearch = matcher();

test('two letters find the people with them, not the first eight on the list', { skip: !matchesSearch }, () => {
  const clients = [
    { name: 'أحمد سمير', phone: '01012345678' },
    { name: 'منى علي', phone: '01198765432' },
    { name: 'هاني مراد', phone: '01222222222' },
  ];
  const found = query => clients.filter(client => matchesSearch(query, client)).map(client => client.name);
  assert.deepEqual(found('اح'), ['أحمد سمير'], '«اح» finds «أحمد»');
  assert.deepEqual(found('من'), ['منى علي']);
  assert.deepEqual(found('0119'), ['منى علي'], 'a number by its digits');
  const modal = read('admin/pages/dashboard/DashboardQuickBooking.tsx');
  assert.doesNotMatch(modal, /replace\(\/\D\/g, ''\)\.includes\(qDigits\)/, 'the empty-digits test is gone');
  assert.match(modal, /\{searching && searchesEverything && <WholeDatabaseSearch query=\{q\} \/>\}/);
});

// «ممنوع تسكين عميل في روند من غير دفعة متسجلة» · «كل عملاء روند هيبقوا تبع نفس الرسيبشن».
function housingDb({ payment = false, priorPaid = null, inTrack = false }) {
  const writes = [];
  return {
    writes,
    query: async (sql, params = []) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      if (/^SELECT id, course_id, code, branch FROM daqqi_rounds/.test(flat)) return [[{ id: 'r-1', course_id: 'c-1', code: '3018', branch: 'DAQQI' }]];
      if (/^SELECT subscriber_id FROM daqqi_attendees/.test(flat)) return [[]];
      if (/^SELECT 1 AS ok FROM payments p/.test(flat)) return [payment ? [{ ok: 1 }] : []];
      if (/^SELECT crm_json FROM subscribers/.test(flat)) return [[{ crm_json: JSON.stringify(priorPaid ? { priorPaid } : {}) }]];
      if (/^SELECT 1 AS ok FROM bundle_courses/.test(flat)) return [inTrack ? [{ ok: 1 }] : []];
      if (/^SELECT reception_id, reception_name FROM daqqi_rounds/.test(flat)) return [[{ reception_id: 'st-donia', reception_name: 'donia hassan' }]];
      writes.push({ sql: flat, params });
      return [{ affectedRows: 1 }];
    },
  };
}
const auditFile = require.resolve('../lib/auditTrail');
require.cache[auditFile] = { id: auditFile, filename: auditFile, loaded: true, exports: { writeAuditEvent: async () => {} } };
const { seatSubscriberInRound } = require('../lib/daqqiHousing');

test('a client with no recorded payment for the course is not housed', async () => {
  const db = housingDb({});
  const seat = await seatSubscriberInRound(db, { tenantId: 't', roundId: 'r-1', subscriberId: 's-1' });
  assert.equal(seat.status, 'unpaid');
  assert.equal(db.writes.length, 0);
  assert.match(read('api/routes/daqqi-rounds.js'), /if \(seat\.status === 'unpaid'\) return res\.status\(409\)\.json\(\{ error: UNPAID_SEAT, code: 'DAQQI_UNPAID' \}\);/);
});

test('a payment, or money paid before the system for the course or its track, houses them — under the round\'s reception', async () => {
  for (const setup of [{ payment: true }, { priorPaid: { 'c-1': 1500 } }, { priorPaid: { 'bundle:b-1': 3000 }, inTrack: true }]) {
    const db = housingDb(setup);
    const seat = await seatSubscriberInRound(db, { tenantId: 't', roundId: 'r-1', subscriberId: 's-1' });
    assert.equal(seat.status, 'seated', JSON.stringify(setup));
    const owner = db.writes.find(w => /SET s\.assigned_cs_id=\?, s\.assigned_cs_name=\?/.test(w.sql));
    assert.deepEqual(owner.params.slice(0, 3), ['r-1', 'st-donia', 'donia hassan']);
  }
  const rounds = read('api/routes/daqqi-rounds.js');
  assert.match(rounds, /await assignToRoundReception\(conn, \{ tenantId: req\.tenantId, roundId: id \}\);/, 'a round saved with a new reception takes its clients');
  assert.match(rounds, /roundId: toRoundId, subscriberIds: \[subscriberId\]/, 'moved to another round, the client follows its reception');
  assert.match(read('api/migrations/263_v26_dokki_clients_to_round_reception.sql'), /WHERE s\.deleted_at IS NULL AND \(s\.assigned_cs_id IS NULL OR s\.assigned_cs_id = ''\);/, 'the backfill touches only clients with no owner');
});

// «في صفحه اعدادات الشهادات واسعارها هنخلي كمان فيها سعر الكارنيه وسعر الكتب …
// لما ينطلبوا يسمعوا في … طلبات اضافيه».
test('carnets and books are priced beside the certificates, picked by name, and land in «طلبات إضافية»', () => {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { parseExtraItems, priceIn } from './lib/extraItemsCatalog';", resolveDir: path.join(__dirname, '../../admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  const items = module.exports.parseExtraItems(JSON.stringify({ carnets: [{ id: 'k1', label: 'كارنيه النقابة', priceEGP: 600, priceSAR: 60 }, { label: ' ' }], books: [{ id: 'b1', label: 'كتاب العلاج المعرفي', priceEGP: 350 }] }));
  assert.equal(items.carnets.length, 1, 'an unnamed row is dropped');
  assert.equal(module.exports.priceIn(items.carnets[0], 'SAR'), 60);
  assert.equal(module.exports.priceIn(items.books[0], 'USD'), 0);
  assert.match(read('admin/components/PaymentModal.tsx'), /set\(\{ itemTitle: item\.label, \.\.\.\(price > 0 \? \{ amount: String\(price\) \} : \{\}\) \}\)/);
  for (const file of ['admin/pages/dashboard/dashboardPaymentHandlers.ts', 'admin/pages/unified-client/useUnifiedClientPayments.ts']) {
    assert.match(read(file), /itemTitle: (subPayDraft|draft|leadPayDraft)\.itemTitle \|\| undefined/, file);
  }
  assert.match(read('api/routes/subscriber-payments.js'), /sanitize\(payment\.itemTitle \|\| payment\.item_title \|\| '', 255\)/, 'the server keeps the name');
  assert.match(read('api/routes/certificates.js'), /p\.payment_type IN \('CARNEH','BOOK'\)/, 'and «طلبات إضافية» lists it');
});
