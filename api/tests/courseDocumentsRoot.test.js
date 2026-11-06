'use strict';

// Where the course PDFs live when COURSE_DOCUMENT_DIR is not set (lib/courseDocuments.js defaultRoot): the folder the server may write to and a release does not replace.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { defaultRoot } = require('../lib/courseDocuments');

const release = path.resolve('/srv/mahad/releases/r1/api');
const outside = path.resolve('/var/lib/mahad/videos');
const ask = (env, { linux = true, persistentFolder = true } = {}) => defaultRoot({
  env,
  platform: linux ? 'linux' : 'win32',
  exists: dir => persistentFolder && dir === '/var/lib/mahad',
  releaseRoot: release,
});

test('the videos folder is outside the release: the documents sit beside it', () => {
  assert.equal(ask({ VIDEO_UPLOAD_DIR: outside }), path.join(path.dirname(outside), 'documents'));
});

test('the videos folder is inside the release and /var/lib/mahad exists: /var/lib/mahad/documents, not a folder the next release replaces', () => {
  const insideRelease = path.join(release, 'uploads', 'videos');
  assert.equal(ask({ VIDEO_UPLOAD_DIR: insideRelease }), '/var/lib/mahad/documents');
});

test('nothing set and no /var/lib/mahad (a laptop, a test, Windows): the api\'s own uploads/documents', () => {
  assert.equal(ask({}, { persistentFolder: false }), path.join(release, 'uploads', 'documents'));
  assert.equal(ask({}, { linux: false }), path.join(release, 'uploads', 'documents'));
});

test('nothing set on a server that has /var/lib/mahad: /var/lib/mahad/documents', () => {
  assert.equal(ask({}), '/var/lib/mahad/documents');
});

test('a videos folder inside the release with no /var/lib/mahad keeps the sibling (the boot warning tells the owner), nothing is invented', () => {
  const insideRelease = path.join(release, 'uploads', 'videos');
  assert.equal(ask({ VIDEO_UPLOAD_DIR: insideRelease }, { persistentFolder: false }), path.join(release, 'uploads', 'documents'));
});

test('the header no longer names a default the code does not use', () => {
  const header = fs.readFileSync(path.join(__dirname, '..', 'lib', 'courseDocuments.js'), 'utf8').split('const crypto')[0];
  assert.doesNotMatch(header, /default <api>\/uploads\/documents/);
});
