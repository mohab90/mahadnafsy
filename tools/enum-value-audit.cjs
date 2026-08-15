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
const values = body => new Set([...body.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'")));

const files = fs.readdirSync(MIG).filter(f => f.endsWith('.sql'))
  .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

for (const f of files) {
  const sql = fs.readFileSync(path.join(MIG, f), 'utf8');

  // CREATE TABLE <t> ( ... ) — one enum column per line is the house style.
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\s*\)\s*(?:ENGINE|;)/gi)) {
    const table = m[1];
    for (const c of m[2].matchAll(/^\s*`?(\w+)`?\s+ENUM\s*\(([^)]*)\)/gim)) {
      enums.set(`${table}.${c[1]}`, values(c[2]));
    }
  }
  // ALTER TABLE <t> MODIFY/CHANGE/ADD ... ENUM(...) — replaces the earlier set.
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?\s+(?:MODIFY|CHANGE|ADD)\s+(?:COLUMN\s+)?`?(\w+)`?\s*(?:`?\w+`?\s+)?ENUM\s*\(([^)]*)\)/gi)) {
    enums.set(`${m[1]}.${m[2]}`, values(m[3]));
  }
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
const SQL_RE = /[`'"]([^`'"]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^`'"]*)[`'"]/gis;
const TABLE_RE = /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO)\s+`?([a-z_][a-z0-9_]*)`?(?:\s+(?:AS\s+)?`?([a-z][a-z0-9_]*)`?)?/gi;
const SQL_WORDS = new Set(['on', 'and', 'or', 'as', 'is', 'not', 'null', 'in', 'where', 'select', 'from', 'join',
  'left', 'right', 'inner', 'outer', 'group', 'by', 'order', 'limit', 'set', 'values', 'case', 'when', 'then',
  'else', 'end', 'asc', 'desc', 'union', 'all', 'exists', 'between', 'like', 'straight_join', 'use', 'force']);

const findings = [];
const report = (file, line, column, value, allowed, how) => {
  findings.push({ file: rel(file), line, column, value, allowed: [...allowed].join(','), how });
};

for (const file of walk(path.join(ROOT, 'api', 'routes'))) {
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
      if (!allowed || allowed.has(lit[1] ?? lit[2])) return;
      report(file, lineOf(src, m.index), key, lit[1] ?? lit[2], allowed, 'INSERT');
    });
  }

  // ── col = 'X' and col IN ('X','Y') written inline ─────────────────────────
  // Only inside a statement, and only against that statement's own tables.
  for (const s of src.matchAll(SQL_RE)) {
    const sql = s[1];
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

    for (const m of sql.matchAll(/\b(?:(\w+)\.)?(\w+)\s*(?:=|<=>)\s*'([^']*)'/g)) {
      const key = resolve(m[1], m[2]);
      const allowed = key && enums.get(key);
      if (!allowed || allowed.has(m[3])) continue;
      report(file, line, key, m[3], allowed, "= 'x'");
    }
    for (const m of sql.matchAll(/\b(?:(\w+)\.)?(\w+)\s+IN\s*\(\s*((?:'[^']*'\s*,?\s*)+)\)/gi)) {
      const key = resolve(m[1], m[2]);
      const allowed = key && enums.get(key);
      if (!allowed) continue;
      for (const v of [...m[3].matchAll(/'([^']*)'/g)]) {
        if (!allowed.has(v[1])) report(file, line, key, v[1], allowed, 'IN (…)');
      }
    }
  }
}

console.log('═'.repeat(78));
console.log('قيم مكتوبة في أعمدة ENUM والعمود مش قابلها');
console.log('═'.repeat(78));
console.log(`أعمدة ENUM في الهجرات: ${enums.size}`);
console.log(`ملاحظات: ${findings.length}\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`      ${f.column} ← '${f.value}'   [${f.how}]`);
  console.log(`      المسموح: ${f.allowed}`);
}
process.exitCode = findings.length ? 1 : 0;
