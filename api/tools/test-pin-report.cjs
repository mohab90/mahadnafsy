#!/usr/bin/env node
'use strict';
/**
 * Counts, per unit-test file and in total, the tests that (1) PIN SOURCE TEXT — assert on text read from a non-fixture file — and (2) DEPEND ON THE
 * WALL CLOCK — `new Date()` / `Date.now()` in the test body with no frozen clock (mock.timers / mock.method(Date)).
 *
 *   node tools/test-pin-report.cjs            per-file table of the worst files + totals
 *   node tools/test-pin-report.cjs --all      every file with at least one
 *   node tools/test-pin-report.cjs --json     machine-readable
 *   node tools/test-pin-report.cjs --dir=<folder of tests>   another copy (a before/after comparison against an older commit)
 *
 * It is a reading of the text, not a parse: a test block runs from its `test(` line to the next one. A test counts as pinned when an assertion's
 * SUBJECT is source text — match(SUBJECT, …), doesNotMatch(SUBJECT, …), SUBJECT.includes(…), /re/.test(SUBJECT) — where SUBJECT is a reader call
 * (fs.readFileSync, a file-level helper that wraps it, the shared _authRouteSource / _adminSplitSource helpers) or a name filled from one at file level
 * or inside the test (directly, or by slicing or cleaning another such name). A test that reads a script and then asserts on what running it did is
 * not counted; reads of fixtures and JSON are ignored. What it cannot see is a clock read inside the code under test.
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(process.argv.find(arg => arg.startsWith('--dir='))?.slice(6) || path.join(__dirname, '..', 'tests'));
const SHARED_READERS = ['_authRouteSource', '_adminSplitSource'];

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEVER = '(?!)';

/** Names of file-level helpers that read source text, and of the file-level constants they fill. */
function sourceNames(text) {
  const readers = new Set();
  for (const helper of SHARED_READERS) {
    for (const m of text.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*require\\('\\./${helper}'\\)`, 'g'))) {
      m[1].split(',').map(part => part.trim().split(':').pop().trim()).filter(Boolean).forEach(name => readers.add(name));
    }
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const decl = lines[i].match(/^(?:async\s+)?(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=)/);
    if (!decl) continue;
    const body = [];
    for (let j = i; j < Math.min(lines.length, i + 25); j += 1) {
      body.push(lines[j]);
      if (j > i && /^[})]/.test(lines[j])) break;
      if (j === i && /;\s*$/.test(lines[j])) break;
    }
    const joined = body.join('\n');
    if (/readFileSync/.test(joined) && !/fixture/i.test(joined) && !/\.json['"`]/.test(joined)) readers.add(decl[1] || decl[2]);
  }
  const vars = new Set();
  for (const m of text.matchAll(/^(?:const|let)\s+(\w+)\s*=\s*([^\n]*)/gm)) {
    const rhs = m[2];
    if (/readFileSync/.test(rhs) && !/fixture/i.test(rhs) && !/\.json/.test(rhs)) vars.add(m[1]);
    else if ([...readers].some(name => new RegExp(`\\b${name}\\s*\\(`).test(rhs))) vars.add(m[1]);
  }
  return { readers: [...readers], vars: [...vars] };
}

function blocks(text) {
  const starts = [];
  const re = /^[ \t]*(?:test|it)(?:\.(?:skip|todo|only))?\(/gm;
  let m;
  while ((m = re.exec(text))) starts.push(m.index);
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
}

function pinsSource(block, fileReaders, fileVars) {
  const readerAlternatives = ['readFileSync', ...fileReaders.map(escape)].join('|');
  const readerCall = new RegExp(`(?:${readerAlternatives})\\s*\\(`);
  const subjects = new Set(fileVars);
  // names filled inside the test from a reader or from another source name (three passes: a slice of a slice counts)
  for (let pass = 0; pass < 3; pass += 1) {
    for (const m of block.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*([^;]*?);/gs)) {
      const rhs = m[2];
      if (/fixture/i.test(rhs) || /\.json['"`]/.test(rhs)) continue;
      if (readerCall.test(rhs) || [...subjects].some(name => new RegExp(`\\b${escape(name)}\\b`).test(rhs))) subjects.add(m[1]);
    }
  }
  const names = [...subjects].map(escape).join('|');
  const call = `(?:${readerAlternatives})\\s*\\(`;
  const subject = names ? `(?:${call}|[\\w.]*\\b(?:${names})\\b)` : call;
  const asserted = [
    new RegExp(`\\b(?:match|doesNotMatch)\\(\\s*${subject}`),
    new RegExp(`${names ? `\\b(?:${names})\\b[^;\\n]*` : NEVER}\\.(?:includes|indexOf)\\(`),
    new RegExp(`\\.test\\(\\s*[^)\\n]*${names ? `\\b(?:${names})\\b` : NEVER}`),
    new RegExp(`${call}[^\\n]*\\)\\.(?:includes|match)\\(`),
  ];
  return asserted.some(pattern => pattern.test(block));
}

const WALL_CLOCK = /new Date\(\)|Date\.now\(\)/;
const FROZEN = /mock\.timers|mock\.method\(\s*Date|\bnow\s*[:=,)]|\btoday\s*[:=,)]/;

/** A block without its comments: a `new Date()` mentioned in a comment is not a clock read. */
const noComments = block => block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (all, lead) => lead);

function analyse(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  const names = sourceNames(text);
  let tests = 0; let pinned = 0; let clock = 0;
  for (const block of blocks(text)) {
    tests += 1;
    const code = noComments(block);
    if (pinsSource(block, names.readers, names.vars)) pinned += 1;
    if (WALL_CLOCK.test(code) && !/mock\.timers|mock\.method\(\s*Date/.test(text) && !FROZEN.test(code.replace(/Date\.now\(\)/g, ''))) clock += 1;
  }
  return { file, tests, pinned, clock };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const rows = fs.readdirSync(DIR).filter(name => name.endsWith('.test.js')).map(analyse);
  const total = rows.reduce((sum, row) => ({
    files: sum.files + 1, tests: sum.tests + row.tests, pinned: sum.pinned + row.pinned, clock: sum.clock + row.clock,
    pinnedFiles: sum.pinnedFiles + (row.pinned ? 1 : 0), clockFiles: sum.clockFiles + (row.clock ? 1 : 0),
  }), { files: 0, tests: 0, pinned: 0, clock: 0, pinnedFiles: 0, clockFiles: 0 });
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
