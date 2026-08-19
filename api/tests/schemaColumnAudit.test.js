'use strict';

// The column audit is only worth running if you trust what it prints.
//
// It used to find SQL with a regex that pairs backticks left to right, blind to
// which ones are template quotes. One nested template inside a `${...}` shifted
// the pairing for the rest of the file, after which each "match" was the
// JavaScript BETWEEN two literals — and `courses.length` on a plain array got
// reported as a missing column of the `courses` table.
//
// These run the real tool against fixtures: it must still catch the outage it
// was built for, and must not invent the two it was inventing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOL = path.join(__dirname, '..', '..', 'tools', 'schema-column-audit.cjs');

const SCHEMA = {
  bundles: ['id', 'title', 'price'],
  courses: ['id', 'title', 'thumbnail'],
  subscribers: ['id', 'email', 'name'],
};

/** Run the tool over one fixture file placed at api/routes/<name>. */
function audit(fixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colaudit-'));
  fs.mkdirSync(path.join(root, 'api', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'api', 'routes', 'fixture.js'), fixture);
  const schemaPath = path.join(root, 'schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(SCHEMA));
  try {
    return execFileSync(process.execPath, [TOOL, schemaPath], { cwd: root, encoding: 'utf8' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('catches a column the table does not have — the search outage', () => {
  const out = audit('const q = `SELECT b.id, b.thumbnail FROM bundles b`;\n');
  assert.match(out, /bundles\.thumbnail/, 'the original defect must still be reported');
});

test('a nested template does not desynchronise the scan', () => {
  // The second literal is real SQL and correct. Before the fix, the nested
  // backtick inside ${...} shifted every later pairing.
  const fixture = [
    'const order = `ORDER BY ${asc ? `a.id ASC` : `a.id DESC`}`;',
    'const ok = `SELECT c.id, c.title FROM courses c`;',
    'if (courses && courses.length > 0) {',
    '  const valid = courses.filter(c => c.id);',
    '}',
    'const q2 = `SELECT s.email FROM subscribers s`;',
    '',
  ].join('\n');
  const out = audit(fixture);
  assert.doesNotMatch(out, /courses\.length/, 'reading .length on an array is not a column');
  assert.doesNotMatch(out, /courses\.filter/, 'calling .filter on an array is not a column');
  assert.match(out, /missing from the table: 0/, 'the fixture has no real defect');
});

test('a JS property on a variable sharing a table name is not a column', () => {
  const fixture = [
    'const rows = await db.query(`SELECT c.id FROM courses c`);',
    'const courses = rows.map(r => r);',
    'return courses.length;',
    '',
  ].join('\n');
  assert.match(audit(fixture), /missing from the table: 0/);
});

test('an interpolated value is not read as a column reference', () => {
  const fixture = 'const q = `SELECT b.id FROM bundles b WHERE b.price > ${user.price}`;\n';
  const out = audit(fixture);
  assert.doesNotMatch(out, /user\.price/);
  assert.match(out, /missing from the table: 0/);
});

test('refuses to run without a schema instead of throwing from fs', () => {
  let threw;
  try {
    execFileSync(process.execPath, [TOOL], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    threw = error;
  }
  assert.ok(threw, 'must exit non-zero');
  assert.equal(threw.status, 2);
  assert.doesNotMatch(String(threw.stderr), /ERR_INVALID_ARG_TYPE/,
    'the failure must explain what is missing, not leak an fs stack trace');
  assert.match(String(threw.stderr), /schema/);
});
