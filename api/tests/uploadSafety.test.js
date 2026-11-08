'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  detectMediaSignature,
  inspectProofImageDataUrl,
  resolveTenantMediaPath,
} = require('../lib/uploadSafety');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('upload signatures are verified from bytes, not browser MIME claims', () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
  assert.equal(detectMediaSignature(mp4), 'iso-bmff');
  assert.equal(detectMediaSignature(Buffer.from('<script>alert(1)</script>')), null);

  const png = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')}`;
  assert.equal(inspectProofImageDataUrl(png).declaredMime, 'image/png');
  const spoofed = `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`;
  assert.throws(() => inspectProofImageDataUrl(spoofed), /signature/);
  assert.throws(() => inspectProofImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), /Only JPEG/);
});

test('tenant media paths cannot escape or cross tenant storage', () => {
  const name = 'media-11111111-1111-4111-8111-111111111111.mp4';
  assert.ok(resolveTenantMediaPath(`/uploads/videos/tenant-a/${name}`, 'tenant-a'));
  assert.equal(resolveTenantMediaPath(`/uploads/videos/tenant-b/${name}`, 'tenant-a'), null);
  assert.equal(resolveTenantMediaPath('/uploads/videos/tenant-a/..%2Fsecret.mp4', 'tenant-a'), null);
});



// 11 Oct 2026: videos can live outside the release directory, so a deploy's
// rollback copy and a rollback itself leave them alone.
test('VIDEO_UPLOAD_DIR moves videos outside the release directory', () => {
  const file = require.resolve('../lib/uploadSafety');
  const previous = process.env.VIDEO_UPLOAD_DIR;
  try {
    delete require.cache[file];
    process.env.VIDEO_UPLOAD_DIR = path.join(require('node:os').tmpdir(), 'mahad-videos');
    const outside = require('../lib/uploadSafety');
    assert.equal(outside.VIDEO_ROOT, path.resolve(process.env.VIDEO_UPLOAD_DIR));
    assert.equal(outside.VIDEO_ROOT_IN_RELEASE, false);
    delete require.cache[file];
    delete process.env.VIDEO_UPLOAD_DIR;
    assert.equal(require('../lib/uploadSafety').VIDEO_ROOT_IN_RELEASE, true);
  } finally {
    if (previous == null) delete process.env.VIDEO_UPLOAD_DIR; else process.env.VIDEO_UPLOAD_DIR = previous;
    delete require.cache[file];
  }
});
