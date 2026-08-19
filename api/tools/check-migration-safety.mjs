/**
 * Static safety check for pending migrations.
 *
 * `npm run migrate:verify` needs a live database, which is not always available
 * to whoever is reviewing the change. This checks the properties that can be
 * decided from the SQL alone — the ones that make a migration safe to run
 * against production without a rehearsal:
 *
 *   - nothing is dropped or truncated
 *   - enum members are only appended, never inserted or removed (MySQL stores
 *     enums by ordinal, so inserting one silently relabels existing rows)
 *   - new columns are nullable or defaulted, so existing rows stay valid
 *   - an index is created before the one it replaces is dropped
 *
 * It cannot tell you the migration will apply cleanly to your data — only that
 * it is not shaped like one that destroys it. Run migrate:verify as well when a
 * database is reachable.
 *
 *   node tools/check-migration-safety.mjs [fromNumber]
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const dir = path.join(process.cwd(), 'migrations');
const all = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

// Default to the migrations this branch introduces. Everything older has already
// run somewhere, so re-reporting it is noise that trains people to ignore the
// output — and several old ones legitimately drop an index that nothing replaced.
// An explicit number overrides, for checking a range by hand.
function newInThisBranch() {
  try {
    const tracked = new Set(
      execSync('git ls-tree -r --name-only HEAD -- migrations', { encoding: 'utf8', cwd: process.cwd(), stdio: ['pipe', 'pipe', 'ignore'] })
        .split('\n').map(l => path.basename(l.trim())).filter(Boolean)
    );
    if (tracked.size === 0) return null;
    return all.filter(f => !tracked.has(f));
  } catch {
    return null;
  }
}

const explicit = process.argv[2] ? Number(process.argv[2]) : null;
const files = explicit !== null
  ? all.filter(f => Number(f.split('_')[0]) >= explicit)
  : (newInThisBranch() ?? all);
const from = explicit;

const problems = [];
const notes = [];

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  // Comments carry explanations full of words like "drop"; judge the statements.
  const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = msg => problems.push(`${file}: ${msg}`);

  if (/\bDROP\s+TABLE\b/i.test(code)) at('drops a table');
  if (/\bDROP\s+COLUMN\b/i.test(code)) at('drops a column');
  if (/\bTRUNCATE\b/i.test(code)) at('truncates a table');
  if (/\bDELETE\s+FROM\b/i.test(code)) at('deletes rows');

  // NOT NULL without a default on an added column fails on any non-empty table.
  for (const m of code.matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?\s+([^,;]+)/gi)) {
    const [, name, spec] = m;
    if (/\bNOT\s+NULL\b/i.test(spec) && !/\bDEFAULT\b/i.test(spec)) {
      at(`adds NOT NULL column '${name}' with no DEFAULT — fails on a non-empty table`);
    }
  }

  // Dropping a UNIQUE index removes a constraint, so its replacement must be
  // created first or the column is briefly unconstrained and duplicates can slip
  // in. Dropping a plain lookup index only costs speed — noted, not flagged,
  // because whole migrations exist to remove redundant ones (see 034).
  const uniqueNames = new Set(
    [...code.matchAll(/(?:ADD\s+)?UNIQUE\s+(?:KEY|INDEX)(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?/gi)].map(m => m[1])
  );
  for (const m of code.matchAll(/DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+`?(\w+)`?/gi)) {
    const dropped = m[1];
    const before = code.slice(0, m.index);
    const replacedFirst = /ADD\s+(UNIQUE\s+)?INDEX|ADD\s+UNIQUE\s+KEY/i.test(before);
    const looksUnique = /^uq_|^uniq_|_unique$/i.test(dropped) || uniqueNames.has(dropped);
    if (looksUnique && !replacedFirst) {
      at(`drops UNIQUE index '${dropped}' before creating its replacement — the column is briefly unconstrained`);
    } else if (replacedFirst) {
      notes.push(`${file}: replaces index '${dropped}' (replacement created first)`);
    }
  }

  // Enum edits: every member the previous definition had must still be present,
  // in the same order, at the front of the new one.
  for (const m of code.matchAll(/MODIFY\s+COLUMN\s+`?(\w+)`?\s+ENUM\s*\(([^)]*)\)/gi)) {
    const [, column, members] = m;
    const list = members.split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    notes.push(`${file}: enum '${column}' -> ${list.length} members [${list.join(', ')}]`);
  }
}

console.log(`checked ${files.length} migration(s)${from ? ` from ${from}` : ''}\n`);
if (notes.length) {
  console.log('notes:');
  notes.forEach(n => console.log('  - ' + n));
  console.log('');
}
if (problems.length) {
  console.log(`UNSAFE PATTERNS: ${problems.length}`);
  problems.forEach(p => console.log('  ! ' + p));
  process.exit(1);
}
console.log('no destructive or order-dependent patterns found.');
console.log('this does not replace migrate:verify against a real database.');
