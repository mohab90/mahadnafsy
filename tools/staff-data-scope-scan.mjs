#!/usr/bin/env node
/**
 * Routes that read a customer's rows without narrowing them to the staff
 * member asking.
 *
 * A permission says *whether* an employee may open a screen. DATA_SCOPE says
 * *whose rows* they get: a sales rep is 'assigned_sales' — WHERE
 * assigned_sales_id = me — a collection officer is 'assigned_cs', a Daqqi
 * manager is 'branch:DAQQI'. The permission is enforced by middleware and is
 * hard to forget. The scope is enforced by the route remembering to call
 * leadScope() or resolveFinancialScope(), and is easy to.
 *
 * When it is forgotten the screen does not fail — it shows every customer in
 * the institute to someone entitled to a handful, which is the quietest
 * possible way to leak the whole book.
 *
 * tenant-scope-scan.mjs covers the tenant boundary and customer-idor-scan.mjs
 * the customer-facing side. Neither looks at this one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

/** Tables whose rows belong to a particular employee's book of business. */
const SCOPED_TABLES = /\bFROM\s+(leads|subscribers|payments|orders|consultations|installment_plans)\b/i;

/** Any of the helpers that narrow a query to the caller's own rows. */
const APPLIES_SCOPE = /leadScope\(|resolveFinancialScope\(|financialScopeClause\(|financialRecordMatches\(|resolveDataScope\(|assigned_sales_id\s*=\s*\?|assigned_cs_id\s*=\s*\?|subscriberScope\(/;

/** Guards that mean the route is not reachable by a scoped role at all. */
const ADMIN_ONLY = /requireAdmin\b|requireSuperAdmin\b/;

const findings = [];
let adminRoutes = 0;
let readsScopedTable = 0;

for (const file of walk(path.join(ROOT, 'api', 'routes'))) {
  const source = codeOnly(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const declarations = [...source.matchAll(/router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'/g)];

  declarations.forEach((match, index) => {
    const start = match.index;
    const end = index + 1 < declarations.length ? declarations[index + 1].index : source.length;
    const body = source.slice(start, end);
    const route = `${match[1].toUpperCase()} ${match[2]}`;
    if (!match[2].startsWith('/api/admin')) return;
    adminRoutes += 1;

    // Only reads. A write is narrowed by the id it is given and by its own
    // ownership checks, which is a different question.
    if (match[1] !== 'get') return;
    if (!SCOPED_TABLES.test(body)) return;
    readsScopedTable += 1;

    // requireAdmin means no scoped role can reach it.
    if (ADMIN_ONLY.test(body.slice(0, 400))) return;
    if (APPLIES_SCOPE.test(body)) return;

    const permission = /requirePermission\('([a-z_]+)'\)/.exec(body.slice(0, 400));
    const table = SCOPED_TABLES.exec(body);
    findings.push({
      at: `${rel}:${source.slice(0, start).split('\n').length}`,
      route,
      permission: permission ? permission[1] : '(none named)',
      table: table ? table[1] : '?',
    });
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ adminRoutes, readsScopedTable, findings }));
  process.exit(0);
}

console.log(`admin routes: ${adminRoutes}`);
console.log(`of those, GETs reading a per-employee table: ${readsScopedTable}`);
console.log(`of those, reachable by a scoped role without narrowing: ${findings.length}`);
console.log('');
for (const f of findings) {
  console.log(`  ${f.route}`);
  console.log(`      ${f.at} — reads ${f.table}, opens on ${f.permission}`);
}
console.log('');
console.log('Candidates. A route may narrow by something this cannot see — a');
console.log('subquery, a helper called through a variable — so read each one.');
