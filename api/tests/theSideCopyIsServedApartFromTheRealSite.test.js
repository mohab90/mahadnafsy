'use strict';

// «سيب الرئيسية الاساسيه زي ما هيا وارفع دي كنسخه تانيه جانبيه في سب دومين او فولدر مختلف».
//
// The new home page ships as a side copy under /new/ on the same domain: built with that base,
// no service worker, no tracking, noindex, and put in a folder of its own. These pin what keeps
// the real site untouched; the packaging itself was exercised by building it and serving it
// under /new/ the way deploy/nginx/mahad-new-side.conf.example does.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('the side copy page drops the tracking and is noindex, and keeps everything else', async () => {
  const { sideCopyIndex } = await import(pathToFileURL(path.join(root, 'tools/side-copy-index.mjs')).href);
  const html = `<!DOCTYPE html><html><head>
    <meta http-equiv="Cache-Control" content="no-cache" />
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
    <script>window.dataLayer = []; gtag('config', 'G-X');</script>
    <!-- Meta Pixel Code -->
    <script>fbq('init', '1');</script>
    <!-- End Meta Pixel Code -->
    <meta name="robots" content="index, follow" />
    <title>معهد الدراسات النفسية</title>
    <script type="module" src="/new/assets/index-abc.js"></script>
  </head><body><noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=1&ev=PageView"></noscript><div id="root"></div></body></html>`;
  const out = sideCopyIndex(html);
  assert.doesNotMatch(out, /googletagmanager|gtag|fbq|fbevents|facebook\.com\/tr/);
  assert.match(out, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.doesNotMatch(out, /index, follow/);
  assert.match(out, /<title>معهد الدراسات النفسية<\/title>/);
  assert.match(out, /src="\/new\/assets\/index-abc\.js"/);
  assert.match(out, /<div id="root"><\/div>/);
  // The real index.html source still carries both, so the tool has something to remove.
  const source = read('client/index.html');
  assert.match(source, /googletagmanager/);
  assert.doesNotMatch(sideCopyIndex(source), /googletagmanager|fbevents|facebook\.com\/tr/);
  // A page with no robots tag gets one.
  assert.match(sideCopyIndex('<html><head></head><body></body></html>'), /noindex, nofollow/);
});

test('the build under /new/ switches the service worker off and the nginx snippet serves it apart', () => {
  assert.match(read('client/index.tsx'), /import\.meta\.env\.PROD && !import\.meta\.env\.VITE_DISABLE_SW/);
  const script = read('deploy/side-copy.sh');
  assert.match(script, /VITE_APP_BASE="\$SIDE_PATH\/"/);
  assert.match(script, /VITE_ROUTER_BASENAME="\$SIDE_PATH"/);
  assert.match(script, /VITE_DISABLE_SW=1/);
  assert.match(script, /tools\/side-copy-index\.mjs/);
  assert.match(script, /--prepare-only/);
  assert.match(script, /sha256sum -c/);
  // Only its own folder is replaced, and nginx is never edited by the script.
  assert.match(script, /SIDE_DIR="\$\{MAHAD_SIDE_DIR:-\/var\/www\/mahad-side\/new\}"/);
  // Lines that only print the one-time nginx instructions are not commands.
  const commands = script.split('\n').filter(line => !/^\s*(echo|#)/.test(line)).join('\n');
  assert.doesNotMatch(commands, /systemctl|nginx -s|nginx -t|>\s*\/etc\/nginx|tee\s+\/etc\/nginx/, 'the script does not touch nginx or any service');
  assert.doesNotMatch(commands, /rm -rf (\/|"\$HOME")/);
  const nginx = read('deploy/nginx/mahad-new-side.conf.example');
  assert.match(nginx, /location \^~ \/new\/ \{/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/new\/index\.html;/);
  assert.match(nginx, /X-Robots-Tag "noindex, nofollow"/);
  assert.match(nginx, /root \/var\/www\/mahad-side;/);
});
