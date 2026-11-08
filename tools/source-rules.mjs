#!/usr/bin/env node
/**
 * source-rules.mjs — the few rules that are a property of the SOURCE and that no call can reach: something that must not be written, or two lists
 * in two files that must name the same things. They used to be unit tests that read a file and matched a regular expression, and broke whenever the
 * code moved with nothing changed for anyone; they are held here instead, by the quality gate (check 29), where a failure stops a release the same way.
 *
 * A rule: { id, why, files, mustNot?, must?, custom? }
 *   files   — exact repo paths, or { dir, ext: [...] } for every file under a folder
 *   mustNot — regular expressions no file may match            must — regular expressions every file has to match
 *   custom  — (read) => [message] for a rule that compares two files
 * Add a rule here only when no behaviour test can hold it. Tenant scoping of a query is held by check 14 (tenant-scope-scan), not here.
 *
 * Usage: node tools/source-rules.mjs        prints every violation, exit 1 when there is one
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const walk = (dir, exts, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.includes(extname(name))) out.push(full);
  }
  return out;
};

export const RULES = [
  {
    id: 'admin-api-path-has-no-prefix',
    why: 'mysqlAdmin adds the configured /api base itself; a path that already starts with /api reaches /api/api/… and answers 404',
    files: { dir: 'admin', ext: ['.ts', '.tsx'] },
    mustNot: [/mysqlAdmin\.admin(?:Get|Post|Put|Patch|Delete)(?:<[\s\S]{0,300}?>)?\(\s*[`'"]\/api\//],
  },
  {
    id: 'one-branch-currency-mapping',
    why: 'the currency a payment draft starts in comes from admin/lib/branchCurrency.ts (Saudi→SAR, abroad→USD, else EGP); a screen with its own ternary drifts',
    files: ['admin/pages/Dashboard.tsx', 'admin/pages/dashboard/DashboardQuickBooking.tsx', 'admin/pages/dashboard/tabs/LeadsTab.tsx', 'admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx'],
    mustNot: [/ONLINE_ABROAD[^\n]{0,100}\?\s*'SAR'/],
  },
  {
    id: 'every-financial-subtab-can-be-opened',
    why: 'the FinancialSubTab union says which screens exist and the strip says which can be opened; a leaf left out of the strip renders but nothing can reach it',
    files: ['admin/pages/dashboard/tabs/financial/financialTabUtils.ts', 'admin/pages/dashboard/tabs/financial/FinancialSubTabs.tsx'],
    custom: read => {
      const union = read('admin/pages/dashboard/tabs/financial/financialTabUtils.ts').match(/export type FinancialSubTab =([\s\S]*?);/)?.[1] || '';
      const declared = [...union.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
      if (declared.length < 20) return [`only ${declared.length} sub-tabs parsed from the union`];
      const reachable = new Set([...read('admin/pages/dashboard/tabs/financial/FinancialSubTabs.tsx').matchAll(/\[\s*'([a-z_]+)'\s*,\s*'/g)].map(match => match[1]));
      return [
        ...declared.filter(key => !reachable.has(key)).map(key => `sub-tab '${key}' renders but the strip never offers it`),
        ...[...reachable].filter(key => !declared.includes(key)).map(key => `the strip offers '${key}', which the union does not declare`),
      ];
    },
  },
];

/** Applies one rule to a reader `read(path) => text`; returns the violations as { rule, file, detail }. */
export function checkRule(rule, read, listFiles = spec => (Array.isArray(spec) ? spec : walk(join(ROOT, spec.dir), spec.ext).map(file => relative(ROOT, file).split(sep).join('/')))) {
  const out = [];
  if (rule.custom) {
    for (const detail of rule.custom(read)) out.push({ rule: rule.id, file: Array.isArray(rule.files) ? rule.files.join(' + ') : rule.files.dir, detail });
    return out;
  }
  for (const file of listFiles(rule.files)) {
    const text = read(file);
    for (const pattern of rule.mustNot || []) if (pattern.test(text)) out.push({ rule: rule.id, file, detail: `matches ${pattern}` });
    for (const pattern of rule.must || []) if (!pattern.test(text)) out.push({ rule: rule.id, file, detail: `does not match ${pattern}` });
  }
  return out;
}

export function scanSourceRules(rules = RULES) {
  const read = path => readFileSync(join(ROOT, path), 'utf8');
  return rules.flatMap(rule => checkRule(rule, read));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = scanSourceRules();
  for (const violation of violations) console.log(`${violation.rule}: ${violation.file} — ${violation.detail}`);
  console.log(`source rules: ${RULES.length} rules, ${violations.length} violation(s)`);
  process.exit(violations.length ? 1 : 0);
}
