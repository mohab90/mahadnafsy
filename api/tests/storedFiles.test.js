'use strict';

// Receipts and the site's pictures through the storage driver
// (lib/storedFiles.js): with no settings they are stored exactly as before; with
// STORAGE_DRIVER=s3 they go to the bucket (a fake S3 here) under the same
// addresses, a bucket outage falls back to the old place instead of losing
// the upload, and reads come back in the same shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sharp = require('sharp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef';
const MEDIA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-stored-media-'));
process.env.MEDIA_IMAGE_DIR = MEDIA_ROOT;
test.after(() => fs.rmSync(MEDIA_ROOT, { recursive: true, force: true }));

const { startFakeS3 } = require('./_fakeS3');
const { pool } = require('../lib/db');
const { readProofImage, storeProofImage } = require('../lib/storedFiles');
const { storeMediaImage } = require('../lib/mediaImages');

const credentials = { accessKeyId: 'stored-key', secretAccessKey: 'stored-secret-0123456789' };
const TENANT = 'tenant-storage-unit';
const ledger = new Map();
const queries = [];
pool.query = async (sql, params) => {
  queries.push(sql);
  if (/INSERT INTO storage_objects/.test(sql)) { ledger.set(params[0], { object_key: params[0], tenant_id: params[1], kind: params[2], location: params[3] }); return [{ affectedRows: 1 }]; }
  if (/FROM storage_objects/.test(sql)) return [ledger.has(params[0]) ? [ledger.get(params[0])] : []];
  throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
};

let s3;
const STORAGE_KEYS = ['STORAGE_DRIVER', 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_BUCKET', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY', 'STORAGE_PUBLIC_BASE_URL'];
const useLocal = () => { for (const key of STORAGE_KEYS) delete process.env[key]; };
const useBucket = (extra = {}) => {
  useLocal();
  Object.assign(process.env, {
    STORAGE_DRIVER: 's3', STORAGE_S3_ENDPOINT: s3.endpoint, STORAGE_S3_BUCKET: s3.bucket,
    STORAGE_S3_ACCESS_KEY_ID: credentials.accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey, ...extra,
  });
};
test.before(async () => { s3 = await startFakeS3({ credentials }); });
test.after(async () => { useLocal(); await s3.close(); });

const PNG = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')}`;

test('receipts: with no settings the data URL stays in the row, as before', async () => {
  useLocal(); queries.length = 0;
  assert.deepEqual(await storeProofImage({ tenantId: TENANT, proofId: 'pp-1', dataUrl: PNG }), { value: PNG, key: null });
  assert.equal(await readProofImage(PNG), PNG);
  assert.equal(queries.length, 0);
  assert.equal(s3.objects.size, 0);
});

test('receipts: with s3 the picture goes to the bucket and reads back as the same data URL', async () => {
  useBucket();
  const stored = await storeProofImage({ tenantId: TENANT, proofId: 'pp-2', dataUrl: PNG });
  assert.deepEqual(stored, { value: `storage:proofs/${TENANT}/pp-2.png`, key: `proofs/${TENANT}/pp-2.png` });
  assert.ok(s3.objects.has(`proofs/${TENANT}/pp-2.png`));
  assert.equal(ledger.get(`proofs/${TENANT}/pp-2.png`).location, 'remote');
  assert.equal(await readProofImage(stored.value), PNG);
  assert.equal(await readProofImage('storage:../../etc/passwd'), null, 'only a well-formed key is read');
});

test('receipts: a bucket that refuses keeps the data URL in the row, the upload is not lost', async () => {
  useBucket();
  s3.faults.failPuts = 1;
  assert.deepEqual(await storeProofImage({ tenantId: TENANT, proofId: 'pp-3', dataUrl: PNG }), { value: PNG, key: null });
});

async function webpDataUrl(seed) {
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: seed, g: 10, b: 20 } } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function serve(callback) {
  const express = require('express');
  const app = express();
  app.use(require('../routes/media'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('pictures: local by default, served from the disk', async () => {
  useLocal();
  const { url } = await storeMediaImage({ tenantId: TENANT, dataUrl: await webpDataUrl(1), kind: 'photo' });
  const file = url.split('/').pop();
  assert.ok(fs.existsSync(path.join(MEDIA_ROOT, TENANT, file)));
  await serve(async base => {
    const response = await fetch(`${base}${url}`, { redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
  });
});

test('pictures: with s3 they go to the bucket under the same address and redirect there', async () => {
  useBucket();
  const { url } = await storeMediaImage({ tenantId: TENANT, dataUrl: await webpDataUrl(2), kind: 'photo' });
  const file = url.split('/').pop();
  assert.match(url, new RegExp(`^/api/media/${TENANT}/[a-f0-9]{24}\\.webp$`));
  assert.ok(!fs.existsSync(path.join(MEDIA_ROOT, TENANT, file)), 'nothing written to the disk');
  assert.ok(s3.objects.has(`media/${TENANT}/${file}`));
  await serve(async base => {
    const presigned = await fetch(`${base}${url}`, { redirect: 'manual' });
    assert.equal(presigned.status, 302);
    assert.match(presigned.headers.get('location'), new RegExp(`/test-bucket/media/${TENANT}/${file}\\?X-Amz-Algorithm=`));
    useBucket({ STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.org' });
    const cdn = await fetch(`${base}${url}`, { redirect: 'manual' });
    assert.equal(cdn.headers.get('location'), `https://cdn.example.org/media/${TENANT}/${file}`);
    const missing = await fetch(`${base}/api/media/${TENANT}/${'f'.repeat(24)}.webp`, { redirect: 'manual' });
    assert.equal(missing.status, 404);
  });
});

test('pictures: a bucket outage writes to the disk and queues it for the sweep', async () => {
  useBucket();
  s3.faults.failPuts = 1;
  const { url } = await storeMediaImage({ tenantId: TENANT, dataUrl: await webpDataUrl(3), kind: 'photo' });
  const file = url.split('/').pop();
  assert.ok(fs.existsSync(path.join(MEDIA_ROOT, TENANT, file)));
  assert.equal(ledger.get(`media/${TENANT}/${file}`).location, 'local');
});
