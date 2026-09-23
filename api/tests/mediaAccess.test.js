'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.MEDIA_SIGNING_SECRET = 'unit-test-media-signing-secret-32-bytes';
const {
  createMediaTicket,
  decodeStoredUrl,
  mediaKind,
  playableRedirect,
  verifyMediaTicket,
} = require('../lib/mediaAccess');

test('media tickets are signed, lecture-bound and reject tampering', () => {
  const ticket = createMediaTicket({ tenantId: 't1', subscriberId: 's1', lectureId: 'l1' });
  assert.deepEqual(
    { ...verifyMediaTicket(ticket, 'l1'), exp: true },
    { tenantId: 't1', subscriberId: 's1', lectureId: 'l1', exp: true }
  );
  assert.equal(verifyMediaTicket(ticket, 'l2'), null);
  assert.equal(verifyMediaTicket(`${ticket}x`, 'l1'), null);
});

test('stored video obfuscation is decoded server-side and classified', () => {
  const key = 'mhd-nafsy-2026';
  const source = 'https://youtu.be/abc123';
  const encoded = `enc:${Buffer.from(source.split('').map((character, index) =>
    String.fromCharCode(character.charCodeAt(0) ^ key.charCodeAt(index % key.length))).join(''), 'binary').toString('base64')}`;
  assert.equal(decodeStoredUrl(encoded), source);
  assert.equal(mediaKind(encoded), 'embed');
  assert.match(playableRedirect(encoded), /youtube-nocookie\.com\/embed\/abc123/);
  assert.equal(playableRedirect('javascript:alert(1)'), '');
});

test('lecture access returns an expiring ticket and redemption rechecks active entitlement', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'lms.js'), 'utf8');
  assert.match(route, /createMediaTicket\(\{/);
  assert.match(route, /expires_in:\s*300/);
  assert.match(route, /verifyMediaTicket\(req\.query\.ticket/);
  assert.match(route, /e\.status='active'/);
  assert.doesNotMatch(route, /accessible:\s*true,\s*video_url:\s*lecture\.video_url/);
});

test('only real media files are classified for <video>; hosted players are framed', () => {
  assert.equal(mediaKind('https://cdn.example.com/lesson-2.mp4'), 'video');
  assert.equal(mediaKind('/uploads/videos/t1/lesson.webm'), 'video');
  assert.equal(mediaKind('https://cdn.example.com/stream/index.m3u8'), 'hls');
  // These are web pages. Classifying them as 'video' put them in a <video>
  // element, which is why every gated lecture after the free first one was blank.
  assert.equal(mediaKind('https://drive.google.com/file/d/abc/preview'), 'embed');
  assert.equal(mediaKind('https://vimeo.com/123456'), 'embed');
  assert.equal(mediaKind('https://iframe.mediadelivery.net/embed/1/xyz'), 'embed');
  assert.equal(playableRedirect('https://vimeo.com/123456'), 'https://player.vimeo.com/video/123456');
  assert.equal(playableRedirect('https://drive.google.com/file/d/abc_1/view?usp=sharing'), 'https://drive.google.com/file/d/abc_1/preview');
  assert.equal(playableRedirect('https://player.vimeo.com/video/9'), 'https://player.vimeo.com/video/9');
});
