'use strict';

// «محتاجين نوقف اي حاجه تنقل العميل علي اليوتيوب» — no player on the site may
// hand the customer a way through to YouTube, and none may offer the file.
//
// There are three players. The dashboard one was already hardened; the course
// page had the same YouTube embed with two of the parameters missing, its
// fallback <video> tag had the browser's own download button on it, and the
// bundle trailer was still on plain youtube.com with the full chrome — a
// title bar, «Watch on YouTube» and related videos at the end, each of them a
// link to the channel that lists 2,416 lectures.
//
// What this cannot do is make a public video private. Every one of these
// measures is on the page, and a lecture that is Public on YouTube is reachable
// by its id no matter what the page does. That is an owner action in YouTube
// Studio, and this file is the part that is code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Comments are blanked before anything is asserted against them. The comment
// explaining why controls=0 is forbidden contains the string controls=0, and an
// assertion its own explanation can trip is not an assertion about the code.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.split('//')[0]))
  .join('\n');

const PLAYERS = [
  ['client/components/UserDashboardVideoPlayer.tsx', 'the dashboard player'],
  ['client/pages/CourseDetails.tsx', 'the course page player'],
  ['client/pages/BundleDetails.tsx', 'the bundle trailer'],
];

test('every YouTube embed goes through nocookie, never youtube.com', () => {
  for (const [file, what] of PLAYERS) {
    const source = read(file);
    const embeds = source.match(/https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//g) || [];
    assert.ok(embeds.length > 0, `${what} should still embed something`);
    assert.deepEqual(
      [...new Set(embeds)], ['https://www.youtube-nocookie.com/embed/'],
      `${what} must not embed through youtube.com — that player carries the links out`);
  }
});

test('every embed carries the same parameters', () => {
  // rel=0 so the end screen does not offer the rest of the channel, fs=0 so
  // fullscreen does not bring YouTube's own chrome with the title in it,
  // disablekb=1 so its keyboard shortcuts cannot navigate away, and
  // modestbranding=1 for the logo.
  for (const [file, what] of PLAYERS) {
    const source = codeOnly(read(file));
    for (const param of ['rel=0', 'fs=0', 'disablekb=1', 'modestbranding=1', 'iv_load_policy=3']) {
      assert.ok(source.includes(param), `${what} is missing ${param}`);
    }
    // controls=0 makes YouTube refuse to play at all (Error 153), which is how
    // this was got wrong the first time.
    assert.ok(!/controls=0/.test(source), `${what} must keep controls=1 — controls=0 is Error 153`);
  }
});

test('no <video> tag offers the browser its own download', () => {
  for (const file of [
    'client/components/UserDashboardVideoPlayer.tsx',
    'client/pages/course-details-sections/LecturePlayerSection.tsx',
  ]) {
    const source = read(file);
    const tags = source.match(/<video\b[\s\S]*?\/>/g) || [];
    assert.ok(tags.length > 0, `${file} should still have a player`);
    for (const tag of tags) {
      assert.match(tag, /controlsList="nodownload/,
        `a <video> in ${file} still has the ⋮ download item, and the file it downloads is the lecture`);
      assert.match(tag, /disablePictureInPicture/,
        `a <video> in ${file} can be popped out of the lesson`);
      assert.match(tag, /onContextMenu=\{e => e\.preventDefault\(\)\}/,
        `a <video> in ${file} still offers «save video as» on right-click`);
    }
  }
});

test('the lecture URL never reaches the page in the clear', () => {
  // The obfuscation is not encryption and is not claimed to be; it stops the
  // URL being read straight out of the API response or the DOM, which is where
  // it used to sit.
  const media = read('api/lib/mediaAccess.js');
  assert.match(media, /enc:/, 'stored obfuscated');
  assert.match(media, /youtube-nocookie\.com\/embed\//, 'and resolved to nocookie when it is played');
});
