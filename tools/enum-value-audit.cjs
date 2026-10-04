// String values written into ENUM columns, checked against what the column
// accepts. This is the shape of the visitor-reply outage: ticket_replies
// .author_type is ENUM('STAFF','CLIENT'), the route bound 'CUSTOMER', MySQL
// truncated it, and every reply a customer sent answered 500. The value is a
// bound parameter, so it is a plain string in a JavaScript array — no linter,
// no type, and no test that does not touch the database can see it is wrong.
//
// Two shapes are checked:
//   INSERT INTO t (a, b, c) VALUES (?,?,?)  with the parameter array that
//     follows — literals aligned to their column by position
//   col = 'X'  /  col IN ('X','Y')  written inline in the SQL
//
// Usage: node tools/enum-value-audit.cjs
//
// The enum definitions are read from api/migrations in numeric order: CREATE
// TABLE declares them, later ALTER ... MODIFY/CHANGE/ADD replace them, so the
// last statement to mention a column wins — the same order the database applied
// them in. Migrations are this project's exclusive schema authority (see
// api/server.js), so no database connection is needed.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIG = path.join(ROOT, 'api', 'migrations');

// ── enum columns ─────────────────────────────────────────────────────────────
const enums = new Map(); // "table.col" -> Set(values)
// Lower-cased: every table is utf8mb4_unicode_ci, so an ENUM compares without
// case — 'paid' is PAID — and only a value it has no spelling of at all fails.
const values = body => new Set([...body.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'").toLowerCase()));

const files = fs.readdirSync(MIG).filter(f => f.endsWith('.sql'))
  .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

// api/schema.sql first: it is the dump the baseline tables were created from,
// and tables that no migration creates (refund_requests among them) had no
// enum here at all — so a value their column refuses could not be reported.
// Migrations follow and replace what they change, in the order they ran.
for (const f of ['../schema.sql', ...files]) {
  const sql = fs.readFileSync(path.join(MIG, f), 'utf8');

  // CREATE TABLE <t> ( ... ) — one enum column per line is the house style.
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\s*\)\s*(?:ENGINE|;)/gi)) {
    const table = m[1];
    for (const c of m[2].matchAll(/^\s*`?(\w+)`?\s+ENUM\s*\(([^)]*)\)/gim)) {
      // CREATE TABLE IF NOT EXISTS never replaces a table that is there, so an
      // older migration's definition must not replace schema.sql's.
      if (!enums.has(`${table}.${c[1]}`)) enums.set(`${table}.${c[1]}`, values(c[2]));
    }
  }
  // ALTER TABLE <t> MODIFY/CHANGE/ADD ... ENUM(...) — replaces the earlier set.
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?\s+(?:MODIFY|CHANGE|ADD)\s+(?:COLUMN\s+)?`?(\w+)`?\s*(?:`?\w+`?\s+)?ENUM\s*\(([^)]*)\)/gi)) {
    enums.set(`${m[1]}.${m[2]}`, values(m[3]));
  }
}

// leads.status is a VARCHAR, so the database takes any spelling — the same
// typo an ENUM would refuse is stored silently and the lead drops out of every
// screen. Its vocabulary lives in api/lib/leadStatuses.js and is checked here
// as if it were an ENUM ('follow_up' and 'junk' are old values still in data).
{
  const statuses = require(path.join(ROOT, 'api', 'lib', 'leadStatuses.js'));
  enums.set('leads.status', new Set([...statuses.LEAD_STATUSES, ...statuses.TERMINAL_LEAD_STATUSES, 'follow_up']));
}

// An unqualified column is resolved against the tables of its own statement
// only. Resolving it against the whole schema instead — "this name is an enum
// somewhere, so treat every use of it as that enum" — reports `action` in a
// users query as the `action` of an audit table and buries the real findings.

// ── the API's writes ─────────────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// A statement can be written in any of the three string forms; support.js uses
// single quotes for the inserts and backticks for the multi-line selects.
//
// Each form is matched as the JavaScript string it is, quotes inside it
// included. The old pattern refused any string containing a quote of any kind
// — which is every statement with an inline literal, the very thing the check
// below looks for — so «SET status='REFUNDED'» was never read, and the column
// refused that value in production on every «تأكيد رد المبلغ».
const STRING_RE = /`((?:[^`\\]|\\[\s\S])*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
const SQL_WORD_RE = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i;
const sqlStrings = src => [...src.matchAll(STRING_RE)]
  .map(m => ({ sql: m[1] ?? m[2] ?? m[3], index: m.index }))
  .filter(({ sql }) => SQL_WORD_RE.test(sql));
const TABLE_RE = /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO)\s+`?([a-z_][a-z0-9_]*)`?(?:\s+(?:AS\s+)?`?([a-z][a-z0-9_]*)`?)?/gi;
const SQL_WORDS = new Set(['on', 'and', 'or', 'as', 'is', 'not', 'null', 'in', 'where', 'select', 'from', 'join',
  'left', 'right', 'inner', 'outer', 'group', 'by', 'order', 'limit', 'set', 'values', 'case', 'when', 'then',
  'else', 'end', 'asc', 'desc', 'union', 'all', 'exists', 'between', 'like', 'straight_join', 'use', 'force']);

const findings = [];
const report = (file, line, column, value, allowed, how) => {
  findings.push({ file: rel(file), line, column, value, allowed: [...allowed].join(','), how });
};

// lib/ writes as much as routes/ does (refunds, payments, leads).
for (const file of [...walk(path.join(ROOT, 'api', 'routes')), ...walk(path.join(ROOT, 'api', 'lib'))]) {
  const src = fs.readFileSync(file, 'utf8');

  // ── INSERT INTO t (cols) VALUES (?,?,…) followed by the parameter array ────
  for (const m of src.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/gi)) {
    const table = m[1];
    const cols = m[2].split(',').map(s => s.trim().replace(/`/g, ''));
    const slots = m[3].split(',').map(s => s.trim());
    if (slots.length !== cols.length || !slots.every(s => s === '?')) continue;

    // The parameter array is the next bracketed list after the statement.
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 1200);
    const arr = after.match(/\[([\s\S]*?)\]/);
    if (!arr) continue;
    // Split on top-level commas so a nested call keeps its own arguments.
    const parts = []; let depth = 0, cur = '';
    for (const ch of arr[1]) {
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    if (parts.length !== cols.length) continue;

    parts.forEach((raw, i) => {
      const lit = raw.trim().match(/^'([^']*)'$|^"([^"]*)"$/);
      if (!lit) return; // a variable — nothing to check statically
      const key = `${table}.${cols[i]}`;
      const allowed = enums.get(key);
      if (!allowed || allowed.has(String(lit[1] ?? lit[2]).toLowerCase())) return;
      report(file, lineOf(src, m.index), key, lit[1] ?? lit[2], allowed, 'INSERT');
    });
  }

  // ── col = 'X' and col IN ('X','Y') written inline ─────────────────────────
  // Only inside a statement, and only against that statement's own tables.
  for (const s of sqlStrings(src)) {
    const sql = s.sql;
    const line = lineOf(src, s.index);

    const alias = new Map(); // alias or table name -> table
    const inPlay = new Set();
    for (const f of sql.matchAll(TABLE_RE)) {
      const [, tbl, al] = f;
      inPlay.add(tbl);
      alias.set(tbl, tbl);
      if (al && !SQL_WORDS.has(al.toLowerCase())) alias.set(al, tbl);
    }
    if (!inPlay.size) continue;

    // Unqualified only resolves when exactly one table here declares it.
    const resolve = (qualifier, col) => {
      if (qualifier) {
        const tbl = alias.get(qualifier);
        return tbl && enums.has(`${tbl}.${col}`) ? `${tbl}.${col}` : null;
      }
      const hits = [...inPlay].filter(t => enums.has(`${t}.${col}`));
      return hits.length === 1 ? `${hits[0]}.${col}` : null;
    };

    // A value written by `SET col='X'` fails the statement; one compared in a
    // WHERE or an IN list only never matches. Both are reported, only the first
    // fails the run.
    const setClauses = [...sql.matchAll(/\bSET\b([\s\S]*?)(?=\bWHERE\b|$)/gi)].map(m => [m.index, m.index + m[0].length]);
    const inSet = index => setClauses.some(([from, to]) => index >= from && index < to);
    for (const m of sql.matchAll(/\b(?:(\w+)\.)?(\w+)\s*(?:=|<=>)\s*'([^']*)'/g)) {
      const key = resolve(m[1], m[2]);
      const allowed = key && enums.get(key);
      if (!allowed || allowed.has(m[3].toLowerCase())) continue;
      report(file, line, key, m[3], allowed, inSet(m.index) ? "SET col='x'" : "WHERE col='x'");
    }
    for (const m of sql.matchAll(/\b(?:(\w+)\.)?(\w+)\s+IN\s*\(\s*((?:'[^']*'\s*,?\s*)+)\)/gi)) {
      const key = resolve(m[1], m[2]);
      const allowed = key && enums.get(key);
      if (!allowed) continue;
      for (const v of [...m[3].matchAll(/'([^']*)'/g)]) {
        if (!allowed.has(v[1].toLowerCase())) report(file, line, key, v[1], allowed, 'IN (…)');
      }
    }
  }
}

console.log('═'.repeat(78));
console.log('قيم مكتوبة في أعمدة ENUM والعمود مش قابلها');
console.log('═'.repeat(78));
console.log(`أعمدة ENUM في الهجرات: ${enums.size}`);
const writes = findings.filter(f => f.how === 'INSERT' || f.how.startsWith('SET'));
const reads = findings.filter(f => !writes.includes(f));
const print = f => {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`      ${f.column} ← '${f.value}'   [${f.how}]`);
  console.log(`      المسموح: ${f.allowed}`);
};
console.log(`كتابة بقيمة مرفوضة (بتفشل وقت التشغيل): ${writes.length}\n`);
writes.forEach(print);
// Reads compare against a value the column cannot hold: harmless at runtime
// (the branch never matches), and often deliberate tolerance of an old
// spelling — listed, not failed. The enum read from migrations can also lag
// the database where a column was widened by a form this parser does not read.
console.log(`\nمقارنة بقيمة العمود ما بيقبلهاش (للعلم، مش بتفشل): ${reads.length}`);
if (process.argv.includes('--reads')) reads.forEach(print);
process.exitCode = writes.length ? 1 : 0;
