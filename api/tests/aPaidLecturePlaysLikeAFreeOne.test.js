'use strict';

// «اول فيديو بس اللى بيشتغل وباقي الفيديوهات مش شغاله».
//
// The free preview lecture carries its URL in the public catalogue, so the
// browser builds the embed itself and gets the chromeless player. Every lecture
// after it is paid, and a paid lecture's URL is never sent to the browser at
// all — it comes back as a signed ticket, /api/media/lectures/<id>?ticket=…,
// which the server redirects to YouTube. So the URL the iframe actually loads
// for those is built here, by playableRedirect, and it was building
// «?controls=1&rel=0&playsinline=1».
//
// Two things followed, and they are the bug report word for word. controls=1
// put YouTube's control bar back — the logo in the corner and the clickable
// title, on exactly the lectures people pay for. And without enablejsapi the
// player accepts no commands over postMessage, so the new play button pressed
// against a frame that could not hear it: the first video played and the rest
// did nothing.
//
// The lesson is the one this codebase keeps relearning: there were two places
// that build an embed URL, not one. The client-side builder was consolidated
// from five copies into one and this second path — on the other side of an HTTP
// redirect, in another language — was not among them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { playableRedirect } = require('../lib/mediaAccess');

const encode = url => {
  const key = 'mhd-nafsy-2026';
  return `enc:${Buffer.from(url.split('').map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join(''), 'binary').toString('base64')}`;
};

test('the redirect hands back a player with no YouTube controls on it', () => {
  const target = playableRedirect(encode('https://youtu.be/abc123'));
  assert.match(target, /^https:\/\/www\.youtube-nocookie\.com\/embed\/abc123\?/);
  assert.ok(target.includes('controls=0'),
    'controls=1 is the logo and the clickable title, on the lectures people paid for');
  assert.ok(target.includes('enablejsapi=1'),
    'without this the player hears no commands, and the play button does nothing');
  for (const param of ['rel=0', 'fs=0', 'disablekb=1', 'iv_load_policy=3', 'playsinline=1']) {
    assert.ok(target.includes(param), `the redirect is missing ${param}`);
  }
});

test('the two builders agree, because they are two', () => {
  // One is TypeScript in the browser, the other CommonJS behind a redirect, so
  // they cannot be the same function. They can be held to the same list.
  const client = fs.readFileSync(path.join(ROOT, 'client/lib/lectureVideo.ts'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'api/lib/mediaAccess.js'), 'utf8');
  const listOf = source => (source.match(/'(?:autoplay|controls|modestbranding|rel|showinfo|iv_load_policy|color|playsinline|disablekb|fs)=[^']*'/g) || [])
    .map(entry => entry.replace(/'/g, '').split('=')[0])
    .sort();
  const clientParams = listOf(client);
  const serverParams = listOf(server);
  assert.ok(clientParams.length > 5, 'the client builder should still name its parameters');
  assert.deepEqual(serverParams, clientParams,
    'a parameter added on one side and not the other is how the paid lectures ended up different');
});

test('a resume position and autoplay survive the redirect', () => {
  // They used to be dropped: youtubeEmbedUrl returns a ticket URL untouched,
  // so the start position the dashboard passes never reached YouTube and a
  // paid lecture always restarted from zero.
  const target = playableRedirect(encode('https://youtu.be/abc123'), { start: 125, autoplay: true });
  assert.ok(target.includes('start=125'), 'the resume position');
  assert.ok(target.includes('autoplay=1'), 'and whether it should start on its own');
  const plain = playableRedirect(encode('https://youtu.be/abc123'));
  assert.ok(!plain.includes('start='), 'and neither is invented when the caller did not ask');
  assert.ok(plain.includes('autoplay=0'));
});

test('the media route passes them through from the request', () => {
  const route = fs.readFileSync(path.join(ROOT, 'api/routes/lms.js'), 'utf8');
  assert.match(route, /playableRedirect\(lecture\?\.video_url, \{/,
    'the route has to forward what the player asked for');
  assert.match(route, /start: Number\(req\.query\.start\)/);
  assert.match(route, /autoplay: req\.query\.autoplay === '1'/);
});

test('and the browser asks for them on the ticket URL', () => {
  const surface = fs.readFileSync(path.join(ROOT, 'client/components/VideoSurface.tsx'), 'utf8');
  assert.match(surface, /kind=embed/,
    'a ticket URL is the one case where the parameters have to travel as a query, not be built in');
});

test('nothing else is rewritten into a YouTube embed', () => {
  // A non-YouTube URL — an mp4, an HLS manifest — must come back untouched, or
  // the native player gets a YouTube page.
  const mp4 = 'https://cdn.example.com/lecture.mp4';
  assert.equal(playableRedirect(encode(mp4)), mp4);
  assert.equal(playableRedirect('javascript:alert(1)'), '', 'and a script URL is not a video');
});
