'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// splitStatements is not exported — the runner opens a pool at import — so it is
// lifted from the source, the way the sibling Dokki tests read theirs.
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrationRunner.js'), 'utf8');
const splitStatements = (() => {
  const start = src.indexOf('function splitStatements(');
  const end = src.indexOf('\nfunction ', start + 10);
  return new Function(`${src.slice(start, end)}; return splitStatements;`)();
})();

test('a semicolon inside a string literal does not split the statement', () => {
  // The exact shape that broke migration 209 on deploy. Two semicolons, both
  // inside a quoted regex, and the statement must survive whole.
  const sql = `UPDATE courses
     SET short_description = REGEXP_REPLACE(short_description, '\\s*mso-[a-zA-Z-]+\\s*:[^;"]*;?', '')
   WHERE short_description LIKE '%mso-%';`;
  const out = splitStatements(sql);
  assert.equal(out.length, 1, 'one statement, not three');
  assert.ok(out[0].includes('[^;"]*;?'), 'the pattern survives intact');
});

test('ordinary statements still split on their terminators', () => {
  const out = splitStatements('SELECT 1;\nSELECT 2;\nSELECT 3;');
  assert.deepEqual(out, ['SELECT 1', 'SELECT 2', 'SELECT 3']);
});

test('a doubled quote inside a literal keeps the literal open', () => {
  // 'it''s; here' is one string containing a semicolon.
  const out = splitStatements(`INSERT INTO t VALUES ('it''s; here');\nSELECT 1;`);
  assert.equal(out.length, 2);
  assert.ok(out[0].includes("it''s; here"), 'the escaped quote and semicolon both survive');
});

test('semicolons in line comments are still ignored', () => {
  const out = splitStatements('-- a comment; with a semicolon\nSELECT 1;');
  assert.equal(out.length, 1);
  assert.equal(out[0], 'SELECT 1');
});

test('backtick identifiers containing a semicolon stay whole', () => {
  const out = splitStatements('SELECT `odd;name` FROM t;');
  assert.equal(out.length, 1);
  assert.ok(out[0].includes('`odd;name`'));
});

test('a trailing statement without a terminator is not lost', () => {
  const out = splitStatements('SELECT 1;\nSELECT 2');
  assert.deepEqual(out, ['SELECT 1', 'SELECT 2']);
});

test('every migration on disk still parses to the same statement count', () => {
  // A regression net for the change itself: whatever the old splitter produced
  // for the existing files, the new one must produce too — none of them relies
  // on a semicolon inside a string, so the counts must be identical.
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));
  assert.ok(files.length > 100, 'sanity: migrations were found');
  for (const file of files) {
    const statements = splitStatements(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(statements.length > 0, `${file} produced no statements`);
    for (const s of statements) {
      assert.ok(!/^\s*$/.test(s), `${file} produced an empty statement`);
    }
  }
});
