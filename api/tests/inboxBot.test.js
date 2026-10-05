'use strict';
/**
 * The inbox bot's rules (lib/inboxBot.js): when it answers, when it steps
 * aside, and that its instructions forbid inventing what is not written down.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bot = require('../lib/inboxBot');

const at = iso => new Date(iso);
const on = overrides => bot.normalizeSettings({ enabled: true, ...overrides });
const waiting = overrides => ({
  platform: 'whatsapp', status: 'open', last_direction: 'IN', bot_paused: 0, bot_replies: 0,
  assigned_staff_id: null, last_inbound_at: new Date(Date.now() - 60000), ...overrides,
});

test('settings are filled and clamped', () => {
  const s = bot.normalizeSettings({ mode: 'nonsense', maxReplies: 999, workingHours: { from: '25:00', days: [1, 9, 1] } });
  assert.equal(s.enabled, false);
  assert.equal(s.mode, 'always');
  assert.equal(s.maxReplies, 30);
  assert.equal(s.workingHours.from, '10:00');
  assert.deepEqual(s.workingHours.days, [1]);
  assert.ok(s.handoffKeywords.includes('موظف'));
});

test('working hours on the Cairo clock, including a window past midnight', () => {
  const day = { days: [1], from: '10:00', to: '22:00' };           // Monday
  assert.equal(bot.withinWorkingHours(day, at('2026-10-05T09:00:00Z')), true);   // Mon 12:00 Cairo
  assert.equal(bot.withinWorkingHours(day, at('2026-10-05T20:30:00Z')), false);  // Mon 23:30 Cairo
  assert.equal(bot.withinWorkingHours(day, at('2026-10-06T09:00:00Z')), false);  // Tuesday
  const night = { days: [1], from: '20:00', to: '02:00' };
  assert.equal(bot.withinWorkingHours(night, at('2026-10-05T22:30:00Z')), true);  // Tue 01:30, Monday's shift
  assert.equal(bot.withinWorkingHours(night, at('2026-10-06T00:30:00Z')), false); // Tue 03:30
});

test('it answers only where it was asked to', () => {
  assert.equal(bot.shouldAnswer(bot.normalizeSettings({}), waiting()).reason, 'disabled');
  assert.equal(bot.shouldAnswer(on(), waiting()).ok, true);
  assert.equal(bot.shouldAnswer(on(), waiting({ bot_paused: 1 })).reason, 'paused');
  assert.equal(bot.shouldAnswer(on(), waiting({ last_direction: 'OUT' })).reason, 'answered');
  assert.equal(bot.shouldAnswer(on({ platforms: { messenger: false } }), waiting({ platform: 'messenger' })).reason, 'platform_off');
  assert.equal(bot.shouldAnswer(on({ mode: 'unassigned' }), waiting({ assigned_staff_id: 'st-1' })).reason, 'assigned');
  assert.equal(bot.shouldAnswer(on({ maxReplies: 2 }), waiting({ bot_replies: 2 })).reason, 'limit');
  assert.equal(bot.shouldAnswer(on(), waiting({ last_inbound_at: new Date(Date.now() - 25 * 3600000) })).reason, 'window_closed');
  const hours = { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' };
  assert.equal(bot.shouldAnswer(on({ mode: 'off_hours', workingHours: hours }), waiting(), at('2026-10-05T09:00:00Z')).reason, 'working_hours');
});

test('asking for a person hands over without calling the AI', async () => {
  let called = false;
  const result = await bot.composeReply(
    { tenantId: 't', settings: on(), messages: [{ role: 'user', content: 'عايزة اكلم حد من خدمة العملاء لو سمحت' }] },
    { generate: async () => { called = true; return 'x'; }, db: { query: async () => [[]] } });
  assert.equal(result.handoff, true);
  assert.equal(called, false);
});

test('the instructions forbid inventing, and name the handover tag', () => {
  const prompt = bot.systemPrompt(on({ name: 'نور', instructions: 'اعرض الحجز المبكر' }), '## الكورسات\n- CBT', 'واتساب');
  assert.match(prompt, /«نور»/);
  assert.match(prompt, /ما تخترعش سعر/);
  assert.match(prompt, /\[HANDOFF\]/);
  assert.match(prompt, /اعرض الحجز المبكر/);
  assert.match(prompt, /## الكورسات/);
});
