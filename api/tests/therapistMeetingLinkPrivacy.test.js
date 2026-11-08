'use strict';

// GET /api/therapists is public, unauthenticated, and answered with
// `Cache-Control: public, max-age=600`. It returned every active slot's
// meeting_link — the real join URL for a therapy session — on the site of a
// psychology institute whose own booking page promises «سرية تامة».
//
// The booking picker only ever needed the day, the time and the slot id.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mapTherapist } = require('../lib/mappers');
const { codeOnly } = require('./support/repo');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');


const row = () => ({
  id: 't1', name: 'د. مثال', specialty: 'أسري', price_egp: 500,
  slots: [{ id: 's1', therapist_id: 't1', day: 'sunday', start_time: '18:00', end_time: '19:00',
    timezone: 'Africa/Cairo', label: '', meeting_link: 'https://meet.example.com/private-room', is_active: 1 }],
});

test('a mapped therapist withholds the join link unless the caller asks', () => {
  const [publicSlot] = mapTherapist(row()).consultationSettings.availableSlots;
  // Absent, not empty: an empty string still tells a reader the field exists
  // and invites code to start relying on it.
  assert.ok(!('meetingLink' in publicSlot), 'the public shape still carries the join link');
  // Everything the picker needs is still there.
  assert.equal(publicSlot.id, 's1');
  assert.equal(publicSlot.day, 'sunday');
  assert.equal(publicSlot.startTime, '18:00');
  assert.equal(publicSlot.isActive, true);

  const [privateSlot] = mapTherapist(row(), true).consultationSettings.availableSlots;
  assert.equal(privateSlot.meetingLink, 'https://meet.example.com/private-room');
});

test('the public route does not even select the column', () => {
  const route = codeOnly(read('api/routes/public.js'));
  const query = route.slice(route.indexOf('FROM therapist_slots') - 300, route.indexOf('FROM therapist_slots'));
  assert.ok(!query.includes('meeting_link'),
    'the public therapist feed still reads meeting_link into a publicly cached response');
});



test('mapping a list the way the route does withholds every link, not just the first', () => {
  const rows = [row(), { ...row(), id: 't2' }, { ...row(), id: 't3' }];
  const mapped = rows.map(r => mapTherapist(r));
  for (const [index, therapist] of mapped.entries()) {
    const [slot] = therapist.consultationSettings.availableSlots;
    assert.ok(!('meetingLink' in slot), `therapist at index ${index} still carries the join link`);
  }
});



test('nothing builds a join link from the public feed any more', () => {
  for (const rel of ['client/lib/consultations.ts', 'admin/lib/consultations.ts']) {
    assert.ok(!codeOnly(read(rel)).includes('buildConsultationMeetingLink'),
      `${rel} still exports the helper that read slot.meetingLink`);
  }
});
