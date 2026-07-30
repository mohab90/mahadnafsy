#!/usr/bin/env node
/**
 * index-defeat-scan.mjs
 *
 * Guards a bug class that kept coming back: wrapping an INDEXED column in a
 * function inside WHERE/JOIN/HAVING. MySQL cannot use a plain index on
 * `f(col)`, so the query silently degrades to a full table scan. It stays
 * correct, so nothing fails — it just gets slower as the table grows, which is
 * exactly the failure mode that only shows up in production at scale.
 *
 * Real instances found and fixed in this codebase:
 *   LOWER(status) NOT IN (...)          -> status NOT IN (...)
 *   LOWER(email) = LOWER(?)             -> email = ?
 *   DATE(created_at) BETWEEN ? AND ?    -> created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
 *   MONTH(x)=? AND YEAR(x)=?            -> x >= monthStart AND x < nextMonthStart
 *
 * LOWER()/UPPER() on these columns is always redundant here: every text column
 * in the schema uses utf8mb4_unicode_ci, which is already case-insensitive.
 *
 * Usage: node tools/index-defeat-scan.mjs [--list]
 * Wired into tools/mahad-quality-check.mjs with a baseline that may shrink but
 * never grow.
 */
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Columns that carry an index (or are compared hot enough to matter).
const COLS = 'status|email|type|phone|client_code|created_at|updated_at|date|paid_at|issued_at|next_follow_up_date|start_date|sent_at';

// Case-SENSITIVE on purpose: SQL in this codebase is written in upper case, while
// JavaScript's `new Date(...)` is mixed case. Matching case-insensitively would
// flag every JS date construction as a SQL index defeat.
const PATTERNS = [
  { name: 'LOWER/UPPER on indexed column', re: new RegExp(String.raw`\b(?:LOWER|UPPER)\(\s*[a-z_]*\.?(?:${COLS})\s*\)`, 'g') },
  { name: 'DATE() on date column',         re: new RegExp(String.raw`\bDATE\(\s*[a-z_]*\.?(?:${COLS})\s*\)`, 'g') },
  { name: 'YEAR()/MONTH() on date column', re: new RegExp(String.raw`\b(?:YEAR|MONTH)\(\s*[a-z_]*\.?(?:${COLS})\s*\)\s*=`, 'g') },
];

// Bounded tables: a scan there is cheap and rewriting month arithmetic inside
// payroll CASE/JOIN clauses carries more risk than the scan costs.
const EXEMPT_FILE = /[\\/](tests|node_modules)[\\/]|hr[\\/](payroll|attendance|reports)\.js$/;

// Queries against headcount-bounded tables (~100 staff x 365 days) are exempt for
// the same reason: the scan is a few tens of thousands of rows at worst, while
// rewriting the month arithmetic risks salary/leave correctness.
const EXEMPT_LINE = /\b(attendance_logs|leaves|leave_requests|payroll_items|payroll_runs|staff_absences)\b/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const f of entries) {
    if (f === 'node_modules') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

export function scanIndexDefeats() {
  const hits = [];
  for (const file of [...walk(join(ROOT, 'api/routes')), ...walk(join(ROOT, 'api/lib'))]) {
    if (EXEMPT_FILE.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (const { name, re } of PATTERNS) {
      lines.forEach((line, i) => {
        re.lastIndex = 0;
        // A projection like `SELECT DATE(created_at) AS day ... GROUP BY day` is
        // not an index defeat — nothing is being filtered on the wrapped value.
        // Only WHERE/JOIN/HAVING comparisons cost an index.
        if (/^\s*(SELECT|,)?\s*(DATE|YEAR|MONTH|DATE_FORMAT)\([^)]*\)\s+AS\s/i.test(line)) return;
        if (/\bSELECT\b[^;]*\b(DATE|YEAR|MONTH)\([^)]*\)\s+AS\s/i.test(line)) return;
        // Look a few lines up/down for the queried table: the FROM clause is
        // usually not on the same line as the WHERE predicate.
        const context = lines.slice(Math.max(0, i - 8), i + 3).join('\n');
        if (EXEMPT_LINE.test(context)) return;
        const m = line.match(re);
        if (!m) return;
        for (const snippet of m) {
          hits.push({
            file: file.replace(ROOT, '').split('\\').join('/').replace(/^\//, ''),
            line: i + 1,
            pattern: name,
            snippet: snippet.trim(),
          });
        }
      });
    }
  }
  return hits;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('\\').join('/').replace(/^([A-Z]):/i, ''));
if (isMain) {
  const hits = scanIndexDefeats();
  if (process.argv.includes('--list')) {
    for (const h of hits) console.log(`${h.file}:${h.line}  [${h.pattern}]  ${h.snippet}`);
    console.log('');
  }
  console.log(`Index-defeating function wraps on indexed columns: ${hits.length}`);
  process.exit(hits.length ? 1 : 0);
}
