'use strict';

// Debian ships /etc/nginx/nginx.conf with "gzip on;" and every gzip_types line
// commented out. nginx's own default type list is text/html alone, so the HTML
// compressed and the JavaScript and CSS it pulls did not — which reads as
// "compression is on" in every check that only looks at the page.
//
// Measured on production: a first visit downloaded 578,826 bytes of assets for
// the public site and 795,031 for the admin. Compressed, 153,738 and 223,045.
// Nobody would have noticed from the served page; it was just slow.
//
// The fix lives in nginx, so this test guards the file the server is built
// from — otherwise a rebuilt VPS silently goes back to shipping it raw.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
// Directives only. The comment above the block in that file names the
// directives it is explaining, and every assertion below matched the comment
// instead of the configuration until this stripped them.
const codeOnly = source => source
  .split('\n')
  .filter(line => !line.trim().startsWith('#'))
  .join('\n');

const conf = codeOnly(fs.readFileSync(path.join(ROOT, 'deploy', 'nginx', 'mahad-web.conf.example'), 'utf8'));

/** The server blocks, so "declared once at the top" cannot pass for "declared". */
function serverBlocks(source) {
  const blocks = [];
  const lines = source.split('\n');
  let depth = 0;
  let current = null;
  for (const line of lines) {
    if (current === null && /^server\s*\{/.test(line.trim())) { current = []; depth = 1; continue; }
    if (current === null) continue;
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth <= 0) { blocks.push(current.join('\n')); current = null; continue; }
    current.push(line);
  }
  return blocks;
}

test('both sites compress their JavaScript and CSS', () => {
  const blocks = serverBlocks(conf);
  // Denominator: the public site and the admin.
  assert.equal(blocks.length, 2, `expected two server blocks, saw ${blocks.length}`);

  for (const block of blocks) {
    assert.match(block, /^\s*gzip on;/m, 'a server block does not turn compression on');

    // "gzip on" alone is what production already had. The type list is the
    // part that was missing, and JavaScript and CSS are what the apps ship.
    const types = /gzip_types ([^;]+);/.exec(block);
    assert.ok(types, 'gzip_types is not declared, so nginx compresses text/html and nothing else');
    for (const needed of ['text/css', 'application/javascript', 'text/javascript', 'application/json']) {
      assert.ok(types[1].includes(needed), `gzip_types is missing ${needed}`);
    }

    // Behind a proxy or CDN, without this nginx skips compression for any
    // request carrying Via, and without gzip_vary a cache can serve a
    // compressed body to a client that did not ask for one.
    assert.match(block, /gzip_proxied any;/);
    assert.match(block, /gzip_vary on;/);
  }

  // The assets are also immutable-cached — that was already true, and the two
  // work together: compress once, then never re-fetch.
  assert.ok(conf.includes('max-age=31536000, immutable'));
});
