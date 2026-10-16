'use strict';
// The old hero hid its photo on phones but still downloaded it (189KB on the
// first screen anyone lands on). The hero now shows its three graduates on every
// screen, so the rule is the other way round: they are fetched first (they are
// the first screen), but each one is a WebP in two sizes and the page tells the
// browser how wide it is drawn, so a phone takes the ~20KB file and only a wide
// screen takes the larger one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const hero = fs.readFileSync(path.join(root, 'client/components/home/HeroSection.tsx'), 'utf8');
const picture = fs.readFileSync(path.join(root, 'client/components/Picture.tsx'), 'utf8');

test('the hero photos come in a phone size and a desktop size, and say how wide they are drawn', () => {
  assert.match(hero, /widths=\{\[360, 640\]\}/);
  assert.match(hero, /sizes="\(min-width: 1024px\) 210px, 31vw"/);
  assert.match(picture, /<source type="image\/webp" sizes=\{sizes\} srcSet=/);
  for (const name of ['woman', 'man', 'cert']) {
    const small = fs.statSync(path.join(root, `client/assets/photos/hero-${name}-360.webp`)).size;
    assert.ok(small < 30 * 1024, `the phone size of ${name} is ${Math.round(small / 1024)}KB`);
  }
});

test('the hero photos are the first screen, so they are not lazy', () => {
  assert.match(hero, /<Picture[\s\S]*?priority[\s\S]*?\/>/);
  assert.match(picture, /loading=\{priority \? undefined : 'lazy'\}/);
  assert.match(picture, /fetchPriority=\{priority \? 'high' : undefined\}/);
});

test('the site photos and the font are built into /assets/, which the server caches for a year', () => {
  // Files under public/ are answered with no-store on the live server, so a
  // photo there would be downloaded again on every visit.
  assert.match(picture, /import\.meta\.glob\('\.\.\/assets\/photos\/\*\.\{webp,jpg\}'/);
  assert.ok(!fs.existsSync(path.join(root, 'client/public/brand/grads')), 'no photos left in public/');
  const css = fs.readFileSync(path.join(root, 'client/index.css'), 'utf8');
  assert.match(css, /font-family: 'Tajawal';[\s\S]*?font-display: swap;[\s\S]*?src: url\('\.\/assets\/fonts\/tajawal-400-arabic\.woff2'\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'client/index.html'), 'utf8'), /fonts\.googleapis\.com/, 'no trip to Google before the first paint');
});
