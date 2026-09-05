// Files nothing imports.
//
// Not the same question as "screens no menu reaches" — duplicate-component-scan
// answers that, and its list names components that are very much alive under a
// different key (FaqManagerTab is drawn by service_hub, HrTab by hr). Deleting
// on that list removes working features. This asks the narrower, safer
// question: is there any file that no other file mentions at all?
//
// Entry points are excluded by name, since nothing imports an entry point.
//
//   node tools/orphan-module-scan.mjs
//   node tools/orphan-module-scan.mjs --list
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, basename, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const VERBOSE = process.argv.includes('--list');

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'build', 'coverage']);

// Nothing imports these, by design.
const ENTRY = [
  /^server\.js$/, /^index\.(t|j)sx?$/, /^App\.tsx$/, /^main\.tsx$/,
  /^vite\.config\./, /^tailwind\.config\./, /^postcss\.config\./,
  /^eslint\./, /\.eslintrc\./, /^watchdog\./, /^kill-port\./,
  /\.test\.(t|j)s$/, /\.spec\.ts$/, /\.d\.ts$/,
];

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

const AREAS = ['api', 'admin', 'client', 'tools', 'e2e'];
const files = AREAS.flatMap(area => walk(join(ROOT, area)));

// One pass over every file's text; a module is referenced if its basename
// appears in any other file. Deliberately loose — a name mentioned in a comment
// or a dynamic import still counts as referenced, because the cost of a false
// "orphan" (deleting live code) is far higher than the cost of missing one.
const corpus = new Map();
for (const file of files) {
  try { corpus.set(file, readFileSync(file, 'utf8')); } catch { /* unreadable */ }
}

const orphans = [];
for (const file of files) {
  const name = basename(file);
  if (ENTRY.some(rx => rx.test(name))) continue;
  const stem = name.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  let referenced = false;
  for (const [other, text] of corpus) {
    if (other === file) continue;
    if (text.includes(stem)) { referenced = true; break; }
  }
  if (!referenced) {
    let bytes = 0;
    try { bytes = statSync(file).size; } catch { /* gone */ }
    orphans.push({ file: relative(ROOT, file).split(sep).join('/'), bytes });
  }
}

orphans.sort((a, b) => b.bytes - a.bytes);
const totalKb = Math.round(orphans.reduce((sum, o) => sum + o.bytes, 0) / 1024);
console.log(`scanned ${files.length} source files across ${AREAS.join(', ')}`);
console.log(`no other file mentions: ${orphans.length} (${totalKb} KB)`);
if (orphans.length && (VERBOSE || orphans.length <= 40)) {
  for (const o of orphans) console.log(`  ${String(Math.round(o.bytes / 1024)).padStart(5)} KB  ${o.file}`);
}
if (files.length < 500) {
  console.log('\nWARNING: fewer files scanned than expected — the walk is not reading the tree');
  process.exitCode = 1;
}
