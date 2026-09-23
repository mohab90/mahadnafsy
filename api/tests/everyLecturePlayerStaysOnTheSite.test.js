'use strict';

// «محتاجين نوقف اي حاجه تنقل العميل علي اليوتيوب» — no player on the site may
// hand the customer a way through to YouTube, and none may offer the file.
//
// The site had five players and five hand-written copies of the same embed
// builder, at five different levels of protection: the dashboard and the course
// page sent the full set, the home page sent two of them, the community feed
// sent two others, and the bundle trailer was still on plain youtube.com with
// the whole chrome — a title bar, «Watch on YouTube» and related videos at the
// end, each a link to the channel that lists 2,416 lectures. The de-obfuscation
// had drifted the same way: two copies, one of which ignored VITE_VIDEO_KEY.
//
// So the rule is not "every player has the right parameters", which is a thing
// five files can disagree about. It is that there is one builder.
//
// What none of this can do is make a public video private. Every measure here
// is on the page, and a lecture that is Public on YouTube is reachable by its
// id whatever the page does. That is an owner action in YouTube Studio; this
// file is the part that is code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Comments are blanked before anything is asserted against them: the comment
// explaining why controls=0 is forbidden contains the string controls=0, and an
// assertion its own explanation can trip is not an assertion about the code.
//
// The `[^:]` matters and is not decoration. The usual form of this helper cuts
// each line at the first `//`, which is inside every `https://` — so a file
// embedding `https://www.youtube.com/embed/…` would be read as `https:` and the
// scan below would report it clean. That is the exact offender this file
// exists to catch, passing because the scanner blinded itself.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.replace(/(^|[^:])\/\/.*$/, '$1')))
  .join('\n');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => /\.tsx?$/.test(file));
}

const clientFiles = () => walk(CLIENT).map(file => ({
  name: path.relative(ROOT, file).split(path.sep).join('/'),
  code: codeOnly(fs.readFileSync(file, 'utf8')),
}));

const BUILDER = 'client/lib/lectureVideo.ts';

test('exactly one file builds a YouTube embed URL', () => {
  const offenders = clientFiles()
    .filter(file => file.name !== BUILDER && /youtube(?:-nocookie)?\.com\/embed\//.test(file.code))
    .map(file => file.name);
  assert.deepEqual(offenders, [],
    'these write their own embed URL, which is how five players ended up with five different levels of protection');
});

test('nothing reaches youtube.com — only the nocookie host', () => {
  const builder = codeOnly(read(BUILDER));
  const hosts = [...new Set(builder.match(/https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//g) || [])];
  assert.deepEqual(hosts, ['https://www.youtube-nocookie.com/embed/'],
    'youtube.com writes a viewing history against the customer\'s Google account and carries the links out');
});

test('the one builder sends every parameter that keeps the viewer here', () => {
  const builder = codeOnly(read(BUILDER));
  for (const param of ['rel=0', 'fs=0', 'disablekb=1', 'modestbranding=1', 'iv_load_policy=3', 'showinfo=0']) {
    assert.ok(builder.includes(param), `the builder is missing ${param}`);
  }
  assert.ok(builder.includes("'controls=1'"),
    'controls=0 makes YouTube refuse to play at all (Error 153) — this was got wrong once already');
});

test('only the player that needs enablejsapi asks for it', () => {
  // Without a referrer YouTube answers Error 153 to enablejsapi and refuses to
  // play, which is why the course page had it removed. The dashboard player
  // needs it to hear progress over postMessage.
  const askers = clientFiles()
    .filter(file => file.name !== BUILDER && /jsApi:\s*true/.test(file.code))
    .map(file => file.name);
  assert.deepEqual(askers, ['client/components/UserDashboardVideoPlayer.tsx']);
});

test('one place knows how the lecture URL is stored', () => {
  // vite-env.d.ts declares the variable's type and holds no key.
  const offenders = clientFiles()
    .filter(file => ![BUILDER, 'client/vite-env.d.ts'].includes(file.name))
    .filter(file => /VITE_VIDEO_KEY|deobfV2/.test(file.code))
    .map(file => file.name);
  assert.deepEqual(offenders, [],
    'a second copy of the key is a second thing to forget when it is rotated');
});

test('no <video> tag offers the browser its own download', () => {
  for (const file of [
    'client/components/UserDashboardVideoPlayer.tsx',
    'client/pages/course-details-sections/LecturePlayerSection.tsx',
  ]) {
    const tags = read(file).match(/<video\b[\s\S]*?\/>/g) || [];
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
  // URL being read straight out of the API response or the DOM.
  const media = read('api/lib/mediaAccess.js');
  assert.match(media, /enc:/, 'stored obfuscated');
  assert.match(media, /youtube-nocookie\.com\/embed\//, 'and resolved to nocookie when it is played');
});
