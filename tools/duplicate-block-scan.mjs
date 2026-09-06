#!/usr/bin/env node
/**
 * Identical blocks of code repeated across files.
 *
 * Not "similar" — identical once indentation is normalised, so every hit is a
 * candidate for one shared function or component rather than a judgement call
 * about style. Sorted by how many lines collapse if the duplicate copies are
 * replaced by one, which is the number that matters when the goal is less code.
 *
 * Usage: node tools/duplicate-block-scan.mjs [--window 12] [--min 2] [--dir admin]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at === -1 ? fallback : args[at + 1];
};
const WINDOW = Number(flag('window', 12));
const MIN_COPIES = Number(flag('min', 2));
const DIRS = (flag('dir', 'admin,client,api') || '').split(',').filter(Boolean);

const SKIP = new Set(['node_modules', 'dist', '.git', 'artifacts', 'coverage', 'build', 'migrations']);
const EXT = new Set(['.ts', '.tsx', '.js']);

const files = [];
for (const top of DIRS) {
  const start = path.join(ROOT, top);
  if (!fs.existsSync(start)) continue;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (EXT.has(path.extname(entry.name))) files.push(full);
    }
  })(start);
}

// A line only counts as content if it carries something other than punctuation:
// a window of closing braces is identical everywhere and means nothing.
const isSubstantial = (line) => /[A-Za-z0-9؀-ۿ]/.test(line) && line.trim().length > 3;

const blocks = new Map();
let scannedLines = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const raw = fs.readFileSync(file, 'utf8').split('\n');
  const lines = raw.map((line) => line.replace(/\s+/g, ' ').trim());
  scannedLines += lines.length;

  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const window = lines.slice(i, i + WINDOW);
    if (window.filter(isSubstantial).length < WINDOW - 2) continue;
    const key = crypto.createHash('sha1').update(window.join('\n')).digest('hex');
    if (!blocks.has(key)) blocks.set(key, { sample: raw.slice(i, i + WINDOW), places: [] });
    blocks.get(key).places.push({ file: rel, line: i + 1 });
  }
}

// Keep one hit per (block, file) pair, and drop windows that merely overlap a
// longer duplicate already reported from the same pair of files.
const found = [];
for (const { sample, places } of blocks.values()) {
  const byFile = new Map();
  for (const place of places) if (!byFile.has(place.file)) byFile.set(place.file, place);
  if (byFile.size < MIN_COPIES) continue;
  found.push({ sample, places: [...byFile.values()], copies: byFile.size });
}
found.sort((a, b) => (b.copies - 1) * WINDOW - (a.copies - 1) * WINDOW);

const seen = new Set();
const reported = [];
for (const block of found) {
  const signature = block.places.map((p) => p.file).sort().join('|');
  const near = signature + ':' + Math.floor(block.places[0].line / WINDOW);
  if (seen.has(near)) continue;
  seen.add(near);
  reported.push(block);
}

const savings = reported.reduce((sum, b) => sum + (b.copies - 1) * WINDOW, 0);
console.log('duplicate-block-scan: ' + files.length + ' files, ' + scannedLines + ' lines, window of ' + WINDOW);
console.log('identical blocks repeated across files: ' + reported.length);
console.log('lines that collapse if each is written once: ' + savings);
console.log('');

for (const block of reported.slice(0, 25)) {
  console.log('  x' + block.copies + '  (' + (block.copies - 1) * WINDOW + ' lines recoverable)');
  for (const place of block.places.slice(0, 6)) console.log('        ' + place.file + ':' + place.line);
  const preview = block.sample.map((l) => l.trim()).filter(Boolean).slice(0, 3);
  for (const line of preview) console.log('      | ' + line.slice(0, 110));
  console.log('');
}
