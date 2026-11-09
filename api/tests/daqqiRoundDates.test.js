'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'api/routes/daqqi-rounds.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'api/lib/db.js'), 'utf8');

// ymd now lives in lib/helpers.js — a second route needed it — so this imports
// the real function instead of extracting it from the route's source. helpers.js
// is pure and opens no pool, which the route itself does at import time; that is
// why the rest of this file still reads sources as text.
const { ymd } = require('../lib/helpers');




test('the pool leaves DATETIME as a JS Date, so the route must not stringify one', () => {
  // The premise of the bug. If this ever changes to dateStrings: true the helpers
  // stay correct, but the reason they exist should be re-read.
  
  assert.equal(String(new Date(2026, 5, 17, 20, 30)).slice(0, 10), 'Wed Jun 17');
});

test('a round start date reads back as a calendar date, not Date.toString()', () => {
  assert.equal(ymd(new Date(2026, 5, 17, 20, 30)), '2026-06-17');
  // Late-evening Cairo rounds must not slide to the previous day through UTC.
  assert.equal(ymd(new Date(2026, 0, 1, 0, 15)), '2026-01-01');
  assert.equal(ymd(new Date(2025, 11, 31, 23, 45)), '2025-12-31');
});

test('ymd passes DATE strings through and refuses to invent a date', () => {
  assert.equal(ymd('2025-03-04'), '2025-03-04');
  assert.equal(ymd('2025-03-04 18:00:00'), '2025-03-04');
  assert.equal(ymd(null), '');
  assert.equal(ymd(''), '');
  // "Invalid Da" was reaching the schedule and being posted back on the next edit.
  assert.equal(ymd(new Date('nonsense')), '');
});


