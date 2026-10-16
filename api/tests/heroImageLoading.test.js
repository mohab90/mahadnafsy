'use strict';
// The homepage hero used to carry a 189KB photo that phones never showed and
// still downloaded (it was loading="eager" inside a desktop-only container).
// The hero is text and numbers only, so there is no hero photo to fetch at all. This keeps it that way: any image
// that comes back to the first screen must be lazy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const home = read('client/pages/Home.tsx');

test('the hero has no photo to download', () => {
  const hero = home.slice(home.indexOf('{/* ── Hero'), home.indexOf('{/* Trust strip */}'));
  assert.ok(hero.length > 500, 'the hero block was not located');
  assert.doesNotMatch(hero, /<img\b/, 'a hero image is back on the first screen');
});

test('no image on the home page is fetched eagerly', () => {
  assert.doesNotMatch(home, /loading="eager"/);
  for (const match of home.matchAll(/<img\b[^>]*>/g)) {
    assert.match(match[0], /loading="lazy"/, `an image without lazy loading: ${match[0].slice(0, 80)}`);
  }
});
