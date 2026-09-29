'use strict';

// «ليه الصورة مش بتظهر؟» — the event picture was saved cut off: the body
// sanitizer cuts every string at 50,000 characters, and a picture travelled as
// a data URL. And «اي صورة تترفع علي السيستم لازم يتم تصغيرها لاقصي درجة
// وتظهر كويس».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('a picture is the one long string the sanitizer lets through', () => {
  const { sanitizeBody } = require('../middleware/sanitize');
  const picture = `data:image/jpeg;base64,${'A'.repeat(400_000)}`;
  const req = { body: { imageUrl: picture, notes: 'x'.repeat(60_000), nested: { proof_image: picture } } };
  sanitizeBody(req, {}, () => {});
  assert.equal(req.body.imageUrl.length, picture.length, 'kept whole — cut, it was a broken image');
  assert.equal(req.body.nested.proof_image.length, picture.length);
  assert.equal(req.body.notes.length, 50_000, 'other text is still capped');
});

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional here */ }

test('pictures the site shows are stored as small WebP files, once each', { skip: !sharp }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  process.env.MEDIA_IMAGE_DIR = dir;
  delete require.cache[require.resolve('../lib/mediaImages')];
  const { mediaImagePath, storeMediaImage } = require('../lib/mediaImages');
  try {
    const raw = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
    const png = await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } })
      .withMetadata({ exif: { IFD0: { Copyright: 'camera' } } }).jpeg().toBuffer();
    const dataUrl = `data:image/jpeg;base64,${png.toString('base64')}`;

    const first = await storeMediaImage({ tenantId: 'tenant-default', dataUrl, kind: 'cover' });
    assert.match(first.url, /^\/api\/media\/tenant-default\/[a-f0-9]{24}\.webp$/);
    const file = mediaImagePath('tenant-default', first.url.split('/').pop());
    const meta = await sharp(fs.readFileSync(file)).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 1280, 'fits the kind');
    assert.equal(meta.exif, undefined, 'what the camera wrote is dropped');

    const again = await storeMediaImage({ tenantId: 'tenant-default', dataUrl, kind: 'cover' });
    assert.equal(again.url, first.url, 'the same picture is one file');
    const photo = await storeMediaImage({ tenantId: 'tenant-default', dataUrl, kind: 'photo' });
    assert.equal((await sharp(fs.readFileSync(mediaImagePath('tenant-default', photo.url.split('/').pop()))).metadata()).width, 640);

    await assert.rejects(storeMediaImage({ tenantId: 'tenant-default', dataUrl: 'data:image/png;base64,aGVsbG8=', kind: 'cover' }),
      error => error.statusCode === 400);
    assert.equal(mediaImagePath('tenant-default', '../../etc/passwd'), null);
    assert.equal(mediaImagePath('../x', 'a'.repeat(24) + '.webp'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.MEDIA_IMAGE_DIR;
  }
});

// The browser half, bundled and run against a stand-in canvas whose output
// grows with its size and quality the way a real encoder's does.
// A fresh copy per browser: it remembers whether the browser encodes WebP.
let bundle = null;
try {
  const esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild'));
  bundle = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'shared/imageCompress.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  }).outputFiles[0].text;
} catch { /* esbuild missing: skipped below */ }
function loadCompress() {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle)(module, module.exports, require);
  return module.exports;
}

function fakeBrowser({ width, height, webp }) {
  const drawn = [];
  const canvas = () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect: () => drawn.push('fill'), clearRect: () => {}, drawImage: () => {}, set fillStyle(_) {} }),
    toDataURL(type, quality = 0.92) {
      const encoded = type === 'image/webp' && webp ? 'image/webp' : type === 'image/webp' ? 'image/png' : type;
      const bytes = Math.round(this.width * this.height * quality * 0.35);
      drawn.push({ type: encoded, width: this.width, quality });
      return `data:${encoded};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
    },
  });
  global.document = { createElement: () => canvas() };
  global.URL.createObjectURL = () => 'blob:x';
  global.URL.revokeObjectURL = () => {};
  global.Image = class { set src(_) { this.naturalWidth = width; this.naturalHeight = height; setTimeout(() => this.onload(), 0); } };
  return drawn;
}

test('an upload is scaled and re-encoded until it fits, and never refused for being large', { skip: !bundle }, async () => {
  const file = { size: 6_000_000, type: 'image/jpeg' };
  let drawn = fakeBrowser({ width: 4000, height: 3000, webp: true });
  let compress = loadCompress();
  const cover = await compress.compressImage(file, 'cover');
  assert.ok(cover.startsWith('data:image/webp;base64,'), cover.slice(0, 30));
  assert.ok(compress.dataUrlByteLength(cover) <= compress.IMAGE_KINDS.cover.maxBytes);
  assert.ok(drawn.filter(step => step.type).every(step => step.width <= 1280), 'never wider than the kind');

  // Safari cannot encode WebP: JPEG, on white, so a transparent PNG is not black.
  drawn = fakeBrowser({ width: 900, height: 900, webp: false });
  compress = loadCompress();
  const receipt = await compress.compressImage({ size: 800_000, type: 'image/png' }, 'receipt');
  assert.ok(receipt.startsWith('data:image/jpeg;base64,'), receipt.slice(0, 30));
  assert.ok(drawn.includes('fill'));

  // A picture no quality fits is made smaller rather than refused.
  fakeBrowser({ width: 8000, height: 8000, webp: true });
  const avatar = await compress.compressImage(file, 'avatar');
  assert.ok(avatar.length > 0);
  await assert.rejects(compress.compressImage({ size: 20_000_000, type: 'image/jpeg' }, 'cover'), /image-source-too-large/);
  delete global.document; delete global.Image;
});

test('every upload screen compresses, and the public pictures go to files', () => {
  for (const file of ['admin/pages/dashboard/CommunityEventsAdmin.tsx', 'admin/pages/dashboard/tabs/CoursesTab.tsx',
    'admin/pages/dashboard/tabs/courses/CourseInstructorsPanel.tsx', 'admin/pages/dashboard/dashboardGallery.ts']) {
    assert.match(read(file), /uploadImage\(file, '(cover|gallery|certificate|photo)'\)/, file);
  }
  assert.match(read('admin/pages/staff-profile/StaffSettingsPanel.tsx'), /compressImage\(file, 'avatar'\)/);
  for (const file of ['client/pages/Checkout.tsx', 'client/pages/UserDashboard.tsx']) {
    const source = read(file);
    assert.match(source, /compressImage\(file, 'receipt'\)/, file);
    assert.doesNotMatch(source, /readAsDataURL\(file\)/, `${file}: the receipt went up uncompressed`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'admin/lib/imageBudget.ts')), 'one compressor, in shared/');
  assert.match(read('api/lib/registerRoutes.js'), /'\.\.\/routes\/media'/);
  // /community/events is a folder once events are prerendered; it needs its own page.
  assert.match(read('tools/generate-seo.mjs'), /writePage\('\/community\/events', render\(shell/);
});
