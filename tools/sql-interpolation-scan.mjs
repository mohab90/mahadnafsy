#!/usr/bin/env node
/**
 * SQL built by pasting a value into the string instead of binding it.
 *
 * Placeholders are safe; `${...}` inside a query is only safe when what it
 * carries is a placeholder list, a column name the code chose from a fixed set,
 * or a number the code produced. Anything reaching it from a request is an
 * injection.
 *
 * Reports every interpolation with the expression it carries, so each can be
 * judged. Interpolations that are plainly a generated placeholder list are
 * filtered out — they are the common safe idiom in this codebase and would
 * otherwise drown the real ones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
for (const top of ['api/routes', 'api/lib', 'api/middleware']) {
  const start = path.join(ROOT, top);
  if (!fs.existsSync(start)) continue;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(start);
}

// Expressions that cannot carry attacker text.
const SAFE = [
  /^\s*placeholders?\s*$/i,
  /map\(\(\)\s*=>\s*'\?'\)/,          // ['?','?'].join(',')
  /\.join\(\s*','\s*\)\s*$/,           // a joined placeholder list
  /^\s*\w*(?:limit|offset|page|size|count|days|months|years|interval)\w*\s*$/i,
  /^\s*Number\(/,
  /^\s*parseInt\(/,
  /^\s*fields\.join\(/,
  /^\s*sets?\.join\(/,
  /^\s*updates\.join\(/,
  /^\s*visibility\.sql\s*$/,
  /^\s*\w*[Ss]cope\w*(?:\.sql)?\s*$/,
  /^\s*\w*[Cc]lause\w*\s*$/,
  /^\s*\w*[Ss]ql\w*\s*$/,
  /^\s*(?:alias|table|col|column|dir|order|direction)\w*\s*$/i,
];

let queries = 0;
const findings = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = src.split('\n');

  // Only templates actually handed to the driver. Matching anything that reads
  // like SQL swept up log lines and error messages — «Cannot ${action} quote»
  // is not a query, and reporting it trains the reader to skim.
  const re = /\.(?:query|execute)\(\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) {
    queries++;
    const sql = m[1];
    const interps = sql.match(/\$\{([^}]*)\}/g) || [];
    for (const raw of interps) {
      const expr = raw.slice(2, -1);
      if (SAFE.some((rule) => rule.test(expr))) continue;
      // Only an expression carrying request data can be an injection. Either it
      // names req. itself, or it names a variable this file assigned from req.
      const names = expr.match(/[A-Za-z_$][\w$]*/g) || [];
      const fromRequest = /\breq\b/.test(expr) || names.some((name) => {
        if (name.length < 3) return false;
        const assigned = new RegExp(
          '(?:const|let|var)\\s+(?:\\{[^}]*\\b' + name + '\\b[^}]*\\}|' + name + ')\\s*=\\s*[^;\\n]*req\\.'
        );
        return assigned.test(src);
      });
      if (!fromRequest) continue;
      const line = src.slice(0, m.index).split('\n').length;
      findings.push({ file: rel, line, expr: expr.trim().slice(0, 80), context: (lines[line - 1] || '').trim().slice(0, 100) });
    }
  }
}

console.log('sql-interpolation-scan: ' + queries + ' SQL template literal(s) across ' + files.length + ' files');
console.log('interpolations that are not an obvious placeholder list or number: ' + findings.length);
for (const found of findings) {
  console.log('  ' + found.file + ':' + found.line);
  console.log('      ${' + found.expr + '}');
}
