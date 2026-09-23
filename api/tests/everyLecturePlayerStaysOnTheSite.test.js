'use strict';

// «عاوز اقفل اني يظهر علامه اليوتيوب في اسفل الشاشه او انه يضغط علي عنوان
// الفيديو ويتنقل منه لليوتيوب» — no logo in the corner, and no title to click
// through to YouTube with.
//
// Three rounds of this. First five hand-written copies of the embed URL at five
// different levels of protection, which became one builder. Then the parameters
// that were meant to remove the branding — modestbranding and showinfo — turned
// out to have been retired by YouTube in 2023 and 2018: they sat in the URL
// doing nothing while the logo and the clickable title stayed exactly where
// they were. Strips of dark gradient were laid over the corners to hide them,
// which cost a slice of the picture, covered only the two places somebody had
// thought of, and moved whenever YouTube moved its furniture.
//
// What actually works, checked on the live site against a real lecture before
// any of it was written:
//
//   controls=0            no control bar, so no logo in it and no title bar
//   pointer-events: none  the frame cannot be clicked at all, so whatever
//                         YouTube draws next is not reachable either
//   our own controls      which is what makes the first two affordable
//
// The rule this file enforces is the third one as much as the first two: taking
// YouTube's controls away without replacing them leaves a video nobody can
// pause, and the next person to find that would put controls=1 back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Comments are blanked before anything is asserted against them: the comment
// explaining why controls=0 matters contains the string controls=0, and an
// assertion its own explanation can trip is not an assertion about the code.
//
// The `[^:]` matters and is not decoration. The usual form of this helper cuts
// each line at the first `//`, which is inside every `https://` — so a file
// embedding `https://www.youtube.com/embed/…` would be read as `https:` and the
// scan below would report it clean. That is the exact offender this file exists
// to catch, passing because the scanner blinded itself.
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
const SURFACE = 'client/components/VideoSurface.tsx';

test('exactly one file builds a YouTube embed URL', () => {
  const offenders = clientFiles()
    .filter(file => file.name !== BUILDER && /youtube(?:-nocookie)?\.com\/embed\//.test(file.code))
    .map(file => file.name);
  assert.deepEqual(offenders, [],
    'these write their own embed URL, which is how five players ended up with five different levels of protection');
});

test('exactly one component puts a YouTube frame on the page', () => {
  // Every player goes through VideoSurface. A raw <iframe> somewhere else is a
  // player with YouTube's controls still on it, however careful its URL is.
  const offenders = clientFiles()
    .filter(file => file.name !== SURFACE)
    .filter(file => /<iframe[\s\S]{0,400}(youtubeEmbedUrl|youtube)/.test(file.code))
    .map(file => file.name);
  assert.deepEqual(offenders, []);
});

test('nothing reaches youtube.com — only the nocookie host', () => {
  const builder = codeOnly(read(BUILDER));
  const hosts = [...new Set(builder.match(/https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//g) || [])];
  assert.deepEqual(hosts, ['https://www.youtube-nocookie.com/embed/'],
    'youtube.com writes a viewing history against the customer\'s Google account and carries the links out');
});

test('the embed asks for no controls at all', () => {
  const builder = codeOnly(read(BUILDER));
  assert.match(builder, /'controls=0'/,
    'controls=1 brings back the bar the logo sits in, and the title bar above it');
  for (const param of ['rel=0', 'fs=0', 'disablekb=1', 'iv_load_policy=3']) {
    assert.ok(builder.includes(param), `the builder is missing ${param}`);
  }
});

test('the frame cannot be clicked, and cannot be tabbed into', () => {
  const surface = codeOnly(read(SURFACE));
  const frame = surface.slice(surface.indexOf('<iframe'), surface.indexOf('/>', surface.indexOf('<iframe')));
  assert.match(frame, /pointerEvents:\s*'none'/,
    'this is the guarantee: whatever YouTube draws, it is not reachable');
  assert.match(frame, /tabIndex=\{-1\}/, 'nor reachable by keyboard');
  assert.ok(!/allowFullScreen/.test(frame),
    'YouTube\'s own fullscreen chrome puts the title back on screen — the wrapper goes fullscreen instead');
  assert.match(frame, /referrerPolicy="strict-origin-when-cross-origin"/,
    'stripping the referrer entirely makes YouTube answer Error 153 instead of the video');
});

test('and the controls it takes away are given back', () => {
  // Without this the rule above is unaffordable and somebody will undo it.
  const surface = codeOnly(read(SURFACE));
  for (const [what, needle] of [
    ['play/pause', /'playVideo'|'pauseVideo'/],
    ['seek', /'seekTo'/],
    ['volume', /'setVolume'/],
    ['speed', /'setPlaybackRate'/],
    ['fullscreen', /requestFullscreen/],
  ]) assert.match(surface, needle, `the player has no ${what}`);
  assert.match(surface, /event: 'listening'/,
    'without the handshake YouTube sends no state back and none of the above can be driven');
});

test('the poster covers the branding that survives controls=0', () => {
  // The red play button on the poster and the wordmark on the loading screen
  // are the two pieces controls=0 does not remove. Neither is a link, but both
  // are YouTube on a page that is not supposed to have any.
  const surface = read(SURFACE);
  assert.match(surface, /!started &&/, 'the poster stays up until the video is actually playing');
  assert.match(surface, /state === BUFFERING/, 'and a spinner of ours covers the loading screen after that');
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

test('one place knows how the lecture URL is stored', () => {
  // vite-env.d.ts declares the variable's type and holds no key.
  const offenders = clientFiles()
    .filter(file => ![BUILDER, 'client/vite-env.d.ts'].includes(file.name))
    .filter(file => /VITE_VIDEO_KEY|deobfV2/.test(file.code))
    .map(file => file.name);
  assert.deepEqual(offenders, [],
    'a second copy of the key is a second thing to forget when it is rotated');
});

test('the lecture URL never reaches the page in the clear', () => {
  const media = read('api/lib/mediaAccess.js');
  assert.match(media, /enc:/, 'stored obfuscated');
  assert.match(media, /youtube-nocookie\.com\/embed\//, 'and resolved to nocookie when it is played');
});

test('the viewer can make it bigger, on a browser that refuses the API too', () => {
  // «العميل بيقدر يكبر الشاشه». Element.requestFullscreen does not exist on iOS
  // Safari — there only a <video> may go fullscreen, and this is an iframe — so
  // a button wired to that alone does nothing at all on an iPhone. It can also
  // be refused on desktop, and Chrome refuses it by *throwing synchronously*:
  // the first version of this fallback used .catch() only and never ran, which
  // is how the refusal was found.
  const surface = codeOnly(read(SURFACE));
  const handler = surface.slice(surface.indexOf('const toggleFullscreen'), surface.indexOf('const onKeyDown'));
  assert.match(handler, /typeof request !== 'function'[\s\S]{0,60}setExpanded\(true\)/,
    'a browser with no Element.requestFullscreen must still get bigger');
  assert.match(handler, /try \{[\s\S]{0,300}catch \{ setExpanded\(true\); \}/,
    'a synchronous refusal is not a rejected promise, and .catch() never sees it');
  assert.match(handler, /result\.catch\(\(\) => setExpanded\(true\)\)/,
    'and an asynchronous one is not a throw');
  // The fallback has to keep what fullscreen was protecting.
  assert.match(surface, /expanded \? 'fixed inset-0 z-\[9999\]/, 'it fills the viewport');
  assert.match(surface, /event\.key === 'Escape' && expanded/, 'and Escape gets back out of it');
});
