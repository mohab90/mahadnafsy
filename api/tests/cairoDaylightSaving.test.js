'use strict';
// «اتاكد كويس ان تاريخ والوقت متطابق مع مصر بالظبط» (12 Oct 2026).
//
// Egypt brought daylight saving back in 2023: UTC+3 from the last Friday of
// April (the clocks jump from 00:00 to 01:00) to the last Thursday of October
// (24:00 becomes 23:00 again, so that hour happens twice). In 2026 that is
// Friday 24 April and Thursday 29 October. Every helper that turns a UTC instant
// into the institute's day or hour, or back, is run here across both nights and
// across Cairo's midnight, where the UTC date is still yesterday. None may
// assume a fixed +2 or +3.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dates = require('../lib/dates');

const {
  cairoToday, cairoClock, cairoOffsetMinutes, cairoDayStartUtc, cairoDayBoundsUtc,
  cairoDayOf, cairoMonthStart, msUntilCairoTime, sqlCairoDayStartUtc, sqlCairoDayEndUtc,
  sqlCairoWall, zonedDateTimeParts, addDaysToDateOnly,
} = dates;

const at = iso => new Date(iso);
const utcMs = mysql => Date.parse(`${mysql.replace(' ', 'T')}Z`);

test('the offset is read from the zone database, and it moves on the right nights', () => {
  // The spring change: Thursday 23 April 21:59:59 UTC is 23:59:59 at +2, and the
  // next second is 01:00 on Friday at +3.
  assert.equal(cairoOffsetMinutes(at('2026-04-23T21:59:59Z')), 120);
  assert.equal(cairoOffsetMinutes(at('2026-04-23T22:00:00Z')), 180);
  // The autumn change: Thursday 29 October 20:59:59 UTC is 23:59:59 at +3, and
  // the next second is 23:00 again, at +2.
  assert.equal(cairoOffsetMinutes(at('2026-10-29T20:59:59Z')), 180);
  assert.equal(cairoOffsetMinutes(at('2026-10-29T21:00:00Z')), 120);
  // Today, 12 October 2026, is still summer.
  assert.equal(cairoOffsetMinutes(at('2026-10-12T09:00:00Z')), 180);
});

test('cairoClock across the spring night: no 00:xx on Friday 24 April', () => {
  assert.deepEqual(cairoClock(at('2026-04-23T21:30:00Z')), { date: '2026-04-23', time: '23:30', minutes: 1410 });
  assert.deepEqual(cairoClock(at('2026-04-23T22:00:00Z')), { date: '2026-04-24', time: '01:00', minutes: 60 });
  assert.deepEqual(cairoClock(at('2026-04-24T06:00:00Z')), { date: '2026-04-24', time: '09:00', minutes: 540 });
});

test('cairoClock across the autumn night: 23:xx on Thursday 29 October happens twice', () => {
  assert.deepEqual(cairoClock(at('2026-10-29T20:30:00Z')), { date: '2026-10-29', time: '23:30', minutes: 1410 });
  assert.deepEqual(cairoClock(at('2026-10-29T21:30:00Z')), { date: '2026-10-29', time: '23:30', minutes: 1410 });
  assert.deepEqual(cairoClock(at('2026-10-29T22:00:00Z')), { date: '2026-10-30', time: '00:00', minutes: 0 });
  // A winter morning: nine in Cairo is 07:00 UTC, no longer 06:00.
  assert.deepEqual(cairoClock(at('2026-11-02T07:00:00Z')), { date: '2026-11-02', time: '09:00', minutes: 540 });
});

test('cairoToday turns over at Cairo midnight, in both seasons', () => {
  // Summer (today): Cairo's midnight is 21:00 UTC.
  assert.equal(cairoToday(at('2026-10-12T20:59:59Z')), '2026-10-12');
  assert.equal(cairoToday(at('2026-10-12T21:00:00Z')), '2026-10-13');
  // Winter: 22:00 UTC.
  assert.equal(cairoToday(at('2026-11-12T21:59:59Z')), '2026-11-12');
  assert.equal(cairoToday(at('2026-11-12T22:00:00Z')), '2026-11-13');
  // The first of a month, before 03:00 Cairo, is still last month in UTC.
  assert.equal(cairoToday(at('2026-09-30T22:30:00Z')), '2026-10-01');
  assert.deepEqual(dates.cairoYearMonth(at('2026-09-30T22:30:00Z')), { year: 2026, month: 10 });
  assert.equal(cairoMonthStart(0, at('2026-09-30T22:30:00Z')), '2026-10-01');
  assert.equal(cairoMonthStart(1, at('2026-01-01T00:30:00Z')), '2025-12-01');
});

test('cairoDayStartUtc: each day begins at its own Cairo midnight, including the two that are not 24 hours', () => {
  const start = day => cairoDayStartUtc(day);
  // Plain summer and winter days.
  assert.equal(start('2026-10-12'), '2026-10-11 21:00:00');
  assert.equal(start('2026-11-12'), '2026-11-11 22:00:00');
  // Friday 24 April began at 22:00 UTC: the clocks went from 00:00 straight to
  // 01:00. Reading the offset at noon alone answered 21:00, an hour that was
  // still Thursday 23:00 in Cairo.
  assert.equal(start('2026-04-23'), '2026-04-22 22:00:00');
  assert.equal(start('2026-04-24'), '2026-04-23 22:00:00');
  assert.equal(start('2026-04-25'), '2026-04-24 21:00:00');
  assert.equal(cairoToday(new Date(utcMs(start('2026-04-24')))), '2026-04-24');
  assert.equal(cairoToday(new Date(utcMs(start('2026-04-24')) - 1000)), '2026-04-23');
  // Thursday 29 October runs 25 hours; Friday begins at 22:00 UTC.
  assert.equal(start('2026-10-29'), '2026-10-28 21:00:00');
  assert.equal(start('2026-10-30'), '2026-10-29 22:00:00');
  const hours = day => (utcMs(start(addDaysToDateOnly(day, 1))) - utcMs(start(day))) / 3600000;
  assert.equal(hours('2026-04-24'), 23);
  assert.equal(hours('2026-10-29'), 25);
  assert.equal(hours('2026-10-12'), 24);
  // Every day of 2026: the start is the first second Cairo calls that day.
  for (let day = '2026-01-01'; day <= '2026-12-31'; day = addDaysToDateOnly(day, 1)) {
    const s = utcMs(start(day));
    assert.equal(cairoToday(new Date(s)), day, `${day} starts inside itself`);
    assert.notEqual(cairoToday(new Date(s - 1000)), day, `${day} starts no later than it should`);
  }
});

test('the SQL forms of today\'s start and end are tomorrow\'s start, not start + 24h', () => {
  assert.equal(sqlCairoDayStartUtc(at('2026-10-29T12:00:00Z')), "'2026-10-28 21:00:00'");
  assert.equal(sqlCairoDayEndUtc(at('2026-10-29T12:00:00Z')), "'2026-10-29 22:00:00'");
  assert.equal(sqlCairoDayEndUtc(at('2026-04-24T12:00:00Z')), "'2026-04-24 21:00:00'");
  // Just after midnight in Cairo, "today" is already the new day.
  assert.equal(sqlCairoDayStartUtc(at('2026-10-12T21:30:00Z')), "'2026-10-12 21:00:00'");
});

test('cairoDayBoundsUtc gives a half-open range that holds a whole Cairo day or range', () => {
  assert.deepEqual(cairoDayBoundsUtc('2026-10-12'), ['2026-10-11 21:00:00', '2026-10-12 21:00:00']);
  assert.deepEqual(cairoDayBoundsUtc('2026-10-01', '2026-11-30'), ['2026-09-30 21:00:00', '2026-11-30 22:00:00']);
  assert.deepEqual(cairoDayBoundsUtc('2026-10-29T00:00:00'), ['2026-10-28 21:00:00', '2026-10-29 22:00:00']);
  // A payment taken at 01:00 Cairo on the 12th (22:00 UTC on the 11th) is in
  // the 12th's range — UTC-midnight bounds put it in the 11th's.
  const [from, to] = cairoDayBoundsUtc('2026-10-12');
  const paidAt = '2026-10-11 22:00:00';
  assert.ok(paidAt >= from && paidAt < to);
  // A picked day stored at UTC midnight stays inside its own Cairo day.
  assert.ok('2026-10-12 00:00:00' >= from && '2026-10-12 00:00:00' < to);
  for (const bad of ['', 'yesterday', '2026-02-31', "2026-10-12' OR 1=1"]) {
    assert.throws(() => cairoDayBoundsUtc(bad), error => error.statusCode === 400, `refuses ${bad}`);
  }
});

test('cairoDayOf: a date stays a date, an instant lands on its Cairo day', () => {
  assert.equal(cairoDayOf('2026-10-12'), '2026-10-12');
  assert.equal(cairoDayOf('2026-10-11T22:30:00Z'), '2026-10-12');
  assert.equal(cairoDayOf('2026-10-11T22:30:00.000Z'), '2026-10-12');
  assert.equal(cairoDayOf('2026-10-11 22:30:00'), '2026-10-12', 'a zoneless stored value is UTC');
  assert.equal(cairoDayOf(at('2026-10-12T00:00:00Z')), '2026-10-12', 'a DATETIME picked day');
  assert.equal(cairoDayOf(at('2026-11-12T21:30:00Z')), '2026-11-12', 'winter: 23:30 Cairo');
  for (const blank of [null, undefined, '', '0000-00-00 00:00:00', 'garbage', '2026-02-31']) {
    assert.equal(cairoDayOf(blank), '');
  }
});

test('msUntilCairoTime arms the daily jobs at Cairo\'s 07:00, across both changes', () => {
  const next = (hour, nowIso) => {
    const now = at(nowIso);
    return cairoClock(new Date(now.getTime() + msUntilCairoTime(hour, 0, now)));
  };
  // Today, summer: 07:00 Cairo is 04:00 UTC. It was 07:00 UTC (10:00 Cairo).
  assert.deepEqual(next(7, '2026-10-12T03:00:00Z'), { date: '2026-10-12', time: '07:00', minutes: 420 });
  assert.deepEqual(next(7, '2026-10-12T05:00:00Z'), { date: '2026-10-13', time: '07:00', minutes: 420 });
  // Armed on Thursday 29 October in summer, it fires on Friday in winter.
  assert.deepEqual(next(7, '2026-10-29T12:00:00Z'), { date: '2026-10-30', time: '07:00', minutes: 420 });
  // And inside the repeated hour.
  assert.deepEqual(next(8, '2026-10-29T21:30:00Z'), { date: '2026-10-30', time: '08:00', minutes: 480 });
  // Armed on Thursday 23 April in winter, it fires on the shortened Friday.
  assert.deepEqual(next(9, '2026-04-23T12:00:00Z'), { date: '2026-04-24', time: '09:00', minutes: 540 });
});

test('sqlCairoWall: the summers it inlines are exactly the zone database\'s', () => {
  const sql = sqlCairoWall('l.created_at', at('2026-10-12T09:00:00Z'));
  assert.match(sql, /^\(l\.created_at \+ INTERVAL \(CASE (WHEN l\.created_at >= '[\d: -]+' AND l\.created_at < '[\d: -]+' THEN 180 ?)+ ELSE 120 END\) MINUTE\)$/);
  const summers = [...sql.matchAll(/>= '([^']+)' AND l\.created_at < '([^']+)'/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(summers.find(([from]) => from.startsWith('2026')), ['2026-04-23 22:00:00', '2026-10-29 21:00:00']);
  // Evaluate the CASE the way MariaDB will, every 20 minutes through 2023-2027,
  // and compare with Intl.
  const wall = instant => {
    const stamp = new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
    const summer = summers.some(([from, to]) => stamp >= from && stamp < to);
    return new Date(instant + (summer ? 180 : 120) * 60000).toISOString().slice(0, 16);
  };
  for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2028, 0, 1); t += 20 * 60000) {
    const p = zonedDateTimeParts(new Date(t));
    const expected = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    if (wall(t) !== expected) assert.fail(`${new Date(t).toISOString()}: SQL would say ${wall(t)}, Cairo says ${expected}`);
  }
  assert.throws(() => sqlCairoWall('created_at); DROP TABLE x; --'), /refusing/);
});

test('the Dokki reminder goes out by day on Cairo\'s calendar, never at night', async () => {
  const outboxPath = require.resolve('../lib/outbox');
  const handlersPath = require.resolve('../lib/scheduledJobHandlers');
  const previous = require.cache[outboxPath];
  const sent = [];
  require.cache[outboxPath] = { id: outboxPath, filename: outboxPath, loaded: true,
    exports: { enqueue: async message => { sent.push(message.dedupeKey); return 'id'; } } };
  delete require.cache[handlersPath];
  try {
    const { createScheduledJobHandlers } = require('../lib/scheduledJobHandlers');
    const pool = { query: async sql => {
      if (/FROM daqqi_rounds/.test(sql)) {
        return [[{ id: 'r1', tenant_id: 't', code: 'D1', time_slot: 'EVENING', start_date: at('2026-10-13T00:00:00Z'),
          current_lecture: 0, postponed_weeks_json: '[]', course_title: 'دقي' }]];
      }
      if (/FROM daqqi_attendees/.test(sql)) return [[{ round_id: 'r1', tenant_id: 't', phone: '+201000000001', name: 'x' }]];
      return [[]];
    } };
    const jobs = createScheduledJobHandlers({ pool, logger: { info() {}, warn() {} } });
    // 01:00 and 03:00 Cairo on the 13th were when the old windows fired.
    await jobs.daqqiSessionReminder(at('2026-10-12T22:00:00Z'));
    await jobs.daqqiSessionReminder(at('2026-10-13T00:00:00Z'));
    assert.deepEqual(sent, [], 'nothing between midnight and 08:00 Cairo');
    // 11:00 the day before: not yet. 15:00 the day before: the day-before one.
    await jobs.daqqiSessionReminder(at('2026-10-12T08:00:00Z'));
    assert.deepEqual(sent, []);
    await jobs.daqqiSessionReminder(at('2026-10-12T12:00:00Z'));
    assert.deepEqual(sent, ['daqqi-reminder:r1:2026-10-13:24 ساعة:201000000001']);
    // 08:00 on the day: the same-day one.
    await jobs.daqqiSessionReminder(at('2026-10-13T05:00:00Z'));
    assert.deepEqual(sent.slice(1), ['daqqi-reminder:r1:2026-10-13:ساعتين:201000000001']);
  } finally {
    if (previous) require.cache[outboxPath] = previous; else delete require.cache[outboxPath];
    delete require.cache[handlersPath];
  }
});

test('the pool, the process and the deploy files all hold storage to UTC', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  const db = read('api/lib/db.js');
  assert.match(db, /timezone:\s*'Z'/, 'mysql2 reads and writes DATETIME as UTC');
  assert.match(db, /SET time_zone = '\+00:00'/, 'NOW() and CURRENT_TIMESTAMP are UTC in every session');
  assert.match(read('api/server.js'), /process\.env\.TZ = 'UTC';/);
  assert.match(read('deploy/systemd/mahad-api.service'), /^Environment=TZ=UTC$/m);
  assert.match(read('deploy/systemd/mahad-api-staging.service'), /^Environment=TZ=UTC$/m);
  assert.match(read('Dockerfile'), /TZ=UTC/);
});

test('no server code adds a fixed Egypt offset', () => {
  const API = path.join(__dirname, '..');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : (target.endsWith('.js') ? [target] : []);
  });
  const fixed = /getUTCHours\(\)\s*\+\s*[23]\b|[+-]\s*[23]\s*\*\s*60\s*\*\s*60\s*\*\s*1000|[+-]\s*[23]\s*\*\s*3600000|\b(7200000|10800000)\b|'\+0[23]:00'/;
  const offenders = [];
  for (const file of ['routes', 'lib'].flatMap(dir => walk(path.join(API, dir)))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/^\s*(\/\/|\*)/.test(line) && fixed.test(line)) offenders.push(`${path.relative(API, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'Egypt is +2 or +3 depending on the date; ask lib/dates.js');
});

test('the browser helpers agree, from any zone the laptop is set to', async () => {
  const { stripTypeScriptTypes } = require('node:module');
  assert.equal(typeof stripTypeScriptTypes, 'function', 'the gate needs Node 22.13 or newer');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'cairoDate.ts'), 'utf8');
  const clock = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
  // Across Cairo midnight and both 2026 changes, the day and the wall clock
  // match the server's helpers instant for instant.
  for (const iso of ['2026-10-12T20:59:00Z', '2026-10-12T21:00:00Z', '2026-04-23T21:59:00Z', '2026-04-23T22:00:00Z',
    '2026-10-29T20:59:00Z', '2026-10-29T21:00:00Z', '2026-10-29T21:59:00Z', '2026-10-29T22:00:00Z']) {
    const server = cairoClock(at(iso));
    assert.equal(clock.cairoDateOnly(iso), server.date, iso);
    assert.equal(clock.cairoDateTime(iso), `${server.date} ${server.time}`, iso);
  }
  // A stored zoneless value is UTC: 21:30 on the 29th is the second 23:30.
  assert.equal(clock.cairoDateTime('2026-10-29 21:30:00'), '2026-10-29 23:30');
  assert.equal(clock.cairoDay('2026-10-12 21:30:00'), '2026-10-13');
  // Tomorrow's follow-up and the month's pace, at 00:30 Cairo on 1 November.
  assert.equal(clock.cairoDaysAhead(1, '2026-10-31T22:30:00Z'), '2026-11-02');
  assert.deepEqual(clock.cairoMonthProgress('2026-10-31T22:30:00Z'), { dayOfMonth: 1, daysInMonth: 30 });
  assert.deepEqual(clock.cairoMonthProgress('2026-10-12T09:00:00Z'), { dayOfMonth: 12, daysInMonth: 31 });
  assert.deepEqual(clock.cairoMonthProgress('2028-02-10T09:00:00Z'), { dayOfMonth: 10, daysInMonth: 29 });
});
