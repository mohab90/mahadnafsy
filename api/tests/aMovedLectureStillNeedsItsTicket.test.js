'use strict';

// A lecture file moved to the bucket (STORAGE_DRIVER=s3, lib/objectStorage.js)
// is exactly as locked as one on the disk. The bucket URL is made in one place
// — GET /api/media/lectures/:id, past the signed ticket and the live enrolment
// query — so without a ticket, or with a ticket but no active enrolment, no
// URL is ever produced; with both, the redirect lives no longer than the
// ticket. And with no storage settings the route behaves as it always has: a
// file missing from the disk is a 404, without even asking the ledger.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef';
process.env.MEDIA_SIGNING_SECRET = 'unit-test-media-secret-0123456789abcdef';
const VIDEO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-moved-lecture-'));
process.env.VIDEO_UPLOAD_DIR = VIDEO_ROOT;
test.after(() => fs.rmSync(VIDEO_ROOT, { recursive: true, force: true }));

const S3_ENV = {
  STORAGE_DRIVER: 's3',
  STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  STORAGE_S3_BUCKET: 'mahad-media',
  STORAGE_S3_ACCESS_KEY_ID: 'unit-key',
  STORAGE_S3_SECRET_ACCESS_KEY: 'unit-secret-0123456789',
};
const setEnv = values => {
  for (const key of Object.keys(S3_ENV)) delete process.env[key];
  Object.assign(process.env, values);
};

const express = require('express');
const { pool } = require('../lib/db');
const { createMediaTicket } = require('../lib/mediaAccess');

const TENANT = 'tenant-storage-unit';
const FILE = 'media-44444444-4444-4444-8444-444444444444.mp4';
const VIDEO_URL = `/uploads/videos/${TENANT}/${FILE}`;
const KEY = `videos/${TENANT}/${FILE}`;

// The database as the route sees it: whether the subscriber is enrolled, and
// what the ledger says about the file.
const state = { enrolled: true, ledger: null, queries: [] };
pool.query = async (sql, params) => {
  state.queries.push(sql);
  if (/FROM course_lectures cl[\s\S]*JOIN enrollments/.test(sql)) return [state.enrolled ? [{ video_url: VIDEO_URL }] : []];
  if (/FROM storage_objects/.test(sql)) {
    assert.deepEqual(params, [KEY, TENANT], 'the ledger is asked about this tenant\'s file only');
    return [state.ledger ? [state.ledger] : []];
  }
  throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
};

const app = express();
app.use(require('../routes/lms'));
let server;
let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

const get = (url, headers = {}) => fetch(`${base}${url}`, { redirect: 'manual', headers });
const ticketFor = (lectureId = 'lec-1', ttlSeconds = 1800) => createMediaTicket({
  tenantId: TENANT, subscriberId: 'sub-1', lectureId, ttlSeconds, kind: 'video',
});
const reset = () => { state.enrolled = true; state.ledger = null; state.queries = []; };
const movedRow = location => ({ object_key: KEY, tenant_id: TENANT, kind: 'video', location, size_bytes: 10, sha256: 'a'.repeat(64) });
async function assertNoBucketUrl(response) {
  assert.equal(response.headers.get('location'), null);
  assert.doesNotMatch(await response.text(), /X-Amz|r2\.cloudflarestorage/);
}

test('with s3 on, no ticket or a forged one gets nothing', async () => {
  setEnv(S3_ENV); reset();
  state.ledger = movedRow('remote');
  for (const ticket of ['', 'forged.ticket', ticketFor('another-lecture')]) {
    const response = await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(response.status, 401);
    await assertNoBucketUrl(response);
  }
  assert.equal(state.queries.length, 0, 'refused before the database is asked anything');
});

test('with s3 on, a valid ticket without an active enrolment gets no bucket URL', async () => {
  setEnv(S3_ENV); reset();
  state.enrolled = false;
  state.ledger = movedRow('remote');
  const response = await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticketFor())}`);
  assert.equal(response.status, 404);
  await assertNoBucketUrl(response);
  assert.ok(!state.queries.some(sql => /storage_objects/.test(sql)), 'the ledger is never even consulted');
});

test('with s3 on, ticket and enrolment get a private redirect that dies with the ticket', async () => {
  setEnv(S3_ENV); reset();
  state.ledger = movedRow('remote');
  const response = await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticketFor('lec-1', 1800))}`, { range: 'bytes=0-' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.host, 'acct.r2.cloudflarestorage.com');
  assert.equal(location.pathname, `/mahad-media/${KEY}`);
  const lifetime = Number(location.searchParams.get('X-Amz-Expires'));
  assert.ok(lifetime > 1700 && lifetime <= 1800, `lives as long as the ticket, not longer (got ${lifetime})`);
  assert.equal(location.searchParams.get('X-Amz-SignedHeaders'), 'host');

  state.ledger = movedRow('both');
  assert.equal((await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticketFor())}`)).status, 302, 'a verified copy kept on both sides');
});

test('with s3 on, a file the ledger never moved is a 404, not a guess at the bucket', async () => {
  setEnv(S3_ENV); reset();
  for (const ledger of [null, movedRow('local')]) {
    state.ledger = ledger;
    const response = await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticketFor())}`);
    assert.equal(response.status, 404);
    await assertNoBucketUrl(response);
  }
});

test('a file still on the disk streams from the disk, bucket or not', async () => {
  setEnv(S3_ENV); reset();
  state.ledger = movedRow('both');
  fs.mkdirSync(path.join(VIDEO_ROOT, TENANT), { recursive: true });
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(100, 1)]);
  fs.writeFileSync(path.join(VIDEO_ROOT, TENANT, FILE), bytes);
  try {
    const response = await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticketFor())}`, { range: 'bytes=0-9' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes 0-9/${bytes.length}`);
    assert.ok(!state.queries.some(sql => /storage_objects/.test(sql)));
  } finally { fs.rmSync(path.join(VIDEO_ROOT, TENANT, FILE)); }
});

test('with no storage settings, a missing file is a 404 exactly as before', async () => {
  setEnv({}); reset();
  state.ledger = movedRow('remote');
  const response = await get(`/api/media/lectures/lec-1?ticket=${encodeURIComponent(ticketFor())}`);
  assert.equal(response.status, 404);
  await assertNoBucketUrl(response);
  assert.ok(!state.queries.some(sql => /storage_objects/.test(sql)), 'no bucket configured: the ledger is not asked');
});

test('the bucket URL is made only past the ticket and the enrolment check', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'lms.js'), 'utf8');
  const handler = route.slice(route.indexOf("router.get('/api/media/lectures/:lectureId'"));
  const ticketAt = handler.indexOf('verifyMediaTicket(');
  const enrolmentAt = handler.indexOf("e.status='active'");
  const bucketAt = handler.indexOf('bucketUrlFor(');
  assert.ok(ticketAt > 0 && enrolmentAt > ticketAt && bucketAt > enrolmentAt);
  assert.equal(route.split('bucketUrlFor(').length, 2, 'one place in the LMS makes a bucket URL');
});
