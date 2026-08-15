// Every column an API query names, checked against the columns the database
// actually has. This is the shape of the search outage: the bundles query
// selected `thumbnail`, that table has no such column, MySQL rejected the whole
// statement, and because both halves ran in one Promise.all every search — for
// any term — answered 500. Nothing in the test suite or the type checker can
// see that; only the live schema can.
//
// Reads api/routes/**/*.js, pulls the SQL out of template literals, and for
// each `FROM <table>` / `JOIN <table>` resolves the aliases, then reports any
// `alias.column` that the table does not have.
//
// Usage: node tools/schema-column-audit.cjs <schema.json>
//
// Dump the schema from whichever database you are checking against:
//   SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
//    WHERE TABLE_SCHEMA=DATABASE()
// collected into { table: [columns] } and written as JSON. Checking against
// production is the point — a column can exist in a migration and be missing
// from the database that is actually serving requests.
const fs = require('fs');
const path = require('path');

const schema = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); // { table: [cols] }
const tables = new Set(Object.keys(schema));

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};

// SQL lives in backtick templates. Take each one that looks like a statement.
const SQL_RE = /`([^`]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^`]*)`/gis;
// Aliases: FROM tbl a / FROM tbl AS a / JOIN tbl a
const FROM_RE = /\b(?:FROM|JOIN)\s+`?([a-z_][a-z0-9_]*)`?(?:\s+(?:AS\s+)?`?([a-z][a-z0-9_]*)`?)?/gi;
const QUALIFIED_RE = /\b([a-z][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;

const SQL_WORDS = new Set(['on','and','or','as','is','not','null','in','where','select','from','join','left','right',
  'inner','outer','group','by','order','limit','offset','set','values','case','when','then','else','end','asc','desc',
  'count','sum','max','min','avg','coalesce','if','ifnull','distinct','union','all','exists','between','like','escape',
  'interval','date','now','curdate','concat','concat_ws','replace','json_valid','date_sub','date_add','timestampdiff',
  'hour','day','lower','upper','trim','left','substring','cast','field','uuid','row_number','over','partition']);

const findings = [];
for (const file of walk('api/routes')) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(SQL_RE)) {
    const sql = m[1];
    const line = src.slice(0, m.index).split('\n').length;

    // alias -> table, for this statement only
    const alias = new Map();
    const used = new Set();
    for (const f of sql.matchAll(FROM_RE)) {
      const [, tbl, al] = f;
      if (!tables.has(tbl)) continue;          // unknown table: reported separately below
      used.add(tbl);
      if (al && !SQL_WORDS.has(al.toLowerCase())) alias.set(al, tbl);
      alias.set(tbl, tbl);                      // table name used directly as a qualifier
    }
    if (!alias.size) continue;

    for (const q of sql.matchAll(QUALIFIED_RE)) {
      const [, a, col] = q;
      const tbl = alias.get(a);
      if (!tbl) continue;                       // not one of this statement's aliases
      if (SQL_WORDS.has(col.toLowerCase())) continue;
      if (!schema[tbl].includes(col)) {
        findings.push({ file, line, table: tbl, column: col, alias: a });
      }
    }
  }
}

// Deduplicate: the same wrong column repeated in one file is one defect.
const seen = new Set();
const unique = findings.filter(f => {
  const k = `${f.file}:${f.table}.${f.column}`;
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

console.log(`columns referenced but missing from the table: ${unique.length}\n`);
unique.forEach(f => console.log(`  ${f.table}.${f.column}`.padEnd(46) + `${f.file}:${f.line}`));
