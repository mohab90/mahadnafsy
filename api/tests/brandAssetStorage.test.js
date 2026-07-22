'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectedMime,
  inspectBrandAsset,
  parseDataUrl,
  resolveLocalUrl,
} = require('../lib/brandAssetStorage');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('brand asset parser enforces declared MIME and binary signature', async () => {
  const dataUrl = `data:image/png;base64,${PNG_1X1}`;
  const parsed = parseDataUrl(dataUrl, 'image/png');
  assert.equal(detectedMime(parsed.buffer), 'image/png');
  const asset = await inspectBrandAsset({ dataUrl, declaredMime: 'image/png', kind: 'logo' });
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
  await assert.rejects(
    () => inspectBrandAsset({ dataUrl, declaredMime: 'image/jpeg', kind: 'logo' }),
    /Unsupported image type/
  );
});

test('brand asset parser rejects spoofed image content and oversized payloads', async () => {
  const spoofed = `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`;
  await assert.rejects(() => inspectBrandAsset({ dataUrl: spoofed, declaredMime: 'image/png', kind: 'logo' }), /signature/);
  const oversized = `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}`;
  assert.throws(() => parseDataUrl(oversized, 'image/png'), /1MB/);
});

test('local asset URL resolver blocks traversal and external URLs', () => {
  assert.equal(resolveLocalUrl('https://example.com/logo.png'), null);
  assert.equal(resolveLocalUrl('/uploads/branding/%2e%2e/secret'), null);
  assert.match(resolveLocalUrl('/uploads/branding/tenant-default/logo-hash.png'), /branding[\\/]tenant-default[\\/]logo-hash\.png$/);
});
