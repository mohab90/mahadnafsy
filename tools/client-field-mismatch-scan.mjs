#!/usr/bin/env node
/**
 * Customer screens reading a field the API never sends.
 *
 * The same class that broke the consultations and live-streams cards: the route
 * hands over a database row spelled in snake_case, the screen reads camelCase,
 * and the cast to the screen's own type means nothing complains. The field is
 * undefined and the card renders without it.
 *
 * This works from the screen's side instead of the route's: collect every
 * camelCase field each customer component reads off its data, then check
 * whether any route response, mapper or API client type ever produces that
 * name. A name nobody produces is either a bug or a field that was renamed and
 * the screen not updated.
 *
 * Reports candidates, not verdicts — a field can be produced somewhere this
 * cannot see. Read both sides before believing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir, test) {
  const out = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (test(entry.name)) out.push(full);
    }
  })(dir);
  return out;
}

// Everything the server side could possibly produce as a field name.
const serverFiles = [
  ...collect(path.join(ROOT, 'api', 'routes'), (n) => n.endsWith('.js')),
  ...collect(path.join(ROOT, 'api', 'lib'), (n) => n.endsWith('.js')),
];
const produced = new Set();
for (const file of serverFiles) {
  const src = fs.readFileSync(file, 'utf8');
  // `name:` in an object literal, and `AS name` / `AS \`name\`` in SQL.
  for (const m of src.matchAll(/(?:^|[,{[\s])([a-zA-Z_$][\w$]*)\s*:/gm)) produced.add(m[1]);
  for (const m of src.matchAll(/\bAS\s+`?([a-zA-Z_][\w]*)`?/gi)) produced.add(m[1]);
  // Plain column lists: SELECT a, b, c FROM
  for (const m of src.matchAll(/SELECT([\s\S]{0,600}?)FROM/gi)) {
    for (const col of m[1].split(',')) {
      const name = col.trim().replace(/^.*\./, '').replace(/`/g, '').split(/\s+/)[0];
      if (/^[a-zA-Z_][\w]*$/.test(name)) produced.add(name);
    }
  }
}
// Field names the client's own API layer declares in its response types.
const apiClient = fs.readFileSync(path.join(ROOT, 'client', 'lib', 'mysqlapi.ts'), 'utf8');
for (const m of apiClient.matchAll(/([a-zA-Z_$][\w$]*)\s*[?]?\s*:/g)) produced.add(m[1]);
// Everything the client's own types declare, since a locally-built object is
// not a mismatch.
const clientTypes = fs.readFileSync(path.join(ROOT, 'client', 'types.ts'), 'utf8');
for (const m of clientTypes.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*[?]?\s*:/gm)) produced.add(m[1]);

const IGNORE = new Set([
  'length', 'map', 'filter', 'find', 'slice', 'push', 'join', 'toLowerCase', 'toUpperCase',
  'trim', 'includes', 'split', 'replace', 'toFixed', 'toString', 'value', 'target', 'current',
  'props', 'children', 'style', 'className', 'key', 'ref', 'then', 'catch', 'sort', 'reduce',
  'some', 'every', 'forEach', 'indexOf', 'startsWith', 'endsWith', 'padStart', 'toLocaleString',
]);

const screens = collect(path.join(ROOT, 'client', 'components', 'student-dashboard'), (n) => n.endsWith('.tsx'))
  .concat(collect(path.join(ROOT, 'client', 'pages'), (n) => n.endsWith('.tsx')));

let readCount = 0;
const suspects = [];
for (const file of screens) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');
  // A camelCase field read off a variable that looks like a record from the API.
  const seen = new Set();
  for (const m of src.matchAll(/\b([a-z][\w]*)\.([a-z][a-zA-Z0-9]*[A-Z][\w]*)\b/g)) {
    const [, holder, field] = m;
    if (IGNORE.has(field) || seen.has(field)) continue;
    seen.add(field);
    readCount++;
    if (!produced.has(field)) suspects.push({ file: rel, holder, field });
  }
}

console.log('client-field-mismatch-scan: ' + screens.length + ' customer screens, ' + readCount + ' distinct field reads');
console.log('fields no route, mapper or declared type produces: ' + suspects.length);
const byFile = new Map();
for (const s of suspects) {
  if (!byFile.has(s.file)) byFile.set(s.file, []);
  byFile.get(s.file).push(s.holder + '.' + s.field);
}
for (const [file, fields] of byFile) {
  console.log('  ' + file);
  console.log('      ' + fields.join(', '));
}
