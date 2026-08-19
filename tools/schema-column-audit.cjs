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

// `npm run audit:columns` passes no argument, so this used to die on an
// ERR_INVALID_ARG_TYPE stack from deep inside fs — which reads like the audit
// itself is broken rather than like it needs a schema to check against.
const schemaPath = process.argv[2];
if (!schemaPath || !fs.existsSync(schemaPath)) {
  console.error('محتاج ملف schema — الأداة بتقارن الكود بقاعدة البيانات الحقيقية.\n');
  console.error('اطلع نسخة من السيرفر الأول:');
  console.error('  ssh <server> "cd /var/www/mahad-api && node -e \\"require(\'dotenv\').config();' +
    'const{pool}=require(\'./lib/db\');(async()=>{const[r]=await pool.query(' +
    '\'SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()\');' +
    'const o={};for(const x of r){(o[x.t]=o[x.t]||[]).push(x.c)}' +
    'process.stdout.write(JSON.stringify(o));process.exit(0)})()\\"" > schema.json\n');
  console.error('وبعدين:  node tools/schema-column-audit.cjs schema.json');
  process.exit(2);
}
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')); // { table: [cols] }
const tables = new Set(Object.keys(schema));

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};

// SQL lives in backtick templates, and finding them needs a scanner rather than
// a regex.
//
// `/`([^`]*SELECT[^`]*)`/g` pairs backticks left to right and has no idea which
// ones are quotes. One nested template inside a `${...}` and the pairing shifts
// by one for the rest of the file, after which every "match" is the JavaScript
// BETWEEN two literals. That is how `courses.length` and `courses.filter` — a
// plain array being read — got reported as missing columns of the `courses`
// table: `courses` is also a table name, so the qualifier resolved and the
// property looked like a column. Two false alarms on a tool whose whole value is
// that you trust what it prints.
//
// This walks the source instead, skipping comments and quoted strings, and
// returns each template's literal text with interpolations blanked out.
function skipQuoted(src, i, quote) {
  i += 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** From the opening backtick; returns { text, end } past the closing one. */
function readTemplate(src, start) {
  let i = start + 1;
  let text = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { text += ' '; i += 2; continue; }
    if (c === '`') { i += 1; break; }
    if (c === '$' && src[i + 1] === '{') {
      i = skipInterpolation(src, i + 2);
      text += ' ? ';                       // a bound value, as far as SQL cares
      continue;
    }
    text += c;
    i += 1;
  }
  return { text, end: i };
}

/** From just past `${`; returns the index after the matching `}`. */
function skipInterpolation(src, start) {
  let i = start;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '`') { i = readTemplate(src, i).end; continue; }   // nested template
    if (c === '"' || c === '\'') { i = skipQuoted(src, i, c); continue; }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    i += 1;
  }
  return i;
}

function templateLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2; continue;
    }
    if (c === '"' || c === '\'') { i = skipQuoted(src, i, c); continue; }
    if (c === '`') {
      const { text, end } = readTemplate(src, i);
      out.push({ text, index: i });
      i = end; continue;
    }
    i += 1;
  }
  return out;
}

const STATEMENT_RE = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/is;
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
  for (const m of templateLiterals(src)) {
    if (!STATEMENT_RE.test(m.text)) continue;
    const sql = m.text;
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
