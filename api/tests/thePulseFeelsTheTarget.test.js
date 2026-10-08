'use strict';

// «إحصائياتي» for a rep (8 Oct 2026): «تفرح … وتزعل لما التارجيت يكون بعيد
// تشجعه كل شوية». The mood comes from the money in hand against where it should
// be by today; every message is about the rep's own numbers.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
function load() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin', 'lib', 'salesMood.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const mood = load();
const base = { target: 60000, dayOfMonth: 15, daysInMonth: 30, todayBookings: 1, monthBookings: 8, streak: 1, hour: 11 };

test('the face follows the pace, not the month alone', { skip: !mood }, () => {
  assert.equal(mood.moodOf({ ...base, revenue: 61000 }), 'champion');
  assert.equal(mood.moodOf({ ...base, revenue: 40000 }), 'fire', '67% at mid-month');
  assert.equal(mood.moodOf({ ...base, revenue: 30000 }), 'good', 'exactly on pace');
  assert.equal(mood.moodOf({ ...base, revenue: 20000 }), 'worried');
  assert.equal(mood.moodOf({ ...base, revenue: 8000 }), 'sad');
  assert.equal(mood.moodOf({ ...base, target: 0, revenue: 8000 }), 'no_target');
});

test('what is left is spread over the days left, today included', { skip: !mood }, () => {
  const progress = mood.progressOf({ revenue: 20000, target: 60000, dayOfMonth: 15, daysInMonth: 30 });
  assert.equal(progress.left, 40000);
  assert.equal(progress.daysLeft, 16);
  assert.equal(progress.perDay, 2500);
  assert.equal(progress.expectedByToday, 30000);
});

test('a sad month says how far, and a quiet afternoon is nudged', { skip: !mood }, () => {
  const lines = mood.messagesFor('sad', { ...base, revenue: 8000, todayBookings: 0, hour: 15 });
  assert.ok(lines.some(line => line.includes('52,000')), 'what is left, in pounds');
  assert.ok(lines.some(line => line.includes('لسه مفيش حجز النهارده')));
  assert.ok(!mood.messagesFor('sad', { ...base, revenue: 8000, todayBookings: 0, hour: 10 }).some(line => line.includes('لسه مفيش حجز النهارده')), 'not at ten in the morning');
});

test('each milestone of the target is reached once, and the badges follow', { skip: !mood }, () => {
  assert.deepEqual(mood.milestonesReached(29000, 60000), []);
  assert.deepEqual(mood.milestonesReached(46000, 60000), [50, 75]);
  assert.deepEqual(mood.milestonesReached(60000, 60000), [50, 75, 100]);
  const earned = mood.badgesFor({ ...base, revenue: 46000, todayBookings: 3, streak: 4 }).filter(badge => badge.earned).map(badge => badge.key);
  assert.deepEqual(earned, ['first_today', 'hat_trick', 'streak3', 'half', 'three_q']);
});
