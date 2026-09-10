/**
 * Components declared inside other components.
 *
 * React compares element types by identity. A component defined in the body of
 * another gets a fresh function on every render, so React does not reconcile it
 * — it unmounts the old subtree and mounts a new one. Every input inside loses
 * focus and its cursor position on each keystroke, and every bit of local state
 * below it resets.
 *
 * Reported with the enclosing component and whether the nested one wraps an
 * input, textarea or select, which is where it is visible rather than merely
 * wasteful.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  path.join(HERE, '..', 'client'),
  path.join(HERE, '..', 'admin'),
];
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
};

const files = ROOTS.flatMap(root => walk(root));
const findings = [];
let scanned = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.dirname(ROOTS[0]), file).split(path.sep).join('/');
  const lines = src.split('\n');
  scanned += 1;

  lines.forEach((line, i) => {
    // A capitalised component declared at an indent — i.e. not at module scope.
    const m = line.match(/^(\s+)(?:const|function)\s+([A-Z]\w*)\s*(?::\s*React\.FC|[:=]?\s*\(|\s*=\s*\()/);
    if (!m) return;
    const indent = m[1].length;
    if (indent === 0) return;
    // Must actually return JSX to be a component.
    const body = lines.slice(i, i + 40).join('\n');
    if (!/=>\s*\(?\s*</.test(body) && !/return\s*\(?\s*</.test(body)) return;
    // Not a type alias or a plain object.
    if (/^\s+(?:const|let)\s+[A-Z]\w*\s*[:=]\s*\{/.test(line)) return;

    const scopeEnd = (() => {
      // Crude: to the end of the declaration's parenthesised body.
      let depth = 0; let started = false;
      for (let j = i; j < Math.min(lines.length, i + 200); j++) {
        for (const ch of lines[j]) {
          if (ch === '(' || ch === '{') { depth++; started = true; }
          else if (ch === ')' || ch === '}') depth--;
        }
        if (started && depth <= 0) return j;
      }
      return Math.min(lines.length - 1, i + 200);
    })();
    const nestedBody = lines.slice(i, scopeEnd + 1).join('\n');
    const holdsInput = /<(input|textarea|select)\b/.test(nestedBody);
    const holdsChildren = /\{\s*children\s*\}/.test(nestedBody);

    findings.push({
      at: `${rel}:${i + 1}`,
      name: m[2],
      holdsInput,
      holdsChildren,
    });
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned, findings }));
  process.exit(0);
}
console.log(`scanned ${scanned} .tsx files in client/ and admin/`);
console.log(`components declared inside another component: ${findings.length}`);
console.log('');
const loud = findings.filter(f => f.holdsInput || f.holdsChildren);
console.log(`of those, wrapping an input or {children} — where the remount is visible: ${loud.length}`);
for (const f of loud) {
  console.log(`   ${f.at}  ${f.name}${f.holdsInput ? '  [holds an input]' : ''}${f.holdsChildren ? '  [wraps children]' : ''}`);
}
console.log('');
console.log('the rest (re-created each render, but nothing focusable inside):');
for (const f of findings.filter(f => !f.holdsInput && !f.holdsChildren)) {
  console.log(`   ${f.at}  ${f.name}`);
}
