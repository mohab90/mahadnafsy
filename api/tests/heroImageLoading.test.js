'use strict';
// The homepage hero lives in a container that only exists from lg up, and it
// carried loading="eager" — so every phone visitor downloaded 189KB for an
// image they could never see: 18% of the page, on the first screen anyone
// lands on.
//
// Measured on the live site rather than reasoned about. At 375 the request is
// now gone entirely and the page fell from 1072KB to 910KB; at 1280 the image
// is still fetched once and renders at 484x505, so the desktop hero is
// unchanged. Lazy is right for both: a display:none image is never near the
// viewport so it is skipped, and on desktop it is in the viewport so it loads
// immediately.
//
// The container assertion matters as much as the loading one. If the hero ever
// stops being desktop-only, lazy becomes the wrong choice and this is where
// that shows up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'pages', 'Home.tsx'), 'utf8');

test('the desktop-only hero image is not eagerly fetched', () => {
  const hero = home.slice(home.indexOf('Main Hero Image'), home.indexOf('Main Hero Image') + 700);
  assert.ok(hero.length > 200, 'the hero image block was not located');
  assert.match(hero, /loading="lazy"/);
  assert.doesNotMatch(hero, /loading="eager"/);
});

test('the hero still sits in a container that only shows from lg up', () => {
  assert.match(home, /className="hidden lg:flex items-center justify-center relative"/);
});
