'use strict';
// The homepage hero used to carry a 189KB photo that phones never showed and
// still downloaded (it was loading="eager" inside a desktop-only container).
// The hero now carries one small photo of three graduates. This keeps it that way: any image
// that comes back to the first screen must be lazy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const home = read('client/pages/Home.tsx');

test('the hero carries one small photo of three graduates, loaded lazily', () => {
  const hero = home.slice(home.indexOf('{/* ── Hero'), home.indexOf('{/* Trust strip */}'));
  assert.ok(hero.length > 500, 'the hero block was not located');
  const images = hero.match(/<img\b[^>]*>/g) || [];
  assert.equal(images.length, 1, 'exactly one hero image');
  assert.match(images[0], /brand\/hero-graduates\.jpg/);
  assert.match(images[0], /loading="lazy"/);
  assert.match(images[0], /alt="[^"]+"/, 'described for screen readers');
  const file = path.join(__dirname, '..', '..', 'client', 'public', 'brand', 'hero-graduates.jpg');
  assert.ok(fs.statSync(file).size < 200 * 1024, 'a hero photo under 200KB');
});

test('no image on the home page is fetched eagerly', () => {
  assert.doesNotMatch(home, /loading="eager"/);
  for (const match of home.matchAll(/<img\b[^>]*>/g)) {
    assert.match(match[0], /loading="lazy"/, `an image without lazy loading: ${match[0].slice(0, 80)}`);
  }
});
