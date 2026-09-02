#!/usr/bin/env node
/**
 * Queries that filter one table's deleted rows and forget another's.
 *
 * Three conventions live side by side here — payments.deleted_at,
 * subscribers.deleted_at, leads.hidden — and mixing them is not a style point.
 * The ledger balance check summed paid payments without excluding soft-deleted
 * ones while the journal side counted entries by ref, so its two halves
 * described different populations and it reported the books unbalanced by
 * 1,022.95 EGP every day. 23 rows worth 50,561 EGP were the whole difference.
 *
 * The rule: if a statement already proves it knows about soft deletion — it
 * filters at least one of these tables — then every one of these tables it
 * touches must be filtered too. A query that filters none is not flagged: it
 * may legitimately be counting everything, and flagging those would bury the
 * real findings under hundreds of deliberate ones.
 *
 * Usage: node tools/soft-delete-scan.mjs [--list]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// table -> how a query says "not deleted" for it.
//
// leads carries both: `hidden` is what the app's delete button sets and what
// every list filters, and `deleted_at` exists on the table as well. Either one
// counts as the query having thought about it — treating only `hidden` as valid
// reported six false positives on queries that were already correct, and a scan
// with false positives is one people learn to skip.
const CONVENTION = {
  payments: /deleted_at\s+IS\s+NULL/i,
  subscribers: /deleted_at\s+IS\s+NULL/i,
  leads: /\bhidden\s*=\s*0\b|deleted_at\s+IS\s+NULL/i,
};

// Comments come out before the SQL is judged. A template literal here often
// carries prose above the statement, and matching a table name inside an
// explanation is how a scan invents work for itself.
const stripSqlComments = sql => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*(\/\/|--).*$/gm, ' ');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => file.endsWith('.js'));
}

/** Template literals and plain strings that look like SQL touching these tables. */
function statementsIn(source) {
  const found = [];
  for (const match of source.matchAll(/`([^`]*(?:FROM|JOIN|UPDATE)[^`]*)`/gi)) {
    const sql = stripSqlComments(match[1]);
    if (!/\b(FROM|JOIN|UPDATE)\s+(payments|subscribers|leads)\b/i.test(sql)) continue;
    // The literal has to *begin* as a statement. A backtick inside a comment
    // makes the pairing slip, and the match then runs from the middle of some
    // prose into unrelated code — which is where the remaining false positives
    // came from, not from the queries they named.
    if (!/^\s*(SELECT|UPDATE|INSERT|DELETE|WITH)\b/i.test(sql)) continue;
    found.push({ sql, index: match.index });
  }
  return found;
}

export function scanSoftDeleteMixes() {
  const mixes = [];
  let statementsExamined = 0;

  for (const file of [...walk(join(ROOT, 'api/routes')), ...walk(join(ROOT, 'api/lib'))]) {
    const source = readFileSync(file, 'utf8');
    for (const { sql, index } of statementsIn(source)) {
      const touched = Object.keys(CONVENTION)
        .filter(table => new RegExp(`\\b(FROM|JOIN|UPDATE)\\s+${table}\\b`, 'i').test(sql));
      if (touched.length < 2) continue;
      statementsExamined += 1;

      const filtered = touched.filter(table => CONVENTION[table].test(sql));
      // Only a statement that already filters something is judged. One that
      // filters nothing is counting everything on purpose.
      if (!filtered.length || filtered.length === touched.length) continue;

      mixes.push({
        file: relative(ROOT, file).split('\\').join('/'),
        line: source.slice(0, index).split('\n').length,
        touched, filtered,
        missing: touched.filter(table => !filtered.includes(table)),
        snippet: sql.replace(/\s+/g, ' ').trim().slice(0, 130),
      });
    }
  }
  return { statementsExamined, mixes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { statementsExamined, mixes } = scanSoftDeleteMixes();
  if (process.argv.includes('--list')) {
    for (const m of mixes) {
      console.log(`${m.file}:${m.line}`);
      console.log(`   touches ${m.touched.join(' + ')}, filters only ${m.filtered.join(' + ')} — missing ${m.missing.join(', ')}`);
      console.log(`   ${m.snippet}…`);
    }
  }
  console.log(`soft-delete-scan: ${mixes.length} of ${statementsExamined} multi-table statement(s) filter one table's deleted rows and not another's`);
  if (mixes.length) process.exitCode = 1;
}
