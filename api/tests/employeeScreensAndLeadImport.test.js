'use strict';

/**
 * Four things reported from the desk, held here:
 *
 *  1. «نشاطي — آخر 7 أيام» ran off the page. The conversion bar was scaled by the
 *     busiest day's CALLS and had no ceiling, so a day with more conversions than
 *     calls grew to thousands of pixels.
 *  2. «المدفوع» read zero for most Dokki clients. Money paid before the system lives
 *     in crm_json.priorPaid, which neither the clients table (it built a row only from
 *     payments, prices and enrolments) nor the round roster could see.
 *  3. «محلي جديد» showed a handful of leads and said nothing about the rest of the
 *     leads nobody owns — international, imported archive, or closed out by status.
 *  4. An upload to «محلي قديم» / «دولي قديم» read badly: UTF-8 only, no Excel, a short
 *     list of exact heading spellings, and any phone without a country code dropped.
 *
 * The helpers are bundled with the admin's own esbuild and run; skipped where the
 * admin's packages are not installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

const agreed = load('admin/lib/agreedPrice.ts');
const groups = load('admin/pages/dashboard/tabs/leads/leadSourceGroups.ts');
const sheets = load('shared/sheetImport.ts');

// ── 2. money paid before the system ──────────────────────────────────────────

const courses = [{ id: 'c1', title: 'دبلومة', price: { EGP: 5000 } }];
const dokki = extra => ({ id: 's', name: 'x', branch: 'DAQQI', paymentHistory: [], enrolledCourseIds: [], ...extra });

test('a client whose only trace of a course is «مدفوع قبل السيستم» still has that course, paid', { skip: !agreed }, () => {
  const items = agreed.clientItems(dokki({ priorPaid: { c1: 3000 } }), courses, []);
  assert.equal(items.length, 1, 'the table showed «لا يوجد» and a dash for this client');
  assert.equal(items[0].paid, 3000);
  assert.equal(items[0].remaining, 2000);
});

test('prior money is counted once when the client is also enrolled and has paid here', { skip: !agreed }, () => {
  const items = agreed.clientItems(dokki({
    enrolledCourseIds: ['c1'], priorPaid: { c1: 1000 },
    paymentHistory: [{ id: 'p', amount: 500, currency: 'EGP', paymentType: 'course', courseId: 'c1', status: 'paid', at: '2026-09-01' }],
  }), courses, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].paid, 1500);
});

test('a zero or empty prior amount does not invent a course', { skip: !agreed }, () => {
  assert.equal(agreed.clientItems(dokki({ priorPaid: { c1: 0 } }), courses, []).length, 0);
  assert.equal(agreed.clientItems(dokki({ priorPaid: {} }), courses, []).length, 0);
});

test('the round roster reads prior money for the round\'s own course, apart from collected money', () => {
  const sql = read('api/lib/daqqiAttendees.js');
  assert.match(sql, /AS prior_paid/);
  assert.match(sql, /JSON_EXTRACT\(s\.crm_json,\s*CONCAT\('\$\.priorPaid\."', REPLACE\(dr\.course_id/);
  assert.match(sql, /JSON_VALID\(s\.crm_json\)/, 'a malformed crm_json must not take the whole roster down');
  const route = read('api/routes/daqqi-rounds.js');
  assert.match(route, /amountPrior: Number\(a\.prior_paid \|\| 0\)/);
  // Revenue sums read amountPaid; prior money must not be folded into it.
  assert.doesNotMatch(route, /amountPaid: Number\(a\.amount_paid \|\| 0\) \+/);
  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  // The row's figures come from one place, with the prior money added and the price the client agreed.
  assert.match(row, /attendeeMoney\(a, coursePrice\)/);
  const utils = read('admin/pages/dashboard/tabs/daqqi/daqqiScheduleUtils.ts');
  assert.match(utils, /const paid = collected \+ prior \+ applied;/);
  assert.match(utils, /remaining: price > 0 \? Math\.max\(0, price - paid\) : 0/);
});

// ── 1. the 7-day chart ───────────────────────────────────────────────────────

test('the 7-day chart scales both series into one fixed track', () => {
  const chart = read('admin/pages/dashboard/tabs/StaffActivityChart.tsx');
  assert.match(chart, /export const BAR_TRACK_PX = \d+;/);
  assert.match(chart, /const maxBar = Math\.max\(\.\.\.days\.map\(d => Math\.max\(d\.calls, d\.converted\)\), 1\);/);
  assert.match(chart, /\(d\.converted \/ maxBar\) \* BAR_TRACK_PX/);
  // The old scale: conversions divided by the busiest day's calls, never clamped.
  assert.doesNotMatch(chart, /converted \/ (stats\.)?maxCalls/);
  assert.match(chart, /overflow-hidden/);
  // And the home tab draws it, rather than keeping a second copy of the markup.
  const home = read('admin/pages/dashboard/tabs/StaffHomeTab.tsx');
  assert.match(home, /<StaffActivityChart days=\{stats\.last7\} today=\{today\} \/>/);
  assert.doesNotMatch(home, /maxCalls/);
});

// ── 3. where the leads nobody owns are ───────────────────────────────────────

const lead = (extra = {}) => ({ id: Math.random().toString(36), hidden: false, assignedSalesId: null, assignedCsId: null,
  source: 'facebook', status: 'new', branch: 'DAQQI', ...extra });

test('every lead nobody is working is counted under its reason', { skip: !groups }, () => {
  const leads = [
    lead({ phone: '010' }), lead({ phone: '011' }), lead({ phone: '012' }), // waiting
    lead({ source: 'محلي قديم' }), lead({ source: 'استيراد 2024' }),      // imported archive: their own tab
    lead({ status: 'archived' }), lead({ status: 'archived', assignedSalesId: 'rep' }), // archived, whoever had it
    lead({ status: 'lost' }),                                             // closed, nobody on it
    lead({ assignedSalesId: 'rep' }),                                     // being worked: not in the pool
    lead({ hidden: true, phone: '013' }),                                 // hidden by someone
    lead({ hidden: true, phone: '', email: '' }),                         // hidden junk: nobody to call
  ];
  assert.deepEqual(groups.poolBreakdownOf(leads), { waiting: 3, closed: 1, archived: 2, hidden: 1 });
});

test('the «محلي جديد» tab shows each kind as a chip, waiting first', () => {
  const tab = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  assert.match(tab, /\(\['waiting', 'archived', 'hidden', 'closed'\] as const\)\.map\(reason =>/);
  assert.match(tab, /الأرشفة التلقائية للليدات اللي محدش كلمها/);
  assert.match(tab, /useLeadPool\(poolView, poolView === 'localNew' \? poolReason : null\)/);
});

test('while the full leads table is still arriving the pools say so, against the server total', () => {
  const tab = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  assert.match(tab, /leads\.length < leadStats\.total && fullLeadsState !== 'ready'/);
  // loadFullCrmData settles both tables, so it can never report a failure; the
  // leads pull itself is what the banner follows.
  assert.match(tab, /loadFullLeads\(\)\.then\(/);
  // The trigger itself stays exactly as leadsTableHoldsTheTableItShows pins it.
  assert.match(tab, /if \(fullLeadArraySubTabs\.has\(subTab\)\) void loadFullCrmData\(\);/);
  assert.match(tab, /setFullLeadsAttempt\(count => count \+ 1\)/);
});

test('a read-only script reports the same buckets from the database', () => {
  const script = read('api/tools/leads-pool-diagnostic.cjs');
  for (const needle of ['imported_archive', 'final_status', 'dawli_new', 'local_new', 'autoArchiveDays', 'unowned_waiting']) {
    assert.ok(script.includes(needle), `the diagnostic lost ${needle}`);
  }
  assert.doesNotMatch(script, /\b(INSERT|UPDATE|DELETE)\b\s+(INTO\s+)?leads/i, 'a diagnostic never writes');
});

// ── 4. reading an upload ─────────────────────────────────────────────────────

test('a CSV saved as Windows-1256 or UTF-16 reads as Arabic, not boxes', { skip: !sheets }, () => {
  const text = 'الاسم,الهاتف\nأحمد,01012345678';
  const utf8 = Buffer.from(text, 'utf8');
  assert.equal(sheets.decodeSheetText(utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.length)).text, text);

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const decoded16 = sheets.decodeSheetText(utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.length));
  assert.equal(decoded16.text, text);
  assert.equal(decoded16.encoding, 'utf-16le');

  // «الاسم,الهاتف» in Windows-1256.
  const cp1256 = Buffer.from([0xc7, 0xe1, 0xc7, 0xd3, 0xe3, 0x2c, 0xc7, 0xe1, 0xe5, 0xc7, 0xca, 0xdd]);
  const decoded = sheets.decodeSheetText(cp1256.buffer.slice(cp1256.byteOffset, cp1256.byteOffset + cp1256.length));
  assert.equal(decoded.encoding, 'windows-1256');
  assert.ok(decoded.text.startsWith('الاسم,'), `read as ${JSON.stringify(decoded.text)}`);
});

test('an international sheet keeps its phones; the strict reader\'s «no phone» no longer drops the row', { skip: !sheets }, () => {
  // Saudi mobile with no country code, as a Gulf sheet writes it.
  assert.equal(sheets.leadPhone('501234567').phone, '501234567');
  // The ones the strict reader vouches for are still normalised.
  assert.equal(sheets.leadPhone('+20 101 234 5678').phone, '01012345678');
  assert.equal(sheets.leadPhone(1012345678).phone, '01012345678', 'Excel dropped the zero');
  assert.equal(sheets.leadPhone('٠١٠١٢٣٤٥٦٧٨').phone, '01012345678', 'Arabic digits');
  assert.equal(sheets.leadPhone('+966 50 123 4567').phone, '+966501234567');
  // Two numbers in a cell: the first is the phone, the rest are kept.
  const two = sheets.leadPhone('01012345678 / 01112345678');
  assert.equal(two.phone, '01012345678');
  assert.deepEqual(two.others, ['01112345678']);
  // Not numbers at all.
  assert.equal(sheets.leadPhone('#ERROR!').phone, '');
  assert.equal(sheets.leadPhone('').phone, '');
  assert.equal(sheets.leadPhone('0000000000').phone, '', 'a placeholder');
});

test('the headings real exports use are all understood', { skip: !sheets }, () => {
  const layoutOf = headings => sheets.detectLayout([headings, ['أحمد', '01012345678', 'a@b.com', 'ملاحظة', 'x']]);
  for (const headings of [
    ['full_name', 'phone_number', 'email', 'الكورس', 'اختر_الفرع_'],               // the documented sheet
    ['اسم العميل', 'رقم التليفون', 'الايميل', 'الدبلومة', 'الفرع'],                // «رقم التليفون» matched nothing before
    ['الاسم', 'الموبيل', 'email', 'ملاحظات', 'الكورس'],
    ['Name', 'Mobile', 'Email', 'Notes', 'Course'],
    ['الاسم بالكامل', 'رقم الجوال', 'البريد الالكتروني', 'ملاحظة', 'البرنامج'],
  ]) {
    const { columns, headerRow } = layoutOf(headings);
    assert.equal(headerRow, 0, `no heading row found in ${headings.join(' | ')}`);
    assert.equal(columns.name, 0, `name not found in ${headings.join(' | ')}`);
    assert.equal(columns.phone, 1, `phone not found in ${headings.join(' | ')}`);
  }
});

test('the import screen reads through the shared sheet reader and lets the person correct a column', () => {
  const tab = read('admin/pages/dashboard/tabs/leads/ArchiveTab.tsx');
  assert.match(tab, /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared\/sheetImport'/);
  assert.match(tab, /readSheetFile\(file\)/);
  assert.match(tab, /leadPhone\(row\[columns\.phone\]\)/);
  assert.match(tab, /accept="\.xlsx,\.xlsm,\.csv,\.tsv,\.txt"/);
  assert.match(tab, /setImportColumn\(field\.key, e\.target\.value\)/);
  // The private reader it replaced.
  assert.doesNotMatch(tab, /readAsText\(file, 'UTF-8'\)/);
  assert.doesNotMatch(tab, /COLUMN_ALIASES/);
  // And the reader itself decodes bytes rather than assuming UTF-8.
  assert.match(read('shared/sheetImport.ts'), /decodeSheetText\(await file\.arrayBuffer\(\)\)/);
});

// ── what the cold-lead job did to the pools (3 Oct 2026: 18,809 of 20,367 leads archived) ──

test('handing an archived lead to a rep brings it back as new', () => {
  const tab = read('admin/pages/dashboard/tabs/leads/ArchiveTab.tsx');
  assert.match(tab, /status: BACK_IN_PLAY\.includes\(lead\.status as string\) \? 'new' : lead\.status,/);
  assert.match(tab, /const BACK_IN_PLAY = \['archived', 'not_interested_hidden'\];/);
  assert.match(tab, /assignedSalesName: staff\.name, hidden: false,/, 'a hidden one is shown again');
});

test('the status the job writes can be labelled and filtered', () => {
  assert.match(read('admin/pages/dashboard/tabs/leads/LeadSubcomponents.tsx'), /archived: 'مؤرشف'/);
  assert.match(read('admin/pages/dashboard/tabs/leads/LeadFilterBar.tsx'), /<option value=\{'archived' as LeadStatus\}>📦 مؤرشف<\/option>/);
});

test('the restore tool counts first, writes only with --apply, and only undoes what the job did', () => {
  const script = read('api/tools/restore-archived-unowned-leads.cjs');
  assert.match(script, /const APPLY = args\.includes\('--apply'\);/);
  assert.match(script, /if \(!APPLY\) \{[\s\S]{0,200}return;/, 'a run without --apply returns before any write');
  // Narrow: the job's own timeline entry, still unowned, still archived, still visible.
  assert.match(script, /t\.meta_json LIKE '%"actor":"system"%'/);
  assert.match(script, /l\.assigned_sales_id IS NULL AND \(l\.assigned_cs_id IS NULL OR l\.assigned_cs_id=''\)/);
  assert.match(script, /l\.status='archived'/);
  // The update re-checks the status, as the job's own does.
  assert.match(script, /WHERE tenant_id=\? AND status='archived' AND id IN/);
  // The meta the job writes is what the filter looks for.
  const job = read('api/lib/leadAutoArchive.js');
  assert.match(job, /\{ from: 'cold', to: 'archived', actor: 'system', olderThanDays: days \}/);
  const written = JSON.stringify({ from: 'cold', to: 'archived', actor: 'system', olderThanDays: 7 });
  assert.ok(written.includes('"actor":"system"') && written.includes('"to":"archived"'));
});

test('the diagnostic asks the capture path\'s own question for each kind of waiting lead', () => {
  const script = read('api/tools/leads-pool-diagnostic.cjs');
  assert.match(script, /listDistributableReps\(TENANT, pool, \{\s*branch:/);
  assert.match(script, /courseIds: entry\.courseIds/);
});
