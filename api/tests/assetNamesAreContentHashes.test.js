'use strict';
/**
 * Both builds appended the build's minute to every chunk name, so each deploy
 * renamed every file — unchanged vendor chunks included — and every visitor
 * downloaded the whole app again. Names are content hashes alone now; index.html
 * stays uncached and /assets/ immutable, and the deploy's -mtime pruning still
 * sees the current release's files as new (they are re-dated on extraction).
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

for (const app of ['client', 'admin']) {
  test(`${app}: chunk and entry names are the content hash, nothing dated`, () => {
    const config = read(`${app}/vite.config.ts`);
    assert.match(config, /chunkFileNames: 'assets\/\[name\]-\[hash\]\.js'/);
    assert.match(config, /entryFileNames: 'assets\/\[name\]-\[hash\]\.js'/);
    assert.match(config, /assetFileNames: 'assets\/\[name\]-\[hash\]\[extname\]'/);
    assert.doesNotMatch(config, /new Date\(\)/, 'a build-time date is back in the build');
    assert.doesNotMatch(config, /getFullYear|getMinutes/);
  });
}





