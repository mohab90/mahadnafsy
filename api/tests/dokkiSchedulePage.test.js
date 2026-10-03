'use strict';

// «في صفحه جدول الدقي ليه بيظهر دول كدا … اخفيهم مبوظين شغل التصميم … عند نشوي
// مسئول الفرع ليه بيظهرلها ايرور عند اضافه عميل في الروند … خلي تصميم الجدول
// علي اد الصفحه ميبقاش في سكرول يمين وشمال … ✓ اشتغلت ✗ ماشتغلتش خليهم جمب بعض
// … لون العملاء داخل الروند … خلفيتهم مختلفه … بعض الارقام التحليله في اعلي
// الصفحه عن الدقي» (1 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The schedule's own helpers, bundled on the spot, so the figures are computed
// rather than read. Skipped where the admin's packages are not installed.
function loadScheduleUtils() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin/pages/dashboard/tabs/daqqi/daqqiScheduleUtils.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')],
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const utils = loadScheduleUtils();

const seat = (subscriberId, amountPaid = 0) => ({ subscriberId, name: subscriberId, phone: '', bookedAt: '2026-09-21', amountPaid });
const round = (courseId, status, attendees, extra = {}) => ({ courseId, status, attendees, postponedWeeks: [], heldWeeks: [], ...extra });

test('the branch in numbers: each waiting client once, the week\'s lectures, the open rounds\' money', { skip: !utils }, () => {
  const WEEK = '2026-09-28';
  const bundles = [{ id: 'b1', title: 'مسار', courses: [{ id: 'c1' }, { id: 'c2' }] }];
  const clients = [
    { id: 'placed', enrolledCourseIds: ['c1'] },
    // Booked on c1, which runs in three open rounds: waiting once, not three times.
    { id: 'waiting', enrolledCourseIds: ['c1'] },
    // Holds the track; seated for c1, still waiting for c2.
    { id: 'half', enrolledCourseIds: ['bundle:b1'] },
    // Sat c3's finished round and c3 has an open one: not waiting for it again.
    { id: 'done', enrolledCourseIds: ['c3'] },
    // Booked on a course with no open round.
    { id: 'no-round', enrolledCourseIds: ['c9'] },
  ];
  const rounds = [
    round('c1', 'active', [seat('placed', 1500), seat('half', 500)], { heldWeeks: [WEEK] }),
    round('c1', 'active', [], { postponedWeeks: [WEEK] }),
    round('c1', 'new', []),
    round('c2', 'active', []),
    round('c3', 'finished', [seat('done', 3000)]),
    round('c3', undefined, []),
  ];
  const overview = utils.daqqiOverview({ rounds, clients, bundles, weekKey: WEEK, priceOf: id => ({ c1: 2000, c2: 1000, c3: 3000 }[id] || 0) });
  assert.equal(overview.clients, 5);
  assert.equal(overview.placed, 2);
  assert.equal(overview.waiting, 2, 'the one booked on c1 and the track holder waiting for c2');
  assert.deepEqual(overview.rounds, { active: 3, fresh: 2, finished: 1 });
  assert.deepEqual(overview.week, { held: 1, postponed: 1, unanswered: 1 });
  // Open rounds only: the finished round's 3,000 is not «محصّل الروندات المفتوحة».
  assert.equal(overview.collected, 2000);
  assert.equal(overview.remaining, 2000, 'two seats at 2,000 less the 2,000 paid');
});

test('the strip stands where the «سكّن N» list stood', () => {
  const page = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(page, /<DaqqiOverviewStrip overview=\{overview\} \/>/);
  assert.doesNotMatch(page, /unplacedByRound/);
  assert.doesNotMatch(page, /عملاء حاجزين ومش مسكّنين في روند/);
  const strip = read('admin/pages/dashboard/tabs/daqqi/DaqqiOverviewStrip.tsx');
  for (const label of ['عملاء الدقي', 'مسكّنين في روندات', 'حاجزين ومش مسكّنين', 'روندات شغالة', 'محاضرات الأسبوع ده', 'محصّل الروندات المفتوحة']) {
    assert.ok(strip.includes(`'${label}'`), label);
  }
});

test('a client with no number of their own is seated like any other', () => {
  const route = read('api/routes/daqqi-rounds.js');
  // daqqi_attendees.phone is NOT NULL; 138 Dokki clients have none.
  assert.ok(route.includes("SELECT ?,s.id,?,s.name,COALESCE(NULLIF(s.phone,''), NULLIF(s.whatsapp,''), ''),?,"));
  assert.doesNotMatch(route, /SELECT \?,s\.id,\?,s\.name,s\.phone,\?,/);
  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  assert.match(row, /<span className="text-gray-400">من غير رقم<\/span>/);
  assert.match(row, /<button disabled=\{!a\.phone\} onClick=\{e => \{ e\.stopPropagation\(\); window\.open\(`https:\/\/wa\.me\//);
});

test('the save seats exactly whom the dialog offered, and says so', () => {
  const page = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(page, /const newSubs = daqqiSubs\.filter\(\s+s => daqqiAddClientsSel\.has\(s\.id\) && !round\.attendees\.find\(a => a\.subscriberId === s\.id\)\s+\);/);
  assert.doesNotMatch(page, /daqqiBranchIds\.has\(s\.branch \|\| ''\) && daqqiAddClientsSel/);
  assert.match(page, /notify\('success', `اتسكّن \$\{newSubs\.length\.toLocaleString\('ar-EG-u-nu-latn'\)\} عميل في روند/);
});

test('the table is eleven columns at the page\'s width, not thirteen over 1,050px', () => {
  const page = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  const table = page.slice(page.indexOf('<table className="w-full table-fixed'), page.indexOf('</thead>', page.indexOf('<table className="w-full table-fixed')));
  assert.match(table, /^<table className="w-full table-fixed text-sm min-w-\[920px\] lg:min-w-0">/);
  assert.doesNotMatch(page, /min-w-\[1050px\]/);
  const shares = [...table.matchAll(/<col className="w-\[(\d+)%\]" \/>/g)].map(match => Number(match[1]));
  // Eleven since the hall got a column of its own («خلي عمود القاعه عمود لوحده»).
  assert.equal(shares.length, 11);
  assert.equal(shares.reduce((sum, share) => sum + share, 0), 100);
  assert.equal((table.match(/<th /g) || []).length, 11);
  assert.match(table, /الميعاد<\/th>\s*<th[^>]*>القاعة<\/th>/);
  // «المحصّل» and «المتبقي» apart, as asked on 30 Sep.
  assert.match(table, /المحصّل<\/th>\s*<th[^>]*>المتبقي<\/th>/);
  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  const summary = row.slice(row.indexOf('<React.Fragment'), row.indexOf('{isExpanded && ('));
  assert.equal((summary.match(/<td /g) || []).length, 11, 'a cell for every heading');
  assert.match(row, /<td colSpan=\{11\} /);
  assert.doesNotMatch(row, /min-w-\[100px\]/);
});

test('the week\'s two answers sit side by side, and the open round\'s clients on their own ground', () => {
  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  // Small ✓ / ✗ in the same line as the other action icons (the actions column is
  // narrow now), the «worked» answer first.
  assert.match(row, /title="المحاضرة اشتغلت في ميعادها الأسبوع ده"/);
  assert.ok(row.indexOf('title="المحاضرة اشتغلت في ميعادها الأسبوع ده"') < row.indexOf('title="ماشتغلتش — تتأجل للأسبوع الجاي"'));
  assert.match(row, /<td colSpan=\{11\} className="border-b border-sky-200 border-r-4 border-r-sky-400 bg-sky-50 px-4 py-3">/);
  assert.match(row, /isExpanded \? 'bg-sky-100\/70' : index % 2 \? 'bg-gray-50' : 'bg-white'/);
  assert.doesNotMatch(row, /<td colSpan=\{13\} className="bg-gray-50/);
});
