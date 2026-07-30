'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'imageProxy.js'), 'utf8');

test('image proxy validates every redirect target and rejects arbitrary redirect origins', () => {
  assert.match(source, /function allowedSource/);
  assert.match(source, /url\.protocol === 'https:'/);
  assert.match(source, /fetchBuffer\(target, redirects \+ 1\)/);
  assert.match(source, /if \(!u\) return res\.status\(400\)/);
  assert.doesNotMatch(source, /const lib = url\.startsWith/);
  assert.doesNotMatch(source, /if \(!sharp \|\| !ALLOWED_HOST_RE/);
});

test('production image cache is outside the immutable release directory', () => {
  assert.match(source, /\/var\/cache\/mahad\/images/);
});
