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
const { codeOnly } = require('./support/repo');

const CLIENT = path.join(__dirname, '..', '..', 'client');
const read = rel => fs.readFileSync(path.join(CLIENT, rel), 'utf8');


const player = codeOnly(read('components/UserDashboardVideoPlayer.tsx'));
const surface = codeOnly(read('components/VideoSurface.tsx'));





test('both players mark a lecture complete at the same point', () => {
  const rule = /currentTime \/ duration >= 0\.8/g;
  assert.equal((player.match(rule) || []).length, 2,
    'the 80% rule has to hold for the native branch and the YouTube one');
  // Ending the video still completes it, for a learner who watches it out.
  assert.match(player, /onEnded=\{\(\) => markLectureComplete\(selected\.id\)\}/);
  assert.match(surface, /playerState === ENDED\) onEnded\?\.\(\)/);
  assert.match(surface, /const ENDED = 0/, 'YouTube says 0 for ended; a wrong constant is a silent no-op');
});




