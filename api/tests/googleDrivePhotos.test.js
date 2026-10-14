'use strict';

// «رفع الصور مربوط بجوجل درايف … ويبقى على السيستم لينك الصورة فقط» (13 Oct 2026).
// A service account uploads into one shared folder; the client's file keeps the link.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const drive = require('../lib/googleDrive');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'uploader@mahad.iam.gserviceaccount.com',
  // As an .env line holds it: one line, \n escaped.
  GOOGLE_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
  GOOGLE_DRIVE_FOLDER_ID: '1AbCdEfGhIjKlMnOpQrStUv',
};

function fakeGoogle({ uploadStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
    }
    return uploadStatus === 200
      ? { ok: true, status: 200, json: async () => ({ id: 'FILE12345678', name: 'x.jpg', webViewLink: 'https://drive.google.com/file/d/FILE12345678/view?usp=drivesdk' }) }
      : { ok: false, status: uploadStatus, json: async () => ({ error: { message: 'File not found: folder' } }) };
  };
  return { calls, fetchImpl };
}

test('Drive counts as set up only with the account, a real key and a folder', () => {
  assert.equal(drive.isConfigured(env), true);
  assert.equal(drive.isConfigured({ ...env, GOOGLE_DRIVE_FOLDER_ID: '' }), false);
  assert.equal(drive.isConfigured({ ...env, GOOGLE_PRIVATE_KEY: 'not a key' }), false);
  assert.equal(drive.isConfigured({}), false);
});

test('the service account signs a JWT Google can verify, and the picture goes into the shared folder', async () => {
  drive.resetTokenCache();
  const google = fakeGoogle();
  const file = await drive.uploadImage(
    { name: 'صورة-شخصية-أحمد-2026-10-13.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]) },
    { env, fetchImpl: google.fetchImpl, now: () => 1_800_000_000_000 });
  assert.equal(file.url, 'https://drive.google.com/file/d/FILE12345678/view?usp=drivesdk');

  const [tokenCall, uploadCall] = google.calls;
  const assertion = new URLSearchParams(tokenCall.options.body).get('assertion');
  const [header, claims, signature] = assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.iss, env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url')),
    'the assertion is signed with the private key');

  assert.match(uploadCall.url, /uploadType=multipart/);
  assert.equal(uploadCall.options.headers.Authorization, 'Bearer tok-1');
  const body = uploadCall.options.body.toString('latin1');
  assert.match(body, new RegExp(`"parents":\\["${env.GOOGLE_DRIVE_FOLDER_ID}"\\]`));
  assert.match(body, /Content-Type: image\/jpeg/);
});

test('the token is reused until it nears its end', async () => {
  drive.resetTokenCache();
  const google = fakeGoogle();
  const options = { env, fetchImpl: google.fetchImpl, now: () => 1_800_000_000_000 };
  const picture = { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) };
  await drive.uploadImage(picture, options);
  await drive.uploadImage(picture, options);
  assert.equal(google.calls.filter(call => call.url.includes('oauth2')).length, 1);
});

test('a refused upload says so with its code and status; an unset Drive refuses before any request', async () => {
  drive.resetTokenCache();
  const google = fakeGoogle({ uploadStatus: 404 });
  await assert.rejects(
    drive.uploadImage({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1]) }, { env, fetchImpl: google.fetchImpl }),
    error => error.code === 'DRIVE_UPLOAD_FAILED' && error.status === 404);
  const none = fakeGoogle();
  await assert.rejects(
    drive.uploadImage({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1]) }, { env: {}, fetchImpl: none.fetchImpl }),
    error => error.code === 'DRIVE_NOT_CONFIGURED');
  assert.equal(none.calls.length, 0);
});

test('only a Drive file link is ever stored', () => {
  assert.equal(drive.cleanDriveLink('https://drive.google.com/file/d/FILE12345678/view?usp=drivesdk'), 'https://drive.google.com/file/d/FILE12345678/view?usp=drivesdk');
  for (const bad of ['http://drive.google.com/file/d/FILE12345678/view', 'https://evil.example/file/d/FILE12345678/view', 'javascript:alert(1)', 'https://drive.google.com/file/d/x', '', null]) {
    assert.equal(drive.cleanDriveLink(bad), null, String(bad));
  }
  assert.deepEqual(drive.cleanPhotoLinks({ personal: 'https://evil.example/x', id: 'https://drive.google.com/open?id=ABCDEFGHIJKL' }),
    { personal: null, id: 'https://drive.google.com/open?id=ABCDEFGHIJKL' });
  assert.deepEqual(drive.cleanPhotoLinks(undefined), { personal: null, id: null });
});

test('the payment keeps only the links, on the client, and the dialog asks for what the item needs', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /cleanPhotoLinks\(payment\.photos\)/);
  assert.match(route, /UPDATE subscribers SET personal_photo_url = COALESCE\(\?, personal_photo_url\), id_photo_url = COALESCE\(\?, id_photo_url\)/);
  assert.match(read('api/migrations/278_v26_client_photo_links.sql'), /ADD COLUMN IF NOT EXISTS personal_photo_url[\s\S]*ADD COLUMN IF NOT EXISTS id_photo_url/);
  const senders = read('admin/lib/mysqlapi.ts');
  assert.equal((senders.match(/takePendingPhotos\(\)/g) || []).length, 2, 'both mysqlapi payment calls carry the links');
  assert.match(read('admin/lib/createClientWithPayment.ts'), /takePendingPhotos\(\)/);
  assert.match(read('admin/pages/dashboard/tabs/ClientDbTab.tsx'), /'رابط الصورة الشخصية', 'رابط صورة الهوية'\]/);
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx'), /\.\.\.PICTURE_HEADERS\]/);
});

// ── what the dialog asks for, and what the upload route answers ──────────────
function loadNeeds() {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { photoNeeds } from './lib/photoNeeds';", resolveDir: path.join(__dirname, '../../admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.photoNeeds;
}
const photoNeeds = loadNeeds();
const labels = { american_board: 'شهادة البورد الأمريكي', doc: 'توثيق الشهادات', ain_shams: 'شهادة جامعة عين شمس' };
const labelOf = type => labels[type] || String(type || '');

test('a board certificate and a carnet need the personal photo, documentation needs the identity', { skip: !photoNeeds }, () => {
  assert.deepEqual(photoNeeds({ paymentType: 'certificate', certType: 'american_board', extraItems: [] }, labelOf), { personal: 'required', id: null });
  assert.deepEqual(photoNeeds({ paymentType: 'carneh', certType: '', extraItems: [] }, labelOf), { personal: 'required', id: null });
  assert.deepEqual(photoNeeds({ paymentType: 'certificate', certType: 'doc', extraItems: [] }, labelOf), { personal: null, id: 'required' });
  assert.deepEqual(photoNeeds({ paymentType: 'certificate', certType: 'ain_shams', extraItems: [] }, labelOf), { personal: 'optional', id: null });
  assert.deepEqual(photoNeeds({ paymentType: 'course', certType: '', extraItems: [] }, labelOf), { personal: null, id: null });
});

test('an added row asks too, but only when it carries an amount', { skip: !photoNeeds }, () => {
  const draft = extra => ({ paymentType: 'course', certType: '', extraItems: extra });
  assert.deepEqual(photoNeeds(draft([{ type: 'carneh', label: '', amount: '100' }]), labelOf), { personal: 'required', id: null });
  assert.deepEqual(photoNeeds(draft([{ type: 'carneh', label: '', amount: '' }]), labelOf), { personal: null, id: null });
  assert.deepEqual(photoNeeds(draft([
    { type: 'certificate', label: '', amount: '300', certType: 'doc' },
    { type: 'certificate', label: '', amount: '300', certType: 'american_board' },
  ]), labelOf), { personal: 'required', id: 'required' });
});

test('the upload route refuses a bad kind, says Drive is not set up, and refuses a non-image', async () => {
  const stubModule = (rel, exports) => { const file = require.resolve(rel); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
  const pass = (req, res, next) => next();
  stubModule('../lib/db', { pool: { query: async () => [[]] } });
  stubModule('../lib/logger', { error() {}, warn() {}, info() {} });
  stubModule('../middleware/auth', { requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass });
  delete require.cache[require.resolve('../routes/misc/drivePhotos')];
  const router = require('../routes/misc/drivePhotos');
  const handlerOf = (method, route) => {
    const layer = router.stack.find(l => l.route && l.route.path === route && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (handler, req) => {
    const out = {};
    await handler({ tenantId: 't1', body: {}, ...req }, { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } });
    return out;
  };
  const upload = handlerOf('post', '/api/admin/drive/photo');
  const savedEnv = { ...process.env };
  try {
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    assert.equal((await call(upload, { body: { kind: 'nope' } })).status, 400);
    const unset = await call(upload, { body: { kind: 'personal', dataUrl: 'data:image/png;base64,AAAA' } });
    assert.equal(unset.status, 503);
    assert.equal(unset.body.code, 'DRIVE_NOT_CONFIGURED');
    assert.match(unset.body.error, /GOOGLE_DRIVE_FOLDER_ID/);
    Object.assign(process.env, env);
    const bad = await call(upload, { body: { kind: 'id', dataUrl: 'data:text/html;base64,PGI+' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'PHOTO_INVALID');
    assert.equal((await call(handlerOf('get', '/api/admin/drive/status'), {}).catch(() => ({}))).status, undefined);
  } finally {
    for (const key of Object.keys(env)) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  }
});
