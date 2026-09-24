'use strict';

// «اليوم» meant the UTC day in 83 places across both browsers.
//
// Cairo runs two to three hours ahead of UTC, so from midnight until 02:00 or
// 03:00 local, `new Date().toISOString().slice(0, 10)` names *yesterday*. For
// those hours, every night:
//
//   a payment recorded at the Daqqi desk defaulted to yesterday's date
//   «متابعات اليوم» listed yesterday's follow-ups and none of today's
//   manual attendance was marked against yesterday
//   «إيرادات اليوم» counted the previous day and reported nothing for the
//   receipts taken that morning
//
// shared/cairoDate.ts already existed for exactly this and was used in three
// places. It is used in all of them now.
//
// The server has its own — api/lib/dates.js dateOnlyInTimeZone — and this test
// checks the browsers, which are the side that had drifted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

function browserSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const app of ['admin', 'client']) walk(path.join(ROOT, app));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

test('no screen decides what "today" is in UTC', () => {
  const files = browserSources();
  // Denominator: a walk that stopped matching would report a clean bill.
  assert.ok(files.length > 300, `expected both app trees, saw ${files.length}`);

  const offenders = [];
  for (const rel of files) {
    const source = codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(source)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [],
    'these take the UTC day as today, which is yesterday until 02:00 Cairo: ' + offenders.join(', '));

  // The premise: cairoDateOnly is genuinely in wide use, so an empty offender
  // list means the calls moved rather than vanished.
  const adopters = files.filter(rel =>
    /\bcairoDateOnly\b/.test(codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'))));
  assert.ok(adopters.length >= 55, `expected the migrated callers, saw ${adopters.length}`);
});

test('cairoDateOnly actually answers Cairo, at the hours it matters', async () => {
  // Not a source assertion — run the real helper. This used to run a copy of it
  // and pin the source to toLocaleDateString, which is what it happened to call;
  // Node strips the types itself now (22.13+), so the shipped code is what runs.
  // The three hours after midnight are the whole point, so they are what gets
  // checked.
  const { stripTypeScriptTypes } = require('node:module');
  const js = stripTypeScriptTypes(fs.readFileSync(path.join(ROOT, 'shared', 'cairoDate.ts'), 'utf8'));
  const { cairoDateOnly } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

  // 12 September 2026, Cairo is UTC+3 that week.
  for (const hour of ['00:30', '01:30', '02:30']) {
    const instant = new Date(`2026-09-12T${hour}:00+03:00`);
    assert.equal(cairoDateOnly(instant), '2026-09-12',
      `at ${hour} Cairo the institute's day is still the 12th`);
    assert.equal(instant.toISOString().slice(0, 10), '2026-09-11',
      `the premise: UTC says the 11th at ${hour} Cairo, which is what the bug was`);
  }

  // And it agrees with UTC during the day, so nothing else shifted.
  for (const hour of ['09:00', '15:00', '21:00']) {
    const instant = new Date(`2026-09-12T${hour}:00+03:00`);
    assert.equal(cairoDateOnly(instant), instant.toISOString().slice(0, 10));
  }
});

test('the month boundary is Cairo\'s too', () => {
  // Same fault one boundary up. On the first of a month, until 02:00 or 03:00
  // Cairo, `new Date().toISOString().slice(0, 7)` names the month that just
  // ended — so a monthly sales target keyed on `period` matched no row,
  // «إيرادات الشهر» showed the previous month's, and a commission run started
  // against the wrong period. 31 places asked that way.
  const offenders = browserSources().filter(rel =>
    /new Date\(\)\.toISOString\(\)\.slice\(0,\s*7\)/.test(codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'))));
  assert.deepEqual(offenders, [],
    'these take the UTC month as this month: ' + offenders.join(', '));

  const CAIRO = 'Africa/Cairo';
  const cairoMonthOnly = value =>
    new Date(value).toLocaleDateString('en-CA', { timeZone: CAIRO }).slice(0, 7);

  // 1 October 2026, 01:30 Cairo. UTC still says September.
  const firstOfMonth = new Date('2026-10-01T01:30:00+03:00');
  assert.equal(cairoMonthOnly(firstOfMonth), '2026-10');
  assert.equal(firstOfMonth.toISOString().slice(0, 7), '2026-09', 'the premise');
});

test('a date range starts where the institute\'s day starts', () => {
  // Five screens declared their own getRangeStart, three byte-identical, and
  // all five built «آخر ٧ أيام» as `new Date(+d - 7 * 86400000)` formatted in
  // UTC — a day early for the same three hours every night.
  const helper = codeOnly(fs.readFileSync(path.join(ROOT, 'admin', 'lib', 'rangeStart.ts'), 'utf8'));
  assert.match(helper, /case '7d':\s*\n\s*case 'week': return cairoDaysAgo\(7\);/);
  assert.match(helper, /case 'month': return `\$\{cairoMonthOnly\(\)\}-01`;/);

  const screens = [
    'admin/pages/dashboard/tabs/MarketingHubTab.tsx',
    'admin/pages/dashboard/tabs/OnlineTeamTab.tsx',
    'admin/pages/dashboard/tabs/SalesHubTab.tsx',
    'admin/pages/dashboard/tabs/SalesReportsTab.tsx',
    'admin/pages/dashboard/tabs/StaffPerformanceTab.tsx',
  ];
  for (const rel of screens) {
    const source = codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(source, /rangeStartDate\(/, `${rel} does not use the shared range`);
    assert.ok(!/function getRangeStart/.test(source), `${rel} declares its own again`);
  }

  // Whole days off the Cairo day, not milliseconds off an instant — which is
  // also what keeps the boundary right across a daylight-saving change.
  const cairo = codeOnly(fs.readFileSync(path.join(ROOT, 'shared', 'cairoDate.ts'), 'utf8'));
  assert.match(cairo, /Date\.UTC\(year, month - 1, day - days\)/);
  assert.ok(!/86400000/.test(cairo), 'day arithmetic on milliseconds skips an hour twice a year');
});
