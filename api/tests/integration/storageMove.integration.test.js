'use strict';
/**
 * tools/move-uploads-to-storage.cjs and the storage_objects ledger
 * (lib/storageLedger.js) against a real MariaDB and a fake S3 server: files and
 * receipts are copied and verified, a second run skips them, --delete-local
 * frees the disk and turns receipts into `storage:` references that the image
 * route's reader turns back into the same data URL, and --to-local undoes it
 * all. Runs only with DB_* (or TEST_DB_*), scoped to its own tenant.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-storage-it';
const credentials = { accessKeyId: 'it-key', secretAccessKey: 'it-secret-0123456789' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const VIDEO = `media-55555555-5555-4555-8555-555555555555.mp4`;

let pool;
let s3;
let dir;
let roots;
let client;
let ledger;

async function clean() {
  await pool.query('DELETE FROM storage_objects WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM payment_proofs WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  const { startFakeS3 } = require('../_fakeS3');
  const { createS3Client, storageConfig } = require('../../lib/objectStorage');
  const { createDbLedger } = require('../../lib/storageLedger');
  await clean();
  s3 = await startFakeS3({ credentials });
  client = createS3Client(storageConfig({
    STORAGE_S3_ENDPOINT: s3.endpoint, STORAGE_S3_BUCKET: s3.bucket,
    STORAGE_S3_ACCESS_KEY_ID: credentials.accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  }).s3);
  ledger = createDbLedger(pool);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-storage-it-'));
  roots = { videos: path.join(dir, 'videos'), media: path.join(dir, 'media') };
  fs.mkdirSync(path.join(roots.videos, TENANT), { recursive: true });
  fs.writeFileSync(path.join(roots.videos, TENANT, VIDEO), crypto.randomBytes(128 * 1024));
  await pool.query("INSERT INTO subscribers (id, tenant_id, name) VALUES ('sub-storage-it', ?, 'Storage IT')", [TENANT]);
  await pool.query(
    `INSERT INTO payment_proofs (id, subscriber_id, amount, currency, payment_method, proof_image, status, tenant_id)
     VALUES ('pp-storage-it-1', 'sub-storage-it', 100, 'EGP', 'instapay', ?, 'PENDING', ?),
            ('pp-storage-it-2', 'sub-storage-it', 50, 'EGP', 'instapay', NULL, 'PENDING', ?)`,
    [PNG_URL, TENANT, TENANT]);
});

after(async () => {
  if (!ENABLED) return;
  await clean();
  await s3?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  await pool.end().catch(() => {});
});

// Only this test's tenant: other suites share the database.
const run = argv => {
  const { parseArgs, runMove } = require('../../tools/move-uploads-to-storage.cjs');
  const scoped = {
    query: (sql, params) => (/FROM payment_proofs\s+WHERE proof_image LIKE/.test(sql)
      ? pool.query(sql.replace('WHERE proof_image LIKE', `WHERE tenant_id='${TENANT}' AND proof_image LIKE`), params)
      : pool.query(sql, params)),
  };
  return runMove({ client, ledger, db: scoped, roots, options: parseArgs(argv), log: () => {} });
};
const proofImage = async id => (await pool.query('SELECT proof_image FROM payment_proofs WHERE id=? AND tenant_id=?', [id, TENANT]))[0][0].proof_image;
const ledgerRow = key => ledger.get(key);

test('copy and verify, then a second run skips what is done', { skip }, async () => {
  const first = await run(['--include-proofs']);
  assert.equal(first.failed, 0);
  assert.equal(first.actions.copied, 2, 'the video and the one receipt with a picture');
  const video = await ledgerRow(`videos/${TENANT}/${VIDEO}`);
  assert.equal(video.location, 'both');
  assert.equal(video.size, 128 * 1024);
  assert.equal(video.kind, 'video');
  const proof = await ledgerRow(`proofs/${TENANT}/pp-storage-it-1.png`);
  assert.equal(proof.location, 'both');
  assert.equal(proof.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.equal(await proofImage('pp-storage-it-1'), PNG_URL, 'the row keeps its picture until --delete-local');

  const second = await run(['--include-proofs']);
  assert.equal(second.actions['already-copied'], 2);
  assert.equal(s3.log.filter(entry => entry.method === 'PUT').length, 2);
});

test('--delete-local frees the disk and the row; the reader returns the same picture', { skip }, async () => {
  const summary = await run(['--include-proofs', '--delete-local']);
  assert.equal(summary.failed, 0);
  assert.equal(summary.actions['deleted-local'], 2);
  assert.ok(!fs.existsSync(path.join(roots.videos, TENANT, VIDEO)));
  assert.equal((await ledgerRow(`videos/${TENANT}/${VIDEO}`)).location, 'remote');
  assert.equal(await proofImage('pp-storage-it-1'), `storage:proofs/${TENANT}/pp-storage-it-1.png`);
  assert.equal((await ledgerRow(`proofs/${TENANT}/pp-storage-it-1.png`)).location, 'remote');
  const { readProofImage } = require('../../lib/storedFiles');
  assert.equal(await readProofImage(await proofImage('pp-storage-it-1'), { client }), PNG_URL);
});

test('the lecture route finds a moved file through the ledger', { skip }, async () => {
  const { bucketUrlFor } = require('../../lib/storedFiles');
  const url = await bucketUrlFor(`videos/${TENANT}/${VIDEO}`, { expiresIn: 600, ledger, client });
  assert.match(url, new RegExp(`/${s3.bucket}/videos/${TENANT}/${VIDEO}\\?.*X-Amz-Expires=600`));
  assert.equal(await bucketUrlFor(`videos/${TENANT}/media-00000000-0000-4000-8000-000000000000.mp4`, { ledger, client }), null);
});

test('claims keep two processes off the same file', { skip }, async () => {
  const key = `videos/${TENANT}/${VIDEO}`;
  assert.equal(await ledger.claim(key, 60), true);
  assert.equal(await ledger.claim(key, 60), false);
  await ledger.release(key);
  assert.equal(await ledger.claim(key, 60), true);
  await ledger.release(key);
});

test('--to-local brings the video and the receipt back exactly', { skip }, async () => {
  const bytes = s3.objects.get(`videos/${TENANT}/${VIDEO}`).body;
  const summary = await run(['--include-proofs', '--to-local']);
  assert.equal(summary.failed, 0);
  assert.equal(summary.actions.restored, 2);
  assert.ok(fs.readFileSync(path.join(roots.videos, TENANT, VIDEO)).equals(bytes));
  assert.equal(await proofImage('pp-storage-it-1'), PNG_URL);
  assert.equal((await ledgerRow(`videos/${TENANT}/${VIDEO}`)).location, 'both');
  assert.equal(await proofImage('pp-storage-it-2'), null, 'a receipt with no picture is untouched throughout');
});
