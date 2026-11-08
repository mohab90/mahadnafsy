#!/usr/bin/env node
'use strict';
/**
 * Counts, per unit-test file and in total, the tests that (1) PIN SOURCE TEXT — read a non-fixture file and then match / doesNotMatch / includes on it —
 * and (2) DEPEND ON THE WALL CLOCK — `new Date()` / `Date.now()` in the test body with no frozen clock (mock.timers / mock.method(Date)).
 *
 *   node tools/test-pin-report.cjs            per-file table of the worst files + totals
 *   node tools/test-pin-report.cjs --all      every file with at least one
 *   node tools/test-pin-report.cjs --json     machine-readable
 *
 * It is a reading of the text, not a parse: a test block runs from its `test(` line to the next one. A test counts as pinned when its block calls a
 * reader of source (fs.readFileSync, a file-level helper that wraps it, a file-level constant filled by one, or the shared _authRouteSource /
 * _adminSplitSource helpers) and then asserts with match / doesNotMatch / includes / .test(). Reads of fixtures and JSON are ignored.
 */
const fs = require('node:fs');
const path = require('node:path');

// `--dir=<folder>` reads another copy of the tests (for a before/after comparison against an older commit).
const DIR = path.resolve(process.argv.find(arg => arg.startsWith('--dir='))?.slice(6) || path.join(__dirname, '..', 'tests'));
const SHARED_READERS = ['_authRouteSource', '_adminSplitSource'];

/** Names of file-level functions/consts that read source text, and of the constants they fill. */
function sourceNames(text) {
  const readers = new Set();
  for (const helper of SHARED_READERS) {
    for (const m of text.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*require\\('\\./${helper}'\\)`, 'g'))) {
      m[1].split(',').map(part => part.trim().split(':').pop().trim()).filter(Boolean).forEach(name => readers.add(name));
    }
  }
  const lines = text.split('\n');
  // a helper is a top-level function or arrow whose body reads a file
  for (let i = 0; i < lines.length; i += 1) {
    const decl = lines[i].match(/^(?:async\s+)?(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=)/);
    if (!decl) continue;
    const name = decl[1] || decl[2];
    const body = [];
    for (let j = i; j < Math.min(lines.length, i + 25); j += 1) {
      body.push(lines[j]);
      if (j > i && /^[})]/.test(lines[j])) break;
      if (j === i && /;\s*$/.test(lines[j])) break;
    }
    const joined = body.join('\n');
    if (/readFileSync/.test(joined) && !/fixture/i.test(joined) && !/\.json['"`]/.test(joined)) readers.add(name);
  }
  // constants filled once at file level by a reader: `const SRC = read('x')` or `const SRC = fs.readFileSync(...)`
  const vars = new Set();
  for (const m of text.matchAll(/^(?:const|let)\s+(\w+)\s*=\s*([^\n]*)/gm)) {
    const rhs = m[2];
    if (/readFileSync/.test(rhs) && !/fixture/i.test(rhs) && !/\.json/.test(rhs)) vars.add(m[1]);
    else if ([...readers].some(name => new RegExp(`\\b${name}\\s*\\(`).test(rhs))) vars.add(m[1]);
  }
  return [...readers, ...vars];
}

function blocks(text) {
  const starts = [];
  const re = /^[ \t]*(?:test|it)(?:\.(?:skip|todo|only))?\(/gm;
  let m;
  while ((m = re.exec(text))) starts.push(m.index);
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
}

const ASSERTS_TEXT = /\b(?:assert\.)?(?:match|doesNotMatch)\(|\.includes\(|\.test\(|\.indexOf\(/;
const WALL_CLOCK = /new Date\(\)|Date\.now\(\)/;
const FROZEN = /mock\.timers|mock\.method\(\s*Date|\bnow\s*[:=,)]|\btoday\s*[:=,)]/;

/** A block without its comments: a `new Date()` mentioned in a comment is not a clock read. */
const noComments = block => block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (all, lead) => lead);

function analyse(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  const names = sourceNames(text);
  const nameRe = names.length ? new RegExp(`\\b(?:${names.join('|')})\\b`) : null;
  let tests = 0; let pinned = 0; let clock = 0;
  for (const block of blocks(text)) {
    tests += 1;
    const code = noComments(block);
    const reads = /readFileSync/.test(block.replace(/.*fixture.*/gi, '')) || (nameRe && nameRe.test(block));
    if (reads && ASSERTS_TEXT.test(block)) pinned += 1;
    if (WALL_CLOCK.test(code) && !/mock\.timers|mock\.method\(\s*Date/.test(text) && !FROZEN.test(code.replace(/Date\.now\(\)/g, ''))) clock += 1;
  }
  return { file, tests, pinned, clock };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const rows = fs.readdirSync(DIR).filter(name => name.endsWith('.test.js')).map(analyse);
  const total = rows.reduce((sum, row) => ({ files: sum.files + 1, tests: sum.tests + row.tests, pinned: sum.pinned + row.pinned, clock: sum.clock + row.clock, pinnedFiles: sum.pinnedFiles + (row.pinned ? 1 : 0), clockFiles: sum.clockFiles + (row.clock ? 1 : 0) }), { files: 0, tests: 0, pinned: 0, clock: 0, pinnedFiles: 0, clockFiles: 0 });
  if (args.has('--json')) { console.log(JSON.stringify({ total, rows }, null, 1)); return; }
  const shown = rows.filter(row => row.pinned || row.clock).sort((a, b) => b.pinned - a.pinned || b.clock - a.clock);
  for (const row of args.has('--all') ? shown : shown.slice(0, 25)) {
    console.log(`${String(row.pinned).padStart(4)} pinned / ${String(row.tests).padStart(4)} tests   clock ${String(row.clock).padStart(3)}   ${row.file}`);
  }
  console.log(`\nfiles ${total.files}   tests ${total.tests}`);
  console.log(`source-text pins: ${total.pinned} tests (${(100 * total.pinned / total.tests).toFixed(1)}%) in ${total.pinnedFiles} files`);
  console.log(`wall-clock tests: ${total.clock} in ${total.clockFiles} files`);
}

main();
