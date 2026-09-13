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

test('cairoDateOnly actually answers Cairo, at the hours it matters', () => {
  // Not a source assertion — run it. The three hours after midnight are the
  // whole point, so they are what gets checked.
  const CAIRO = 'Africa/Cairo';
  const cairoDateOnly = value => new Date(value).toLocaleDateString('en-CA', { timeZone: CAIRO });

  const helper = fs.readFileSync(path.join(ROOT, 'shared', 'cairoDate.ts'), 'utf8');
  assert.match(helper, /toLocaleDateString\('en-CA', \{ timeZone: CAIRO_TIME_ZONE \}\)/,
    'en-CA is what produces YYYY-MM-DD, which is the shape every caller compares');

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
