#!/usr/bin/env node
/**
 * Money that reaches a screen as a string.
 *
 * The MySQL pool deliberately does not set `decimalNumbers` — flipping it would
 * change the wire type of every money value in 778 routes at once, with nothing
 * testing the driver. The consequence is local and sharp: mysql2 hands back
 * every DECIMAL column as a string, so a screen that adds two of them is doing
 * string concatenation. "0.00" + "150.00" is "0.00150.00", which is NaN the
 * moment anything compares it, and `.toLocaleString()` on a string returns the
 * string unchanged — so nothing throws and a run total prints as
 * "09500.008000.00".
 *
 * Two screens were already caught this way: the payroll payslip table, whose
 * deductions column read «—» against a real 650 EGP deduction, and the expenses
 * list, whose «المجموع» printed "025000.008000.00" and whose category shares
 * came out NaN%.
 *
 * This finds the rest. For every route that ships a row to a browser, it reads
 * the SELECT, resolves each named column against api/schema.sql, and reports
 * the DECIMAL ones — unless the handler runs the row through toNumbers() or
 * Number() first.
 *
 * A report here is a candidate, not a defect: the screen may only display the
 * value, and a displayed string is fine. What matters is whether the screen
 * does arithmetic on it. The output names the endpoint so that can be checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = path.join(ROOT, 'api', 'routes');
const SCHEMA = path.join(ROOT, 'api', 'schema.sql');

// ── Which columns are DECIMAL, per table ────────────────────────────────────
const schema = fs.readFileSync(SCHEMA, 'utf8');
const decimalColumns = new Map();   // table -> Set(column)
const everyDecimalColumn = new Set();
{
  const tableRe = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\) ENGINE/g;
  let match;
  while ((match = tableRe.exec(schema)) !== null) {
    const [, table, body] = match;
    const columns = new Set();
    const colRe = /^\s*`([^`]+)`\s+decimal\(/gim;
    let col;
    while ((col = colRe.exec(body)) !== null) {
      columns.add(col[1]);
      everyDecimalColumn.add(col[1]);
    }
    if (columns.size) decimalColumns.set(table, columns);
  }
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(ROUTES);

const findings = [];
let handlersScanned = 0;
let handlersShippingRows = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const routeRe = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
  let route;
  const starts = [];
  while ((route = routeRe.exec(source)) !== null) {
    starts.push({ index: route.index, method: route[1].toUpperCase(), path: route[3] });
  }
  for (let i = 0; i < starts.length; i += 1) {
    const body = source.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : source.length);
    handlersScanned += 1;

    // Only rows shipped WITHOUT a mapper. A handler that maps is choosing each
    // field by hand, and every one of those checked converted its money on the
    // way out — flagging them buried the real cases in noise. A `...row` spread
    // keeps the raw row, so it counts as raw.
    const shipsRaw = /res\.json\(\s*rows\s*\)/.test(body)
      || /res\.json\(\s*\{[^}]*\brows\b[^}]*\}\s*\)/.test(body)
      || /\.\.\.row\b/.test(body);
    if (!shipsRaw) continue;
    handlersShippingRows += 1;

    // Already converted? toNumbers() or an explicit Number() on the money.
    const converts = /toNumbers\s*\(/.test(body);

    // Columns named in the OUTER select list only. A DECIMAL that appears
    // solely inside a subquery is aliased before it leaves — hr/reports counts
    // SUM(commission_amount) as `commission` — and reporting it says nothing
    // about what the browser receives.
    const outer = body
      .replace(/\(\s*\n?\s*SELECT[\s\S]*?\n\s*\)\s*[a-z]?\s*ON\b/gi, ' ')   // derived tables
      .replace(/\(\s*SELECT[\s\S]*?\)\s*(?:AS\s+)?[a-z_]*/gi, ' ');          // scalar subqueries
    const selectList = (outer.match(/SELECT([\s\S]*?)FROM/i) || [, ''])[1];
    const named = new Set();
    for (const word of selectList.match(/[a-z_][a-z0-9_]*/gi) || []) {
      if (everyDecimalColumn.has(word)) named.add(word);
    }
    // A wildcard ships whatever the table has, decimals included.
    const wildcardTable = (outer.match(/SELECT\s+(?:[a-z]+\.)?\*[\s\S]*?FROM\s+`?([a-z_]+)`?/i) || [])[1];
    if (wildcardTable && decimalColumns.has(wildcardTable)) {
      for (const column of decimalColumns.get(wildcardTable)) named.add(column);
    }
    if (!named.size) continue;

    // Drop the ones this handler explicitly converts: Number(row.x), parseFloat(x).
    const shipped = [...named].filter(column => {
      if (converts) return false;
      const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const converted = new RegExp(`(?:Number|parseFloat)\\(\\s*[a-z_.]*\\b${escaped}\\b`, 'i');
      return !converted.test(body);
    });
    if (!shipped.length) continue;

    findings.push({
      where: path.relative(ROOT, file).replace(/\\/g, '/'),
      route: `${starts[i].method} ${starts[i].path}`,
      columns: shipped.sort(),
    });
  }
}

console.log(`DECIMAL columns in the schema: ${everyDecimalColumn.size} distinct, across ${decimalColumns.size} tables`);
console.log(`route handlers read: ${handlersScanned}`);
console.log(`of those, handing rows to a browser: ${handlersShippingRows}`);
console.log(`of those, shipping an unconverted DECIMAL: ${findings.length}`);
console.log('');
for (const finding of findings.sort((a, b) => b.columns.length - a.columns.length)) {
  console.log(`  ${finding.route}`);
  console.log(`      ${finding.where} — ${finding.columns.join(', ')}`);
}
if (!findings.length) console.log('  (none)');
