'use strict';

// «اعمل تاب لكل فريق السيلز اسمه جدول الدقي يعرض كل الكورسات الجديدة او الكورسات
// اللى فات منها محاضرتين فقط … وبدون عرض العملاء الداخليه لكل كورس … اول ما يوصل
// الكورس للمحاضرة التالته تختفي من عند السيلز» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-sales-schedule-secret-0123456789-abcdefghijk';

const { lectureToday, nextSessionDate } = require('../lib/daqqiLecture');

const ROOT = path.join(__dirname, '..', '..');
function adminRule() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin', 'pages', 'dashboard', 'tabs', 'daqqi', 'daqqiScheduleUtils.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.calcCurrentLecture;
}

test('the lecture is counted by the date, a postponed week not counted', () => {
  const today = '2026-10-08';
  assert.equal(lectureToday('2026-10-12', [], today), 0, 'not started');
  assert.equal(lectureToday('2026-10-08', [], today), 1, 'starts today');
  assert.equal(lectureToday('2026-10-02', [], today), 1);
  assert.equal(lectureToday('2026-09-26', [], today), 2);
  assert.equal(lectureToday('2026-09-22', [], today), 3, 'the third lecture');
  assert.equal(lectureToday('2026-09-22', ['2026-09-29'], today), 2, 'one week postponed');
  assert.equal(nextSessionDate('2026-10-12', today), '2026-10-12');
  assert.equal(nextSessionDate('2026-10-02', today), '2026-10-09');
  assert.equal(nextSessionDate('2026-10-01', today), '2026-10-08', 'today is a session day');
});

test('sales and the Dokki team read the same lecture', { skip: !adminRule() }, () => {
  const calc = adminRule();
  const { cairoToday } = require('../lib/dates');
  for (const start of ['2026-08-04', '2026-09-22', '2026-09-26', '2026-10-02']) {
    const expected = calc(start, ['x']);
    assert.equal(lectureToday(start, ['x'], cairoToday()) || 1, expected, start);
  }
});

test('the list holds the rounds not started or on lecture 1–2, and nobody in them', async () => {
  const db = { calls: [] };
  const stub = (rel, exports) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  stub('../lib/dates', { ...require('../lib/dates'), cairoToday: () => '2026-10-08' });
  stub('../lib/db', {
    pool: { query: async (sql, params) => {
      db.calls.push(String(sql));
      return [[
        { id: 'r1', code: '3001', branch: 'DAQQI', course_id: 'c1', course_title: 'العلاج المعرفي', instructor_name: 'د. منى', day_of_week: 'الاثنين', start_date: '2026-10-12', time_slot: 'EVENING', room: 'قاعة 2', postponed_weeks_json: '[]' },
        { id: 'r2', code: '3017', branch: 'DAQQI', course_id: 'c2', course_title: 'الإرشاد الأسري', instructor_name: '', day_of_week: 'السبت', start_date: '2026-09-26', time_slot: 'MORNING', room: '', postponed_weeks_json: '[]' },
        { id: 'r3', code: '3005', branch: 'DAQQI', course_id: 'c3', course_title: 'تعديل السلوك', instructor_name: '', day_of_week: 'الثلاثاء', start_date: '2026-09-22', time_slot: 'NOON', room: '', postponed_weeks_json: '[]' },
      ]];
    } },
    cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
    getStaffIdByEmail: async () => null,
  });
  delete require.cache[require.resolve('../lib/daqqiLecture')];
  const router = require('../routes/daqqi-rounds');
  const layers = router.stack.find(l => l.route && l.route.path === '/api/admin/daqqi-rounds/sales-schedule' && l.route.methods.get).route.stack;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layers[layers.length - 1].handle({ tenantId: 'tenant-default' }, res);
  assert.deepEqual(res.body.map(round => [round.code, round.lecture]), [['3001', 0], ['3017', 2]]);
  assert.ok(res.body.every(round => !('attendees' in round)), 'no client of any round');
  assert.doesNotMatch(db.calls[0], /daqqi_attendees|subscribers/);
  assert.equal(res.body[0].timeSlot, 'مساءً');
});
