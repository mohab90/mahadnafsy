'use strict';

// A date on screen has to say which clock it means.
//
// `toLocaleDateString('ar-EG-u-nu-latn')` formats in the *viewer's* browser
// zone. Everyone at the institute is in Cairo, so this was invisible — and
// stayed invisible through 75 calls across 59 files, of which exactly two ever
// passed a timeZone.
//
// It is not invisible to everyone. Egypt runs UTC+2 in winter and UTC+3 in
// summer; Saudi Arabia is UTC+3 all year. So for the winter half:
//
//   a payment taken at 23:30 Cairo reads as the 'next day' to a manager in
//   Riyadh, and its row sorts and groups under that day
//   a student abroad opens their certificate and reads an issue date one day
//   off the one printed on the certificate itself
//   «سجل الدخول», «سجل النشاط» and the audit log timestamp every entry in
//   whatever zone the laptop happens to be set to
//
// The institute's records are Cairo dates. shared/cairoDate.ts already held
// CAIRO_TIME_ZONE for the day-arithmetic side; the display side uses it now.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// `.` does not match \r, so `//.*$` never strips a full-line comment out of a
// CRLF file. [^\n] does.
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
  for (const app of ['admin', 'client', 'shared']) walk(path.join(ROOT, app));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

// A call is about a date only if the method says so, the options name a date
// field, or the receiver is plainly one. Without this the scan counts
// `amount.toLocaleString()` — 380 of those, none of which has a zone to get
// wrong, and reporting them would bury the 75 that matter.
const DATE_FIELD = /\b(year|month|day|weekday|hour|minute|second|dateStyle|timeStyle|era)\b/;

function dateFormattingCalls(source) {
  const found = [];
  for (const match of source.matchAll(/\.toLocale(Date|Time|)String\s*\(/g)) {
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length - 1; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const args = source.slice(match.index + match[0].length, end);
    const before = source.slice(Math.max(0, match.index - 90), match.index);
    const isDate = match[1] === 'Date' || match[1] === 'Time'
      || DATE_FIELD.test(args)
      || /new Date\([^)]*\)$/.test(before)
      || /\b(date|Date|createdAt|updatedAt|paidAt|at|submitted_at|created_at)\s*\)?$/.test(before);
    if (!isDate) continue;
    found.push({ args, line: source.slice(0, match.index).split('\n').length });
  }
  return found;
}

test('every date on screen is formatted in one named zone', () => {
  const files = browserSources();
  // Denominator: a walk that stopped matching would report a clean bill.
  assert.ok(files.length > 300, `expected both app trees, saw ${files.length}`);

  const offenders = [];
  let total = 0;
  for (const rel of files) {
    const source = codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const call of dateFormattingCalls(source)) {
      total++;
      if (!/timeZone/.test(call.args)) offenders.push(`${rel}:${call.line}`);
    }
  }

  assert.deepEqual(offenders, [],
    'these format a date in whatever zone the viewer\'s browser is set to: ' + offenders.join(', '));

  // The premise: the calls are still there. An empty offender list because the
  // dates stopped being shown is not the outcome this test wants.
  assert.ok(total >= 70, `expected the date formatting to still exist, saw ${total} call(s)`);
});

test('and that zone is the institute\'s, from one constant', () => {
  const files = browserSources();
  const users = files.filter(rel =>
    /CAIRO_TIME_ZONE/.test(codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'))));
  assert.ok(users.length >= 55, `expected the migrated screens, saw ${users.length}`);

  const helper = fs.readFileSync(path.join(ROOT, 'shared', 'cairoDate.ts'), 'utf8');
  assert.match(helper, /export const CAIRO_TIME_ZONE = 'Africa\/Cairo';/);

  // Nobody spells it out again *as a formatting option* — a second literal is
  // how the two drift. `timezone:` with a small z is a different thing: a
  // stored field on a tenant, a branch, a therapist's availability slot, a drip
  // campaign. Those are data and keep their literal default.
  const literals = files.filter(rel => {
    if (rel === 'shared/cairoDate.ts') return false;
    return /timeZone:\s*'Africa\/Cairo'/.test(codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  });
  assert.deepEqual(literals, [],
    'these write the zone into a formatting call instead of importing it: ' + literals.join(', '));
});

test('the tenant timezone setting is stored and read by nothing', () => {
  // tenants.default_timezone is written when a tenant is created and is
  // editable in الإعدادات ← عام, with six zones to choose from. No screen and no
  // route reads it back, so changing it does nothing — which is worth knowing
  // before someone changes it expecting the dashboard to follow.
  //
  // Display is pinned to Cairo deliberately: this deployment has one tenant,
  // the institute is in Cairo, and its records are Cairo dates. If a second
  // tenant in another zone ever arrives, this test is where to start.
  const readers = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(t|j)sx?$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        // Reading it means putting it into a formatter, not storing it.
        if (/timeZone:\s*[^'"\s]*default_timezone/.test(text)) {
          readers.push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    }
  };
  for (const area of ['admin', 'client', 'shared', 'api']) walk(path.join(ROOT, area));

  assert.deepEqual(readers, [],
    'default_timezone now drives a formatter — the Cairo constant is no longer the whole answer: ' + readers.join(', '));
});

test('the difference it makes, at the hours it makes it', () => {
  // Not a source assertion — run it. Winter, when Cairo is UTC+2 and Riyadh
  // is UTC+3, is when the two disagree.
  const instant = new Date('2026-01-15T23:30:00+02:00'); // 23:30 Cairo

  const cairo = instant.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const riyadh = instant.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  assert.equal(cairo, '2026-01-15', 'the payment was taken on the 15th');
  assert.equal(riyadh, '2026-01-16', 'the premise: a manager in Riyadh saw the 16th');

  // And the same instant pinned to Cairo reads the same from anywhere.
  for (const zone of ['Asia/Riyadh', 'America/New_York', 'Europe/London', 'Asia/Tokyo']) {
    const asShown = new Date(instant.toLocaleString('en-US', { timeZone: zone }));
    assert.ok(asShown instanceof Date, `${zone} parses`);
    assert.equal(instant.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), '2026-01-15',
      `naming the zone makes ${zone} irrelevant, which is the point`);
  }

  // Summer, when Cairo and Riyadh agree — the bug hides for half the year,
  // which is why it survived 75 calls.
  const summer = new Date('2026-07-15T23:30:00+03:00');
  assert.equal(summer.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), '2026-07-15');
  assert.equal(summer.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }), '2026-07-15');
});

// ── and the digits ───────────────────────────────────────────────────────────
//
// The same defect one step over. `(164961).toLocaleString()` with no locale
// also follows the viewer: an ar-EG browser renders «١٦٤٬٩٦١» in Arabic-Indic
// digits, an en-US one «164,961». 246 calls were bare and 132 asked for
// 'ar-EG-u-nu-latn' — Arabic grouping, Latin digits — so a staff member whose
// browser is set to Arabic read both on one screen, and the amounts they could
// copy out of the page depended on their laptop.
//
// Every deliberate choice in this codebase was Latin, 132 times over. That is
// the one all of them make now.

const NUMBER_LOCALE = "'ar-EG-u-nu-latn'";

function numberFormattingCalls(source) {
  const found = [];
  for (const match of source.matchAll(/\.toLocaleString\s*\(/g)) {
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length - 1; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const args = source.slice(match.index + match[0].length, end).trim();
    // A date goes through the zone rule above, not this one.
    if (DATE_FIELD.test(args) || /timeZone/.test(args)) continue;
    found.push({ args, line: source.slice(0, match.index).split('\n').length });
  }
  return found;
}

test('every number on screen is formatted in one named locale', () => {
  const files = browserSources();
  assert.ok(files.length > 300, `expected both app trees, saw ${files.length}`);

  const bare = [];
  const other = [];
  let total = 0;
  for (const rel of files) {
    const source = codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const call of numberFormattingCalls(source)) {
      total++;
      if (call.args === '') bare.push(`${rel}:${call.line}`);
      else if (!call.args.startsWith(NUMBER_LOCALE)) other.push(`${rel}:${call.line} (${call.args.slice(0, 30)})`);
    }
  }

  assert.deepEqual(bare, [],
    'these format a number in whatever locale the viewer\'s browser is set to — an Arabic one gives Arabic-Indic digits: ' + bare.join(', '));
  assert.deepEqual(other, [],
    'these ask for a different locale, so the same screen can disagree with itself: ' + other.join(', '));

  assert.ok(total >= 370, `expected the number formatting to still exist, saw ${total} call(s)`);
});

test('which digits that actually produces', () => {
  // Run it. The whole reason 'ar-EG-u-nu-latn' is spelled out is the -u-nu-latn.
  const amount = 164961.5;
  assert.equal(amount.toLocaleString('ar-EG-u-nu-latn'), '164,961.5');
  assert.equal(amount.toLocaleString('ar-EG'), '١٦٤٬٩٦١٫٥',
    'the premise: a browser set to Arabic (Egypt) renders Arabic-Indic digits');
  assert.notEqual(amount.toLocaleString('ar-EG'), amount.toLocaleString('ar-EG-u-nu-latn'));
});
