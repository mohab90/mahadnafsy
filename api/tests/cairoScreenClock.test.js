'use strict';
// The time of day, on the institute's clock.
//
// shared/cairoDate.ts answered which *day* it is in Cairo and had nothing for
// what *time* it is, so every screen that showed one printed the stored value
// as it came — and stored instants are UTC. A call logged at 12:45 in Cairo was
// stored as 09:45, correctly, and then shown as 09:45: three hours early in
// summer, two in winter. The same gap ran the other way through every
// <input type="datetime-local">: it was filled with the UTC clock, and whatever
// a person typed into it was stored as though it were UTC. A live stream booked
// for 20:00 was advertised to students as 23:00, and a WhatsApp campaign set for
// 20:00 would have gone out at 23:00.
//
// The rule: storage is UTC, a screen shows Cairo, and an input speaks Cairo and
// is converted back on the way out. These run the real helpers — Node strips the
// types itself (module.stripTypeScriptTypes, Node 22.13+), so nothing here
// depends on the admin's build tools being installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let clock;
test.before(async () => {
  const { stripTypeScriptTypes } = require('node:module');
  // Fail loudly rather than skip: a test that quietly does not run is how the
  // admin e2e suite spent months reporting green without executing.
  assert.equal(typeof stripTypeScriptTypes, 'function',
    'this Node cannot strip TypeScript; the gate needs Node 22.13 or newer');
  const js = stripTypeScriptTypes(read('shared/cairoDate.ts'));
  clock = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
});

test('a stored instant is shown on the Cairo clock, in both halves of the year', () => {
  assert.equal(clock.cairoDateTime('2026-09-24 09:45'), '2026-09-24 12:45', 'summer is +3');
  assert.equal(clock.cairoDateTime('2026-01-15 09:45'), '2026-01-15 11:45', 'winter is +2');
  assert.equal(clock.cairoDateTime('2026-09-24T09:45:00.000Z'), '2026-09-24 12:45',
    'an ISO instant from the API reads the same as the zoneless string the browser writes');
  assert.equal(clock.cairoDateTime('2026-09-23 22:30'), '2026-09-24 01:30',
    'and a late UTC evening is already tomorrow in Cairo');
});

test('a missing time shows as nothing, not as now', () => {
  assert.equal(clock.cairoDateTime(''), '');
  assert.equal(clock.cairoDateTime(null), '');
  // cairoDateOnly() answers "today" when given nothing, which is right for "what
  // day is it" and wrong for a row with no date. cairoDay() is the one a list uses.
  assert.equal(clock.cairoDay(undefined), '');
  assert.equal(clock.cairoDay('2026-09-23 22:30'), '2026-09-24');
});

test('what a person types in Cairo is stored in UTC', () => {
  assert.equal(clock.cairoInputToUtc('2026-09-24T20:00'), '2026-09-24 17:00', 'summer');
  assert.equal(clock.cairoInputToUtc('2026-01-15T20:00'), '2026-01-15 18:00', 'winter');
  assert.equal(clock.cairoInputToUtc('not a time'), '');
  assert.equal(clock.cairoDateTimeInput('2026-09-24 17:00'), '2026-09-24T20:00',
    'and an input is filled with the Cairo clock, in the shape the input takes');
});

test('an input round-trips across both daylight-saving changes', () => {
  // Every half hour across the 2026 spring and autumn changes. Anything shown
  // can be typed back and shows the same clock; a stored instant comes back
  // exactly, except in the one hour autumn repeats, where a zoneless input
  // cannot say which occurrence was meant and the first is taken.
  for (const [from, to] of [['2026-04-22T00:00Z', '2026-04-27T00:00Z'], ['2026-10-27T00:00Z', '2026-11-01T00:00Z']]) {
    for (let t = Date.parse(from); t < Date.parse(to); t += 30 * 60000) {
      const stored = new Date(t).toISOString().slice(0, 16).replace('T', ' ');
      const shown = clock.cairoDateTimeInput(stored);
      const back = clock.cairoInputToUtc(shown);
      assert.equal(clock.cairoDateTimeInput(back), shown, `${stored} shown as ${shown} typed back as ${back}`);
      if (back !== stored) {
        assert.ok(Date.parse(`${back}Z`) === t - 3600000,
          `${stored} came back as ${back}: only the repeated autumn hour may differ, and by exactly its first occurrence`);
      }
    }
  }
  // The spring change skips 00:00-00:59; a time typed inside it moves forward.
  assert.equal(clock.cairoDateTime(clock.cairoInputToUtc('2026-04-24T00:30')), '2026-04-24 01:30');
});

test('the screens that print a stored time go through the Cairo clock', () => {
  const renders = {
    'admin/pages/dashboard/tabs/LeadTable.tsx': /\{cairoDateTime\(c\.date\)\}/,
    'admin/pages/dashboard/tabs/leads/QuickEditPanel.tsx': /\{cairoDateTime\(c\.date\)\}/,
    'admin/pages/StaffProfile.tsx': /\{cairoDateTime\(c\.date\)\}/,
    'admin/pages/unified-client/UnifiedClientCommunicationsPanel.tsx': /\{cairoDateTime\(comm\.date\)\}/,
    'admin/pages/dashboard/tabs/LiveStreamsTab.tsx': /\{cairoDateTime\(ls\.scheduledAt\)\}/,
    'client/components/student-dashboard/StudentLiveStreamsTab.tsx': /cairoDateTime\(value\)/,
  };
  for (const [file, pattern] of Object.entries(renders)) {
    assert.match(read(file), pattern, `${file} prints a stored time without converting it`);
  }
});

test('every datetime input that is saved converts back to UTC', () => {
  const saves = {
    'admin/pages/dashboard/tabs/LeadTable.tsx': /date: cairoInputToUtc\(contactDraft\.date\)/,
    'admin/pages/unified-client/useUnifiedClientCommunications.ts': /date: cairoInputToUtc\(draft\.date\)/,
    'admin/pages/dashboard/tabs/LiveStreamsTab.tsx': /scheduledAt: cairoInputToUtc\(lsDraft\.scheduledAt\)/,
    'admin/pages/dashboard/tabs/messaging/WhatsappCampaignsPanel.tsx': /cairoInputToUtc\(draft\.scheduledAt\)/,
    'admin/pages/dashboard/tabs/courses/CourseCohortsPanel.tsx': /cairoInputToUtc\(draft\.startsAt\)[\s\S]*cairoInputToUtc\(draft\.endsAt\)/,
    'admin/pages/dashboard/tabs/GrowthOpsSection.tsx': /cairoInputToUtc\(bookingStart\)[\s\S]*cairoInputToUtc\(bookingEnd\)/,
  };
  for (const [file, pattern] of Object.entries(saves)) {
    assert.match(read(file), pattern, `${file} stores a typed Cairo time as though it were UTC`);
  }
  // The shape the old saves took: the input's own value with the T swapped out.
  for (const file of Object.keys(saves)) {
    assert.doesNotMatch(read(file), /\.date\.replace\('T', ' '\)/, `${file} still saves the raw input value`);
  }
});
