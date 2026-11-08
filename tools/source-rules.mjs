#!/usr/bin/env node
/**
 * source-rules.mjs — the few rules that are a property of the SOURCE and that no call can reach: something that must not be written, or two lists
 * in two files that must name the same things. They used to be unit tests that read a file and matched a regular expression, and broke whenever the
 * code moved with nothing changed for anyone; they are held here instead, by the quality gate (check 29), where a failure stops a release the same way.
 *
 * A rule: { id, why, files, mustNot?, must?, custom? }
 *   files   — exact repo paths, or { dir, ext: [...] } for every file under a folder
 *   mustNot — regular expressions no file may match            must — regular expressions every file has to match
 *   custom  — (read, list) => [message] for a rule that compares files; list(dir, ext) gives every file under api/<dir> as a repo path
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
  {
    id: 'every-plan-writer-rewrites-its-rows',
    why: "installment_entries (migration 369) copies the plans' JSON arrays and stays true only while every writer of a plan rewrites it with syncPlanEntries in the same file",
    files: { dir: 'api', ext: ['.js'] },
    custom: (read, list) => {
      const out = []; const writers = [];
      for (const file of [...list('api/routes'), ...list('api/lib')].filter(name => !name.endsWith('installmentEntries.js'))) {
        const source = read(file);
        const writes = (source.match(/(INSERT INTO installment_plans|UPDATE installment_plans|DELETE FROM installment_plans)/g) || []).length;
        if (!writes) continue;
        writers.push(file.replace(/^api\//, ''));
        const syncs = (source.match(/syncPlanEntries\(/g) || []).length;
        if (syncs < writes) out.push(`${file} writes a plan ${writes} time(s) and rewrites its rows ${syncs} time(s)`);
      }
      const known = ['lib/planEntryPayment.js', 'lib/planFollowsMoney.js', 'routes/installments.js'];
      for (const file of writers) if (!known.includes(file)) out.push(`${file} is a new writer of installment plans: add it to this rule once it rewrites the rows`);
      return out;
    },
  },
  {
    id: 'one-escapeHtml-in-the-api',
    why: 'nine copies of escapeHtml were nine answers to «is this page escaped»; api/lib/html.js is the only declaration',
    files: { dir: 'api', ext: ['.js'] },
    custom: (read, list) => [...list('api/routes'), ...list('api/lib'), ...list('api/middleware')]
      .filter(file => file !== 'api/lib/html.js' && /^const escapeHtml = |^function escapeHtml\b/m.test(read(file)))
      .map(file => `${file} declares its own escapeHtml: use api/lib/html.js`),
  },
  {
    id: 'every-payment-writer-writes-an-audit-row',
    why: 'a file that inserts into payments must also call logPaymentAudit, or the payments it makes can never be traced to who made them (production carried 165 of 296 untraceable)',
    files: { dir: 'api', ext: ['.js'] },
    custom: (read, list) => [...list('api/routes'), 'api/lib/orderPaymentConfirmation.js']
      .filter(file => /INSERT INTO payments/.test(read(file)) && !/logPaymentAudit/.test(read(file)))
      .map(file => `${file} inserts payments and never writes a payment audit row`),
  },
];

// Rules that were unit tests reading an infrastructure file (a deploy script, a migration, a tool) or only forbidding something. tools/source-rules.json holds
// them as data: { id, why, checks: [{ file, must | mustNot: { source, flags }, code?, absent? }] } — `code` matches against the file without its comments.
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
for (const entry of JSON.parse(readFileSync(join(ROOT, 'tools', 'source-rules.json'), 'utf8'))) {
  if (entry.scan) {
    // A scan: every file under the folders is read without its comments and must not match any `mustNot`; `minFiles` proves the scan is reading the tree, so an empty
    // result means something. `skipSuffix` leaves out the one file that is allowed to do the forbidden thing.
    const { dirs, exts, skipSuffix = [], mustNot, minFiles = 1 } = entry.scan;
    RULES.push({
      id: entry.id, why: entry.why, files: dirs.map(dir => ({ dir, ext: exts })),
      custom: (read, list) => {
        const files = dirs.flatMap(dir => list(dir, exts)).filter(file => !skipSuffix.some(suffix => file.endsWith(suffix)));
        const out = files.length < minFiles ? [`only ${files.length} files scanned (expected ${minFiles}+): the scan is not reading the tree`] : [];
        for (const file of files) {
          const code = withoutComments(read(file));
          for (const rule of mustNot) if (new RegExp(rule.source, rule.flags || '').test(code)) out.push(`${file}: ${rule.reason}`);
        }
        return out;
      },
    });
    continue;
  }
  RULES.push({
    id: entry.id, why: entry.why, files: [...new Set(entry.checks.map(check => check.file))],
    custom: read => entry.checks.flatMap(check => {
      let text;
      try { text = read(check.file); } catch { return check.absent ? [] : [`${check.file} is missing`]; }
      if (check.absent) return [`${check.file} exists again`];
      const body = check.code ? withoutComments(text) : text;
      if (check.must && !new RegExp(check.must.source, check.must.flags).test(body)) return [`${check.file} no longer matches /${check.must.source}/`];
      if (check.mustNot && new RegExp(check.mustNot.source, check.mustNot.flags).test(body)) return [`${check.file} matches /${check.mustNot.source}/, which it must not`];
      return [];
    }),
  });
}

/** Applies one rule to a reader `read(path) => text`; returns the violations as { rule, file, detail }. */
const listUnder = (dir, exts = ['.js']) => walk(join(ROOT, dir), exts).map(file => relative(ROOT, file).split(sep).join('/'));

export function checkRule(rule, read, listFiles = spec => (Array.isArray(spec) ? spec : listUnder(spec.dir, spec.ext)), list = listUnder) {
  const out = [];
  if (rule.custom) {
    for (const detail of rule.custom(read, list)) out.push({ rule: rule.id, file: Array.isArray(rule.files) ? rule.files.join(' + ') : rule.files.dir, detail });
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
