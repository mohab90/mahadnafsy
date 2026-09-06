'use strict';
// Approving a pending payment from the finance review queue answered 500 every
// time, for every payment. payments.date and expenses.date are DATETIME, and
// the pool sets dateStrings for DATE only — so a row read back from MySQL
// carries a Date object. The caller wrote String(row.date).slice(0, 10), which
// is not a date but the first ten characters of the Date's string form:
// «Wed Jul 15». postJournalEntry rejected it, returned null, and the route
// reported a journal failure it could not explain.
//
// Found by approving a payment against staging over real HTTP, not by reading.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { journalDate } = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'finance.js'), 'utf8');
  const fn = src.slice(src.indexOf('function journalDate'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  // dateOnlyInTimeZone is the real one; the normaliser is meaningless without it.
  const { dateOnlyInTimeZone } = require('../lib/dates');
  // eslint-disable-next-line no-new-func
  return { journalDate: new Function('dateOnlyInTimeZone', `${body}\nreturn journalDate;`)(dateOnlyInTimeZone) };
})();

const ISO = /^\d{4}-\d{2}-\d{2}$/;

test('a Date out of a DATETIME column becomes a real date', () => {
  const stored = new Date('2026-07-15T00:00:00.000Z');
  const got = journalDate(stored);
  assert.match(got, ISO);
  assert.equal(got, '2026-07-15');
  // The bug, stated as the thing that must not come back.
  assert.notEqual(got, String(stored).slice(0, 10));
});

test('a string date is left alone', () => {
  assert.equal(journalDate('2026-07-15'), '2026-07-15');
  assert.equal(journalDate('2026-07-15T09:30:00.000Z'), '2026-07-15');
});

test('the result always satisfies the journal\'s own date check', () => {
  // Lifted from postJournalEntry so the two cannot drift apart.
  const isRealDate = v => ISO.test(v) && !String(v).startsWith('0000-00-00') && !Number.isNaN(Date.parse(v));
  for (const input of [new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'), '2026-06-08']) {
    assert.equal(isRealDate(journalDate(input)), true, `rejected: ${input}`);
  }
});

test('nothing usable still yields nothing, rather than a wrong date', () => {
  // The callers fall back to today themselves; inventing one here would file
  // an entry on a day nobody chose.
  assert.equal(journalDate(null), '');
  assert.equal(journalDate(undefined), '');
  assert.equal(journalDate(''), '');
});

test('both journal builders use it, and the review route stopped pre-slicing', () => {
  const finance = fs.readFileSync(path.join(__dirname, '..', 'lib', 'finance.js'), 'utf8');
  assert.match(finance, /const entryDate = journalDate\(date\) \|\| dateOnlyInTimeZone\(\)/);
  assert.match(finance, /const dateStr = journalDate\(expense\.date\) \|\| dateOnlyInTimeZone\(\)/);

  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'core', 'financepay.js'), 'utf8');
  const codeOnly = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(codeOnly, /date: payment\.date \|\| new Date\(\)/);
  assert.doesNotMatch(codeOnly, /String\(payment\.date[^)]*\)\.slice\(0, 10\)/);
});
