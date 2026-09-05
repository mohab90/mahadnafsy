// Which site-content keys does the admin read, and do they exist?
//
// The branch dropdown in the booking dialog was empty because it parsed
// content['institute.branches'] and that key is not present on the live
// tenant. Nothing failed loudly: JSON.parse('[]') of a missing key is a valid
// empty list, so the select rendered with only its placeholder and the field
// stayed required and unfillable.
//
// Any other key read the same way has the same failure mode, so this lists
// them all. Compare the output against /api/admin/content to see which are
// missing.
//
//   node tools/content-key-scan.mjs           # list the keys
//   node tools/content-key-scan.mjs --json    # machine-readable
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const AS_JSON = process.argv.includes('--json');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

const READ = /content\[\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\]/g;
// Keys whose value is parsed as a list — these are the ones that go silently
// empty rather than visibly undefined.
const PARSED = /JSON\.parse\(\s*content\[\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\]/g;

const keys = new Map();
const parsedAsList = new Set();
for (const file of walk(join(ROOT, 'admin'))) {
  const src = readFileSync(file, 'utf8');
  const rel = file.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
  for (const m of src.matchAll(READ)) {
    if (!keys.has(m[1])) keys.set(m[1], new Set());
    keys.get(m[1]).add(rel);
  }
  for (const m of src.matchAll(PARSED)) parsedAsList.add(m[1]);
}

const rows = [...keys.entries()]
  .map(([key, files]) => ({ key, parsedAsList: parsedAsList.has(key), readers: [...files] }))
  .sort((a, b) => Number(b.parsedAsList) - Number(a.parsedAsList) || a.key.localeCompare(b.key));

if (AS_JSON) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  console.log(`content keys read by the admin: ${rows.length}`);
  console.log(`of those, parsed as a list (fail silently when missing): ${rows.filter(r => r.parsedAsList).length}\n`);
  for (const r of rows) {
    console.log(`${r.parsedAsList ? 'LIST ' : '     '}${r.key.padEnd(34)} ${r.readers.length} reader(s)`);
  }
}
if (rows.length < 5) {
  console.error('\nWARNING: almost nothing matched — the scan is not reading the admin');
  process.exitCode = 1;
}
