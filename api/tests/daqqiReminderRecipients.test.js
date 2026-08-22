'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Loads scheduledJobHandlers with lib/whatsapp stubbed, so the reminder job can
// be driven end to end without a network or a database.
function loadHandlersWithWhatsAppStub() {
  const sent = [];
  const whatsappPath = require.resolve('../lib/whatsapp');
  const handlersPath = require.resolve('../lib/scheduledJobHandlers');
  const previous = require.cache[whatsappPath];
  require.cache[whatsappPath] = {
    id: whatsappPath,
    filename: whatsappPath,
    loaded: true,
    exports: { sendWhatsApp: async (phone, message, opts) => { sent.push({ phone, message, opts }); return { ok: true }; } },
  };
  delete require.cache[handlersPath];
  const { createScheduledJobHandlers } = require('../lib/scheduledJobHandlers');
  const restore = () => {
    if (previous) require.cache[whatsappPath] = previous; else delete require.cache[whatsappPath];
    delete require.cache[handlersPath];
  };
  return { createScheduledJobHandlers, sent, restore };
}

// Stands in for MySQL for the one query under test: it applies exactly those
// recipient guards the SQL actually declares. Drop a guard from the query and
// the corresponding fixture row flows through, which is what makes this a
// regression test rather than a restatement of the fixture.
function poolFor(subscribers, roundStartIso) {
  const issued = [];
  return {
    issued,
    query: async (sql, params) => {
      issued.push(sql);
      if (/FROM daqqi_rounds/.test(sql)) {
        return [[{
          id: 'round-1', tenant_id: 'tenant-a', code: 'D1', time_slot: 'EVENING',
          start_date: roundStartIso, current_lecture: 0, postponed_weeks_json: '[]',
          course_title: 'دقي',
        }]];
      }
      if (/FROM daqqi_attendees/.test(sql)) {
        assert.deepEqual(params, [['round-1']]);
        const rows = subscribers.filter(row => (
          (!/s\.deleted_at IS NULL/.test(sql) || row.deleted_at === null)
          && (!/s\.is_active=1/.test(sql) || row.is_active === 1)
          && (!/s\.is_unsubscribed=0/.test(sql) || row.is_unsubscribed === 0)
        ));
        return [rows.map(row => ({ round_id: 'round-1', tenant_id: 'tenant-a', phone: row.phone, name: row.name }))];
      }
      return [[]];
    },
  };
}

const FIXTURES = [
  { name: 'active', phone: '+201000000001', deleted_at: null, is_active: 1, is_unsubscribed: 0 },
  { name: 'archived', phone: '+201000000002', deleted_at: '2026-01-01 00:00:00', is_active: 0, is_unsubscribed: 0 },
  { name: 'privacy-erased', phone: '+201000000003', deleted_at: null, is_active: 1, is_unsubscribed: 1 },
  { name: 'deactivated-only', phone: '+201000000004', deleted_at: null, is_active: 0, is_unsubscribed: 0 },
];

test('Dokki round reminders reach only clients who are still contactable', async () => {
  const { createScheduledJobHandlers, sent, restore } = loadHandlersWithWhatsAppStub();
  try {
    const pool = poolFor(FIXTURES, new Date(Date.now() + 24 * 3600000).toISOString());
    const jobs = createScheduledJobHandlers({ pool, logger: { info() {}, warn() {} } });
    await jobs.daqqiSessionReminder();
    assert.deepEqual(sent.map(item => item.phone), ['+201000000001']);
    assert.equal(sent[0].opts.tenantId, 'tenant-a');
  } finally {
    restore();
  }
});

test('archiving or erasing a client silences reminders without erasing them from the round', () => {
  const handlers = read('lib/scheduledJobHandlers.js');
  const reminder = handlers.slice(
    handlers.indexOf('async function daqqiSessionReminder('),
    handlers.indexOf('async function leadRetargeting(')
  );
  assert.ok(reminder, 'daqqiSessionReminder must still be a discrete handler');
  assert.match(reminder, /FROM daqqi_attendees da[\s\S]*s\.deleted_at IS NULL AND s\.is_active=1 AND s\.is_unsubscribed=0/);

  // privacyService is the only writer of is_unsubscribed, so the guard above is
  // what actually keeps privacy-erased clients out of the send list.
  assert.match(read('lib/privacyService.js'), /UPDATE subscribers SET[\s\S]*is_unsubscribed=1/);
  // ...and the archive route is the only writer of the is_active=0 + deleted_at pair.
  assert.match(read('routes/core/catalog.js'), /UPDATE subscribers SET is_active=0, deleted_at=NOW\(\)/);
});

test('the reminder recipient filter does not leak into attendance history or counts', () => {
  const attendees = read('lib/daqqiAttendees.js');
  const route = read('routes/daqqi-rounds.js');
  // getDaqqiAttendees feeds per-round listings and attendance counts; narrowing
  // it by contactability would silently drop clients out of the history.
  assert.doesNotMatch(attendees, /is_unsubscribed/);
  assert.doesNotMatch(attendees, /s\.is_active/);
  assert.doesNotMatch(route, /is_unsubscribed/);
  assert.doesNotMatch(route, /s\.is_active/);
  // The attendance event itself stays keyed on the round, never on the client's
  // contactability.
  assert.match(route, /INSERT INTO daqqi_attendance_events/);
});
