'use strict';

// A lecture's progress must not depend on where its video happens to be hosted.
//
// saveTime computes the percentage from seconds/duration and falls back to the
// stored value when it has no duration. The native player passes its own; the
// YouTube branch did not — so a YouTube lecture sat at 0% until the video ended
// and the completion handler flipped it straight to 100. The comment inside
// saveTime records that exact defect as fixed, and it had only ever been fixed
// on the native side.
//
// The completion rule had drifted the same way: the native player marks a
// lecture done at 80%, YouTube only at the very end — so a learner who watched
// almost all of a YouTube lecture and stopped kept an unfinished course, and no
// certificate, while the same lecture hosted natively would have counted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'components', 'UserDashboardVideoPlayer.tsx'),
  'utf8'
);

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

const code = codeOnly(PLAYER);

test('saveTime still needs a duration to compute a percentage', () => {
  // The premise the rest of this file rests on: without it, the call is a no-op
  // that rewrites the stored value with itself.
  assert.match(code, /const saveTime = \(lectureId: string, seconds: number, duration\?: number\)/);
  assert.match(code, /duration && duration > 0[\s\S]{0,80}Math\.round\(\(seconds \/ duration\) \* 100\)/);
});

test('both players report the duration they are playing', () => {
  // Native / HLS.
  assert.match(code, /saveTime\(selected\.id, currentTime, duration\)/);
  // YouTube, through the postMessage bridge.
  assert.match(code, /saveTime\(selectedId, data\.info\.currentTime, duration\)/);
  assert.ok(!/saveTime\(selectedId, data\.info\.currentTime\)/.test(code),
    'the YouTube branch reports a time with no duration, so progress cannot move');
});

test('both players mark a lecture complete at the same point', () => {
  assert.match(code, /currentTime \/ duration >= 0\.8/, 'the native 80% rule is gone');
  assert.match(code, /data\.info\.currentTime \/ duration >= 0\.8/, 'YouTube still only completes at the very end');
  // Ending the video still completes it, for a learner who watches it out.
  assert.match(code, /data\?\.event === 'onStateChange' && data\?\.info === 0/);
});

test('the YouTube bridge still only trusts YouTube', () => {
  // The origin check is what makes reading these messages safe at all.
  assert.match(code, /\['https:\/\/www\.youtube\.com', 'https:\/\/www\.youtube-nocookie\.com'\]\.includes\(ev\.origin\)/);
});
