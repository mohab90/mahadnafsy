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
//
// The YouTube half of this used to be an inline postMessage listener in the
// dashboard player. It moved into VideoSurface, which is the component that
// owns the frame — and has to own it, because a player stripped of YouTube's
// own controls needs something driving it. The rules did not change; where to
// look for them did, so this file now reads both sides of the seam.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT = path.join(__dirname, '..', '..', 'client');
const read = rel => fs.readFileSync(path.join(CLIENT, rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

const player = codeOnly(read('components/UserDashboardVideoPlayer.tsx'));
const surface = codeOnly(read('components/VideoSurface.tsx'));

test('saveTime still needs a duration to compute a percentage', () => {
  // The premise the rest of this file rests on: without it, the call is a no-op
  // that rewrites the stored value with itself.
  assert.match(player, /const saveTime = \(lectureId: string, seconds: number, duration\?: number\)/);
  assert.match(player, /duration && duration > 0[\s\S]{0,80}Math\.round\(\(seconds \/ duration\) \* 100\)/);
});

test('both players report the duration they are playing', () => {
  // Native / HLS, which passes its own.
  assert.match(player, /saveTime\(selected\.id, currentTime, duration\)/);
  // YouTube, which now arrives through VideoSurface's callback.
  assert.match(player, /onTimeUpdate=\{\(currentTime, duration\) =>[\s\S]{0,120}saveTime\(selected\.id, currentTime, duration\)/);
  // And the callback is only ever called with one, so the fallback above
  // cannot be reached by the YouTube path.
  assert.match(surface, /onTimeUpdate\?:\s*\(currentTime: number, duration: number\) => void/);
  assert.match(surface, /if \(known > 0\) onTimeUpdate\?\.\(info\.currentTime, known\)/,
    'a time with no duration must not be reported at all');
});

test('both players mark a lecture complete at the same point', () => {
  const rule = /currentTime \/ duration >= 0\.8/g;
  assert.equal((player.match(rule) || []).length, 2,
    'the 80% rule has to hold for the native branch and the YouTube one');
  // Ending the video still completes it, for a learner who watches it out.
  assert.match(player, /onEnded=\{\(\) => markLectureComplete\(selected\.id\)\}/);
  assert.match(surface, /playerState === ENDED\) onEnded\?\.\(\)/);
  assert.match(surface, /const ENDED = 0/, 'YouTube says 0 for ended; a wrong constant is a silent no-op');
});

test('the YouTube bridge still only trusts YouTube', () => {
  // The origin check is what makes reading these messages safe at all. It moved
  // with the listener.
  assert.match(surface, /const YT_ORIGINS = \['https:\/\/www\.youtube\.com', 'https:\/\/www\.youtube-nocookie\.com'\]/);
  assert.match(surface, /if \(!YT_ORIGINS\.includes\(event\.origin\)\) return;/);
});

test('the dashboard player no longer listens for itself', () => {
  // Two listeners on the same messages would save every lecture's progress
  // twice. saveTime buckets its writes, so it would not have been visible.
  assert.ok(!/addEventListener\('message'/.test(player),
    'VideoSurface owns the bridge now; a second listener here is a duplicate');
});
