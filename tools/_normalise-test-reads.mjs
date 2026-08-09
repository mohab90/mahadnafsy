// One-shot: make every test-local read() helper CRLF-safe.
//
// Contract tests locate a region of a source file with indexOf() on multi-line
// landmarks written with \n. The repo checks out CRLF, so those landmarks never
// match, indexOf() returns -1, and slice(-1,-1) yields ''. assert.match then
// fails loudly (one test did) but assert.doesNotMatch passes VACUOUSLY against
// the empty string — a guard that silently tests nothing. Normalising the read
// is the single change that fixes every such helper at once.
//
// Only the readFileSync(...) call is rewritten. Each file's own base path
// (__dirname/'..' vs a local `root` vs an `admin()` helper) is left untouched:
// a previous blanket regex over the whole line rewrote those paths too and broke
// three files.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTS = new URL('../api/tests/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Literal source text to append. Written with doubled backslashes so the FILE
// receives the two characters \ and r, not a carriage return.
const SUFFIX = ".replace(/\\r\\n/g, '\\n')";

let changed = 0;
let already = 0;

for (const name of readdirSync(TESTS)) {
  if (!name.endsWith('.test.js')) continue;
  const path = join(TESTS, name);
  const src = readFileSync(path, 'utf8');

  // Match only the read-helper's readFileSync(...) call, up to its 'utf8' arg.
  const RE = /(const read = [^\n]*?fs\.readFileSync\([^\n]*?'utf8'\))/g;
  if (!RE.test(src)) continue;
  RE.lastIndex = 0;

  if (/const read = [^\n]*'utf8'\)\s*\.replace\(/.test(src)) { already++; continue; }

  const out = src.replace(RE, (_m, call) => call + SUFFIX);
  if (out === src) continue;
  writeFileSync(path, out);
  changed++;
}

console.log(`normalised: ${changed}`);
console.log(`already normalised: ${already}`);
