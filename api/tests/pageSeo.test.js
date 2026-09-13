'use strict';

// A page says which page it is.
//
// Every URL served the same shell, so a course page carried the homepage's
// title, its og:* tags and — the expensive one — `<link rel="canonical"
// href="https://mahadnafsy.com/">`, which tells Google that all 24 courses and
// 7 bundles are duplicates of the front page. Facebook and WhatsApp read the
// served HTML rather than running JavaScript, so every course link shared
// anywhere previewed as the generic institute card. The sitemap listed twelve
// static pages and none of the thirty-one things being sold.
//
// Two halves, because there are two readers:
//
//   tools/generate-seo.mjs  writes dist/c/<slug>/index.html per product, which
//                           nginx serves ahead of the SPA fallback thanks to the
//                           `try_files $uri $uri/` that is already in its config.
//                           This is what a crawler gets.
//   client/lib/useSeo.ts    keeps the same tags right once the app is running
//                           and the visitor navigates.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the generator rewrites every tag that identifies a page', () => {
  const gen = read('tools/generate-seo.mjs');
  // The rewrite itself, not the word — «canonical» also appears in the comment
  // above it, so checking for the word passes on a generator that stopped
  // writing the one tag that matters most.
  const rewrites = [
    ['<title>', '.replace(/<title>[\\s\\S]*?<\\/title>/, `<title>${t}</title>`)'],
    ['description', '.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${d}"`)'],
    ['og:url', '.replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${u}"`)'],
    ['og:title', '.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${t}"`)'],
    ['og:description', '.replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${d}"`)'],
    ['canonical', '.replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${u}"`)'],
  ];
  for (const [tag, line] of rewrites) {
    assert.ok(gen.includes(line), `the generator no longer rewrites ${tag}`);
  }
  // A product is an article, not the site's front page.
  assert.match(gen, /content="article"/);
  // And each product gets its own directory, which is what makes nginx serve it.
  assert.match(gen, /writePage\(`\/c\/\$\{slug\}`/);
  assert.match(gen, /writePage\(`\/bundle\/\$\{b\.id\}`/);
  assert.match(gen, /mkdirSync\(dir, \{ recursive: true \}\)/);
});

test('the sitemap is built from the catalogue, not from a fixed list', () => {
  const gen = read('tools/generate-seo.mjs');
  assert.match(gen, /urls\.push\(\{ loc: `\/c\/\$\{slug\}`/, 'courses have to be in it');
  assert.match(gen, /urls\.push\(\{ loc: `\/bundle\/\$\{b\.id\}`/, 'and bundles');
  assert.match(gen, /writeFileSync\(join\(DIST, 'sitemap\.xml'\), sitemap\)/);
  assert.match(gen, /<lastmod>/, 'a sitemap entry without a date tells a crawler nothing');
});

test('the release refuses to ship without it', () => {
  // A build whose product pages all canonicalise to the homepage is the bug
  // this exists to prevent, so a failure here has to stop the release.
  const prep = read('tools/prepare-release.mjs');
  assert.match(prep, /generate-seo\.mjs/);
  assert.match(prep, /throw new Error\(`SEO generation failed/);
  // And it runs after the build, or it would write into a directory that is
  // about to be deleted.
  assert.ok(prep.indexOf('generate-seo.mjs') > prep.indexOf('build produced no index.html'),
    'the generator must run after the client build, not before');
});

test('the app keeps the tags right while the visitor navigates', () => {
  const hook = read('client/lib/useSeo.ts');
  assert.match(hook, /link\[rel="canonical"\]/);
  assert.match(hook, /meta\[property="og:url"\]/);
  assert.match(hook, /meta\[property="og:title"\]/);

  // Every page that names itself sets the canonical too. A page that only sets
  // document.title leaves the previous page's canonical in the head.
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      const src = fs.readFileSync(full, 'utf8');
      if (!/document\.title\s*=/.test(src)) continue;
      // Setting it back to the site name on unmount is a cleanup, not a claim.
      const claims = (src.match(/document\.title\s*=/g) || []).length;
      const cleanupOnly = claims === 1 && /return \(\) => \{ document\.title = 'معهد الدراسات النفسية'; \}/.test(src);
      if (cleanupOnly) continue;
      // Either the whole hook, or setCanonical beside an effect that was doing
      // other work and was not worth rewriting.
      if (/useSeo\(|setCanonical\(|link\[rel="canonical"\]|rel="canonical"/.test(src)) continue;
      offenders.push(rel);
    }
  };
  walk(path.join(ROOT, 'client', 'pages'));
  assert.deepEqual(offenders, [],
    'these set a title but leave the canonical pointing at whatever loaded first: ' + offenders.join(', '));
});

test('the shell still carries the tags the generator rewrites', () => {
  // The generator edits by exact match. If the shell's markup is reformatted the
  // replacements silently do nothing and every page goes back to the homepage's
  // identity — with no error anywhere.
  const shell = read('client/index.html');
  for (const needle of [
    '<meta property="og:url" content="',
    '<meta property="og:title" content="',
    '<meta property="og:description" content="',
    '<meta property="og:type" content="',
    '<meta property="og:image" content="',
    '<meta name="description" content="',
    '<meta name="twitter:description" content="',
    '<link rel="canonical" href="',
  ]) {
    assert.ok(shell.includes(needle),
      `client/index.html no longer contains \`${needle}\` — the generator's replacement would be a no-op`);
  }
});
