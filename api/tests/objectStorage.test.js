'use strict';

// lib/objectStorage.js: which driver the environment selects (local unless
// told otherwise, and never a half-configured bucket), and the bucket client
// against a fake S3 that checks signatures and body hashes as S3 does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createS3Client, localPathForKey, objectUrl, parseKey, storageConfig, writesToBucket,
} = require('../lib/objectStorage');
const { startFakeS3 } = require('./_fakeS3');

const credentials = { accessKeyId: 'test-key', secretAccessKey: 'test-secret-0123456789' };
const fullEnv = {
  STORAGE_DRIVER: 's3',
  STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  STORAGE_S3_BUCKET: 'mahad-media',
  STORAGE_S3_ACCESS_KEY_ID: credentials.accessKeyId,
  STORAGE_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
};

test('no storage settings at all is the local disk, exactly as before', () => {
  const config = storageConfig({});
  assert.equal(config.driver, 'local');
  assert.equal(config.s3, null);
  assert.deepEqual(config.problems, []);
  assert.equal(writesToBucket({}), false);
});

test('STORAGE_DRIVER=s3 with a complete bucket writes to the bucket', () => {
  const config = storageConfig(fullEnv);
  assert.equal(config.driver, 's3');
  assert.equal(config.s3.region, 'auto');
  assert.equal(config.s3.forcePathStyle, true);
  assert.equal(config.s3.videoUrlTtlSeconds, 4 * 60 * 60);
  assert.equal(writesToBucket(fullEnv), true);
});

test('a half-configured bucket stays on the disk and says what is missing', () => {
  const config = storageConfig({ ...fullEnv, STORAGE_S3_SECRET_ACCESS_KEY: '' });
  assert.equal(config.driver, 'local');
  assert.equal(config.s3, null);
  assert.match(config.problems.join(';'), /STORAGE_S3_SECRET_ACCESS_KEY/);
  assert.equal(storageConfig({ STORAGE_DRIVER: 'nfs' }).driver, 'local');
  assert.match(storageConfig({ ...fullEnv, STORAGE_PUBLIC_BASE_URL: 'http://cdn.x' }).problems.join(), /https/);
});

test('a rollback to local keeps the bucket readable for files already moved', () => {
  const config = storageConfig({ ...fullEnv, STORAGE_DRIVER: 'local' });
  assert.equal(config.driver, 'local');
  assert.ok(config.s3, 'reads of moved files still need the bucket');
});

test('object addresses: path style by default, virtual host on request, prefix for a shared bucket', () => {
  const pathStyle = storageConfig({ ...fullEnv, STORAGE_S3_PREFIX: 'prod' }).s3;
  assert.equal(objectUrl(pathStyle, 'videos/t1/media-a.mp4'), 'https://acct.r2.cloudflarestorage.com/mahad-media/prod/videos/t1/media-a.mp4');
  const virtual = storageConfig({ ...fullEnv, STORAGE_S3_FORCE_PATH_STYLE: 'false' }).s3;
  assert.equal(objectUrl(virtual, 'videos/t1/media-a.mp4'), 'https://mahad-media.acct.r2.cloudflarestorage.com/videos/t1/media-a.mp4');
});

test('keys are only the three known kinds, one tenant segment, one plain file name', () => {
  assert.deepEqual(parseKey('videos/tenant-a/media-1.mp4'), { prefix: 'videos', kind: 'video', tenantId: 'tenant-a', filename: 'media-1.mp4' });
  assert.equal(parseKey('videos/tenant-a/../x.mp4'), null);
  assert.equal(parseKey('videos/tenant-a/.hidden'), null);
  assert.equal(parseKey('etc/tenant-a/passwd'), null);
  assert.equal(localPathForKey('proofs/tenant-a/pp-1.png'), null, 'a proof lives in its row, not a file');
  assert.ok(localPathForKey('videos/tenant-a/media-1.mp4').endsWith(path.join('tenant-a', 'media-1.mp4')));
});

test('the client streams a file up, verifies it, reads it back and deletes it', async () => {
  const s3 = await startFakeS3({ credentials });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-s3-client-'));
  try {
    const config = storageConfig({ ...fullEnv, STORAGE_S3_ENDPOINT: s3.endpoint, STORAGE_S3_BUCKET: s3.bucket }).s3;
    const client = createS3Client(config);
    const file = path.join(dir, 'video.mp4');
    const bytes = crypto.randomBytes(300 * 1024);
    fs.writeFileSync(file, bytes);
    const put = await client.put('videos/t1/media-a.mp4', { filePath: file, contentType: 'video/mp4' });
    assert.equal(put.size, bytes.length);
    assert.equal(put.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await client.head('videos/t1/media-a.mp4'), { size: bytes.length, sha256: put.sha256, contentType: 'video/mp4' });
    assert.equal(await client.head('videos/t1/missing.mp4'), null);

    const back = path.join(dir, 'back.mp4');
    assert.deepEqual(await client.download('videos/t1/media-a.mp4', back), { size: bytes.length, sha256: put.sha256 });
    assert.ok(fs.readFileSync(back).equals(bytes));

    const small = await client.put('proofs/t1/pp-1.png', { buffer: Buffer.from('png-bytes'), contentType: 'image/png' });
    assert.equal(small.size, 9);
    assert.equal((await client.getBuffer('proofs/t1/pp-1.png')).buffer.toString(), 'png-bytes');
    await assert.rejects(client.getBuffer('proofs/t1/pp-1.png', { maxBytes: 4 }), /larger than/);

    await client.remove('videos/t1/media-a.mp4');
    assert.equal(await client.head('videos/t1/media-a.mp4'), null);

    const url = new URL(client.presignGet('videos/t1/media-b.mp4', 600));
    assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
    assert.ok(url.pathname.endsWith('/test-bucket/videos/t1/media-b.mp4'));
  } finally {
    await s3.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a store refusal surfaces as an error with its status, not a silent success', async () => {
  const s3 = await startFakeS3({ credentials });
  try {
    const config = storageConfig({ ...fullEnv, STORAGE_S3_ENDPOINT: s3.endpoint, STORAGE_S3_BUCKET: s3.bucket }).s3;
    s3.faults.failPuts = 1;
    await assert.rejects(createS3Client(config).put('media/t1/a.webp', { buffer: Buffer.from('x') }), error => error.status === 503 && /SlowDown/.test(error.message));
    const wrongKey = createS3Client({ ...config, credentials: { ...credentials, secretAccessKey: 'wrong-secret-000000' } });
    await assert.rejects(wrongKey.head('media/t1/a.webp'), /403/);
  } finally { await s3.close(); }
});
