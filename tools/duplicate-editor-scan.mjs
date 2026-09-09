#!/usr/bin/env node
/**
 * One stored value, edited from two screens.
 *
 * Certificate pricing had that: a section in الإعدادات and a tab inside طلبات
 * الشهادات, both writing extra_cert_pricing, both with their own layout, and —
 * until they were found — both carrying the same two bugs, because a fix to one
 * never reached the other.
 *
 * This finds the rest of that shape: a settings key, a tenant_settings section
 * or an API path that more than one screen writes to. Reads are not duplication;
 * a value read in ten places and written in one is exactly right.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, out = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const screens = walk(path.join(ROOT, 'admin')).filter(f => !/\/lib\//.test(f.replace(/\\/g, '/')));

/** Which screens write each content key. */
const contentWriters = new Map();
/** Which screens send a write to each API path. */
const apiWriters = new Map();

const add = (map, key, file) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(path.relative(ROOT, file).replace(/\\/g, '/'));
};

for (const file of screens) {
  const source = fs.readFileSync(file, 'utf8');

  // A content key written through setContentValue / setContentValues / a patch.
  for (const match of source.matchAll(/setContentValue\w*\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    add(contentWriters, match[1], file);
  }
  for (const match of source.matchAll(/return \{ '([a-zA-Z0-9_.]+)':/g)) {
    add(contentWriters, match[1], file);
  }
  for (const match of source.matchAll(/'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)':\s*JSON\.stringify/g)) {
    add(contentWriters, match[1], file);
  }

  // A write to an admin API path: the method decides, so only non-GET counts.
  for (const match of source.matchAll(
    /['"`](\/(?:api\/)?admin\/[a-zA-Z0-9/_${}.:-]+)['"`][\s\S]{0,200}?method:\s*'(POST|PUT|PATCH|DELETE)'/g)) {
    add(apiWriters, `${match[2]} ${match[1].replace(/\$\{[^}]*\}/g, 'x')}`, file);
  }
  for (const match of source.matchAll(
    /admin(Post|Put|Patch|Delete)<?[^(]*\(\s*[`'"]([/][a-zA-Z0-9/_${}.:-]+)/g)) {
    add(apiWriters, `${match[1].toUpperCase()} ${match[2].replace(/\$\{[^}]*\}/g, 'x')}`, file);
  }
}

const report = (title, map, noun) => {
  const shared = [...map].filter(([, files]) => files.size > 1);
  console.log(`\n${title}`);
  console.log(`  ${noun} written by a screen: ${map.size}; written by more than one: ${shared.length}`);
  for (const [key, files] of shared.sort((a, b) => b[1].size - a[1].size)) {
    console.log(`\n  ${key}`);
    for (const file of files) console.log(`      ${file}`);
  }
};

report('── settings values ─────────────────────────────────────────────', contentWriters, 'content keys');
report('── admin writes ────────────────────────────────────────────────', apiWriters, 'API writes');

console.log('\nA value written from two screens is a fix that has to be made twice.');
console.log('A modal reused by one screen is not this — check whether the second');
console.log('writer is a distinct screen before acting.');
