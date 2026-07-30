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
