#!/usr/bin/env node
// Exports that nothing imports.
//
// orphan-module-scan asks whether a *file* is reachable. This asks the next
// question down: inside a file the app does load, is this particular export
// ever named anywhere else? TypeScript will not say — an export is a public
// surface as far as tsc is concerned, so an exported function no caller has
// can be edited, typechecked, tested and deployed while the running app is
// unaffected.
//
// That is not hypothetical here: a fix was written into a CSV parser and
// deployed before anyone noticed the built bundle was unchanged.
//
// Deliberately loose in the same way as orphan-module-scan: a name mentioned
// anywhere in another file counts as used, comments included. The cost of a
// false "dead" (deleting live code) is much higher than the cost of missing
// one, so this errs towards silence.
//
//   node tools/dead-export-scan.mjs
//   node tools/dead-export-scan.mjs --list
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const VERBOSE = process.argv.includes('--list');

const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'build', 'coverage']);
const SOURCE_EXT = new Set(['.ts', '.tsx']);

// A default export has no name to search for, and the entry points re-export
// on purpose.
const SKIP_FILE = /(^|\/)(index|main|App)\.tsx?$|\.d\.ts$/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(extname(entry.name))) out.push(full);
  }
  return out;
}

const files = ['admin', 'client', 'shared'].flatMap(area => walk(join(ROOT, area)));
const corpus = new Map();
for (const file of files) {
  try { corpus.set(file, readFileSync(file, 'utf8')); } catch { /* unreadable */ }
}
// The api tree and the tools import from shared/, so they count as callers.
for (const area of ['api', 'tools', 'e2e']) {
  const extra = [];
  const walkAny = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIR.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkAny(full);
      else if (/\.(t|j)sx?$|\.mjs$|\.cjs$/.test(entry.name)) extra.push(full);
    }
  };
  walkAny(join(ROOT, area));
  for (const file of extra) {
    try { corpus.set(file, readFileSync(file, 'utf8')); } catch { /* unreadable */ }
  }
}

// `export function x`, `export const x`, `export class x`, `export type X`,
// `export interface X`, and the braces form `export { a, b as c }`.
const DECL = /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const BRACE = /^export\s*\{([^}]*)\}/gm;

const dead = [];
for (const [file, text] of corpus) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (!/^(admin|client|shared)\//.test(rel)) continue;
  if (SKIP_FILE.test(rel)) continue;

  const names = new Set();
  for (const match of text.matchAll(DECL)) names.add(match[1]);
  for (const match of text.matchAll(BRACE)) {
    for (const part of match[1].split(',')) {
      const name = part.includes(' as ') ? part.split(' as ')[1] : part;
      const clean = name.replace(/\btype\b/, '').trim();
      if (clean && /^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean);
    }
  }

  for (const name of names) {
    const word = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
    let used = false;
    for (const [other, otherText] of corpus) {
      if (other === file) continue;
      if (word.test(otherText)) { used = true; break; }
    }
    if (used) continue;

    // Two different findings wear the same shape. An export nothing outside
    // names, but that the file itself uses, is simply not an export — drop the
    // keyword. One the file does not use either is dead code.
    const own = text.split('\n').filter(line => word.test(line) && !/^export\s/.test(line));
    const isType = /^(?:[A-Z]|.*Props$)/.test(name) && !own.length;
    dead.push({ rel, name, internal: own.length > 0, isType });
  }
}

dead.sort((a, b) => a.rel.localeCompare(b.rel) || a.name.localeCompare(b.name));
const unused = dead.filter(entry => !entry.internal);
const overExported = dead.filter(entry => entry.internal);

const group = list => {
  const byFile = new Map();
  for (const entry of list) {
    if (!byFile.has(entry.rel)) byFile.set(entry.rel, []);
    byFile.get(entry.rel).push(entry.name);
  }
  return byFile;
};

console.log(`scanned ${corpus.size} files; ${files.length} of them in admin, client and shared`);
console.log(`nothing outside the file names them: ${dead.length}`);
console.log(`  dead — the file does not use them either: ${unused.length}`);
console.log(`  over-exported — used only inside their own file: ${overExported.length}`);
if (VERBOSE) {
  console.log('\ndead:');
  for (const [rel, names] of group(unused)) console.log(`  ${rel}\n      ${names.join(', ')}`);
  console.log('\nover-exported (drop the keyword, keep the code):');
  for (const [rel, names] of group(overExported)) console.log(`  ${rel}\n      ${names.join(', ')}`);
}
if (files.length < 300) {
  console.log('\nWARNING: fewer files scanned than expected — the walk is not reading the tree');
  process.exitCode = 1;
}
