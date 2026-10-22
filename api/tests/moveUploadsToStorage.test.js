'use strict';

// tools/move-uploads-to-storage.cjs against a fake S3 server (tests/_fakeS3.js)
// and an in-memory ledger shaped like lib/storageLedger.js: a dry run changes
// nothing, a run that dies half way resumes without re-uploading what was
// verified, a bucket that stored the wrong bytes is caught, local copies go
// only with --delete-local and only after a fresh check, and --to-local brings
// everything back byte for byte. The same run against MariaDB is
// tests/integration/storageMove.integration.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// The sweep finds a new upload under VIDEO_ROOT; this file's own, not the release's.
const SWEEP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-sweep-'));
process.env.VIDEO_UPLOAD_DIR = SWEEP_ROOT;
test.after(() => fs.rmSync(SWEEP_ROOT, { recursive: true, force: true }));

const { createS3Client, storageConfig } = require('../lib/objectStorage');
const { offloadPendingUploads } = require('../lib/storageOffload');
const { parseArgs, runMove } = require('../tools/move-uploads-to-storage.cjs');
const { startFakeS3 } = require('./_fakeS3');

const credentials = { accessKeyId: 'move-key', secretAccessKey: 'move-secret-0123456789' };

function memoryLedger() {
  const rows = new Map();
  return {
    rows,
    async get(key) { return rows.has(key) ? { ...rows.get(key) } : null; },
    async record(key, fields) {
      const [prefix, tenantId] = key.split('/');
      rows.set(key, { key, tenantId, kind: { videos: 'video', media: 'image', proofs: 'proof' }[prefix], size: null, sha256: null, contentType: null, pendingOffload: false, ...fields });
    },
    async setLocation(key, location, { pendingOffload } = {}) {
      if (!rows.has(key)) return false;
      Object.assign(rows.get(key), { location, claimed: false }, pendingOffload == null ? {} : { pendingOffload });
      return true;
    },
    async noteError(key, message) { if (rows.has(key)) rows.get(key).lastError = message; },
    async claim(key) { const row = rows.get(key); if (!row || row.claimed) return false; row.claimed = true; return true; },
    async release(key) { if (rows.has(key)) rows.get(key).claimed = false; },
    async pending() { return [...rows.values()].filter(row => row.pendingOffload && row.location !== 'remote' && !row.claimed); },
    async inLocation(location, { kinds }) { return [...rows.values()].filter(row => row.location === location && kinds.includes(row.kind)); },
  };
}

async function setup() {
  const s3 = await startFakeS3({ credentials });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-move-'));
  const roots = { videos: path.join(dir, 'videos'), media: path.join(dir, 'media') };
  const files = {};
  const write = (relative, bytes) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    files[relative] = bytes;
  };
  write('videos/tenant-a/media-11111111-1111-4111-8111-111111111111.mp4', crypto.randomBytes(256 * 1024));
  write('videos/tenant-a/media-22222222-2222-4222-8222-222222222222.webm', crypto.randomBytes(64 * 1024));
  write('videos/tenant-b/media-33333333-3333-4333-8333-333333333333.mp4', crypto.randomBytes(1024));
  write('media/tenant-a/0123456789abcdef01234567.webp', crypto.randomBytes(2048));
  // Not uploads: an interrupted multer temp file and a stray name.
  write('videos/.tmp/pending-x', Buffer.from('partial'));
  write('videos/tenant-a/notes.txt', Buffer.from('not a lecture'));
  const config = storageConfig({
    STORAGE_DRIVER: 's3', STORAGE_S3_ENDPOINT: s3.endpoint, STORAGE_S3_BUCKET: s3.bucket,
    STORAGE_S3_ACCESS_KEY_ID: credentials.accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  }).s3;
  const client = createS3Client(config);
  const ledger = memoryLedger();
  const lines = [];
  const run = argv => runMove({ client, ledger, roots, options: parseArgs(argv), log: line => lines.push(line) });
  return {
    s3, dir, roots, files, client, ledger, lines, run,
    exists: relative => fs.existsSync(path.join(dir, relative)),
    cleanup: async () => { await s3.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const VIDEO_A = 'videos/tenant-a/media-11111111-1111-4111-8111-111111111111.mp4';

test('options: proofs only on request, and delete and restore are never combined', () => {
  assert.deepEqual([...parseArgs([]).only], ['videos', 'media']);
  assert.deepEqual([...parseArgs(['--include-proofs', '--only=proofs']).only], ['proofs']);
  assert.throws(() => parseArgs(['--to-local', '--delete-local']), /cannot be combined/);
  assert.throws(() => parseArgs(['--only=backups']), /--only/);
});

test('a dry run uploads nothing, records nothing and deletes nothing', async () => {
  const t = await setup();
  try {
    const summary = await t.run(['--dry-run', '--delete-local']);
    assert.equal(summary.total, 4, 'the temp file and the stray name are not uploads');
    assert.equal(summary.actions['would-copy'], 4);
    assert.equal(t.s3.objects.size, 0);
    assert.equal(t.s3.log.filter(entry => entry.method === 'PUT').length, 0);
    assert.equal(t.ledger.rows.size, 0);
    assert.ok(t.exists(VIDEO_A));
    assert.match(t.lines[0], /4 item\(s\).*dry run/);
  } finally { await t.cleanup(); }
});

test('copy, interrupted part way, resumes without uploading a verified file twice', async () => {
  const t = await setup();
  try {
    t.s3.faults.failPuts = 1;
    // The first file's upload is refused: it fails, the others carry on.
    const first = await t.run([]);
    assert.equal(first.failed, 1);
    assert.equal(first.actions.copied, 3);
    assert.match(t.lines.join('\n'), /FAILED videos\/tenant-a\/media-1111/);

    const putsBefore = t.s3.log.filter(entry => entry.method === 'PUT').length;
    const second = await t.run([]);
    assert.equal(second.failed, 0);
    assert.equal(second.actions.copied, 1, 'only the one that failed is uploaded again');
    assert.equal(second.actions['already-copied'], 3);
    assert.equal(t.s3.log.filter(entry => entry.method === 'PUT').length, putsBefore + 1);

    for (const [relative, bytes] of Object.entries(t.files)) {
      if (!/media-|\.webp$/.test(relative)) continue;
      assert.ok(t.s3.objects.get(relative).body.equals(bytes), `${relative} arrived intact`);
      const row = t.ledger.rows.get(relative);
      assert.equal(row.location, 'both');
      assert.equal(row.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.ok(t.exists(relative), 'nothing local is deleted without --delete-local');
    }
    assert.equal(t.ledger.rows.get(VIDEO_A).contentType, 'video/mp4');
  } finally { await t.cleanup(); }
});

test('an upload that landed but was never recorded is adopted after its hash is compared', async () => {
  const t = await setup();
  try {
    await t.client.put(VIDEO_A, { filePath: path.join(t.dir, VIDEO_A), contentType: 'video/mp4' });
    const putsBefore = t.s3.log.filter(entry => entry.method === 'PUT').length;
    const summary = await t.run(['--only=videos']);
    assert.equal(summary.actions.adopted, 1);
    assert.equal(t.s3.log.filter(entry => entry.method === 'PUT').length, putsBefore + 2, 'the other two videos only');
  } finally { await t.cleanup(); }
});

test('a bucket that kept the wrong bytes is caught, recorded nowhere, and the file stays', async () => {
  const t = await setup();
  try {
    t.s3.faults.corruptPuts = 1;
    const summary = await t.run(['--only=videos', '--delete-local']);
    assert.equal(summary.failed, 1);
    assert.match(t.lines.join('\n'), /FAILED .*expected/);
    assert.equal(t.ledger.rows.get(VIDEO_A), undefined, 'never recorded as copied');
    assert.ok(t.exists(VIDEO_A), 'and never deleted');
    const retry = await t.run(['--only=videos', '--delete-local']);
    assert.equal(retry.failed, 0);
    assert.equal(t.ledger.rows.get(VIDEO_A).location, 'remote');
  } finally { await t.cleanup(); }
});

test('--delete-local frees the disk only after checking the bucket copy again', async () => {
  const t = await setup();
  try {
    await t.run([]);
    // Someone deleted one object from the bucket after it was verified.
    t.s3.objects.delete('media/tenant-a/0123456789abcdef01234567.webp');
    const summary = await t.run(['--delete-local']);
    assert.equal(summary.actions['deleted-local'], 3);
    assert.equal(summary.actions.kept, 1);
    assert.ok(t.exists('media/tenant-a/0123456789abcdef01234567.webp'), 'kept: its bucket copy is gone');
    assert.equal(t.ledger.rows.get('media/tenant-a/0123456789abcdef01234567.webp').location, 'local');
    assert.ok(!t.exists(VIDEO_A));
    assert.equal(t.ledger.rows.get(VIDEO_A).location, 'remote');

    // The next run puts the lost picture back and can then delete it.
    const again = await t.run(['--delete-local']);
    assert.equal(again.actions['deleted-local'], 1);
    assert.equal(again.actions['already-copied'] || 0, 0);
  } finally { await t.cleanup(); }
});

test('--to-local brings every moved file back, verified, and the app reads the disk again', async () => {
  const t = await setup();
  try {
    await t.run(['--delete-local']);
    assert.ok(!t.exists(VIDEO_A));
    const dry = await t.run(['--to-local', '--dry-run']);
    assert.equal(dry.actions['would-restore'], 4);
    assert.ok(!t.exists(VIDEO_A));
    const summary = await t.run(['--to-local']);
    assert.equal(summary.actions.restored, 4);
    for (const [relative, bytes] of Object.entries(t.files)) {
      if (!/media-|\.webp$/.test(relative)) continue;
      assert.ok(fs.readFileSync(path.join(t.dir, relative)).equals(bytes), `${relative} restored intact`);
      assert.equal(t.ledger.rows.get(relative).location, 'both');
    }
    assert.deepEqual(fs.readdirSync(path.join(t.roots.videos, 'tenant-a')).filter(name => name.includes('.restore-')), [], 'no temporary files left');
  } finally { await t.cleanup(); }
});

test('a new upload waiting on the disk is moved by the sweep and its local copy removed', async () => {
  const t = await setup();
  try {
    const original = path.join(t.roots.videos, 'tenant-b', 'media-33333333-3333-4333-8333-333333333333.mp4');
    const key = 'videos/tenant-b/media-33333333-3333-4333-8333-333333333333.mp4';
    await t.ledger.record(key, { location: 'local', size: 1024, contentType: 'video/mp4', pendingOffload: true });
    // The sweep resolves the path from VIDEO_ROOT; point the ledger's key at this test's copy.
    const { localPathForKey } = require('../lib/objectStorage');
    const target = localPathForKey(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target);
    try {
      const result = await offloadPendingUploads({ client: t.client, ledger: t.ledger });
      assert.deepEqual(result, { moved: 1, failed: 0 });
      assert.ok(!fs.existsSync(target));
      assert.equal(t.ledger.rows.get(key).location, 'remote');
      assert.equal(t.ledger.rows.get(key).pendingOffload, false);
      assert.ok(t.s3.objects.get(key).body.equals(fs.readFileSync(original)));
    } finally { fs.rmSync(target, { force: true }); }
  } finally { await t.cleanup(); }
});
