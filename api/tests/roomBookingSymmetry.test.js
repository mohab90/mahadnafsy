'use strict';
/**
 * Two systems book the same physical halls. daqqi_rounds books by free-text
 * name plus a recurring Arabic weekday and a coarse slot; classroom_bookings
 * books by foreign key plus absolute start_time/end_time.
 *
 * The round side already refused a hall taken by a classroom booking. The
 * classroom side never looked the other way, so the same hall could be taken
 * from both screens with each one satisfied — and which desk got it depended
 * on who clicked first. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ARABIC_WEEKDAY_TO_MYSQL, mysqlWeekdayFromArabic, arabicWeekdaysForDate,
} = require('../lib/daqqiSchedule');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'routes', name), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the weekday translation round-trips, and both spellings of Monday survive', () => {
  // 2026-09-08 is a Tuesday, 2026-09-07 a Monday.
  assert.deepEqual(arabicWeekdaysForDate('2026-09-08T10:00:00Z'), ['الثلاثاء']);
  assert.deepEqual(arabicWeekdaysForDate('2026-09-07T10:00:00Z'), ['الإثنين', 'الاثنين']);
  for (const [name, number] of Object.entries(ARABIC_WEEKDAY_TO_MYSQL)) {
    assert.equal(mysqlWeekdayFromArabic(name), number);
    assert.ok(arabicWeekdaysForDate(new Date(Date.UTC(2026, 8, 6 + (number - 1)))).includes(name),
      `${name} must come back for its own weekday`);
  }
});

test('an unusable date matches no weekday rather than every one', () => {
  // A caller builds a WHERE ... IN () from this. Returning everything would
  // refuse every booking; returning nothing skips a check that cannot be made.
  assert.deepEqual(arabicWeekdaysForDate('not-a-date'), []);
  assert.deepEqual(arabicWeekdaysForDate(''), []);
  assert.equal(mysqlWeekdayFromArabic('Tuesday'), undefined);
});

test('both booking systems consult the other before taking a hall', () => {
  const rounds = codeOnly(read('daqqi-rounds.js'));
  const classrooms = codeOnly(read('dokki-operations.js'));

  // Round → classroom booking (this direction already existed).
  assert.ok(rounds.includes('FROM classroom_bookings cb'), 'a round checks the hall diary');
  assert.ok(rounds.includes('mysqlWeekdayFromArabic(dayOfWeek)'));

  // Classroom booking → round (this is the direction that was missing).
  assert.ok(classrooms.includes('FROM daqqi_rounds'), 'a hall booking must check the rounds');
  assert.ok(classrooms.includes('arabicWeekdaysForDate(start_time)'));
  assert.ok(classrooms.includes("status <> 'FINISHED'"),
    'a finished round has released its hall, as the round-to-round check already holds');
  assert.ok(classrooms.includes('SELECT id, name FROM physical_classrooms'),
    'the hall name is what a round stores, so the lookup has to return it');
});

test('neither route keeps its own private copy of the weekday map', () => {
  for (const name of ['daqqi-rounds.js', 'dokki-operations.js']) {
    const source = codeOnly(read(name));
    assert.ok(!source.includes('const ARABIC_WEEKDAY_TO_MYSQL = Object.freeze({'),
      `${name} must take the map from lib/daqqiSchedule.js`);
    assert.ok(source.includes("require('../lib/daqqiSchedule')"), `${name} imports it`);
  }
});
