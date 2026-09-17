'use strict';

// The writes nobody had ever parsed.
//
// tools/explain-sql.cjs checked SELECTs. This API has 778 writes, and the two
// worst faults of the audit were both writes — an UPDATE naming leads.crm_data,
// and an INSERT that lost a paying customer to a unique index. The first run of
// the extended tool found three more, all of them live in production:
//
//   * POST /api/admin/courses listed 39 columns against 38 placeholders, so
//     every course save answered 500 — since bbfbdd8 (19 Aug) added
//     access_months to the column list and no `?` to match.
//   * the Paymob webhook inserted consultations.therapist_name, a column the
//     table does not have. It threw inside the finalisation transaction, which
//     rolled back the paid order, the enrolment and the payment row with it.
//     A card payment for a consultation recorded nothing at all.
//   * POST /api/admin/bundles wrote thumbnail, details_content_json and
//     updated_at to a bundles table with none of them — 500 on every save,
//     while mapBundle read all three back out and the front end rendered them.
//
// These are source pins. The running check is tools/explain-sql.cjs against a
// real database; this keeps the four known ones from coming back between runs.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

/** The INSERT beginning at `marker`, as far as its VALUES list. */
function insertAt(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start > 0, `the statement starting "${marker}" is gone`);
  const columns = src.slice(src.indexOf('(', start) + 1, src.indexOf(')', src.indexOf('VALUES', start) - 200));
  const values = src.slice(src.indexOf('VALUES', start), src.indexOf('\n', src.indexOf('VALUES', start)));
  return {
    columns: columns.split(',').map(s => s.trim()).filter(Boolean),
    placeholders: (values.match(/\?/g) || []).length,
  };
}

test('every course column has a placeholder to put a value in', () => {
  const { columns, placeholders } = insertAt(read('routes/admin/catalog.js'), 'INSERT INTO courses');
  assert.equal(columns.length, placeholders,
    `courses is inserted with ${columns.length} columns and ${placeholders} placeholders — the save answers 500`);
  assert.ok(columns.includes('access_months'), 'the column whose placeholder was missing is gone');
});

test('the Paymob consultation insert names only columns consultations has', () => {
  const src = read('routes/public-orders.js');
  const { columns, placeholders } = insertAt(src, 'INSERT IGNORE INTO consultations');
  assert.ok(!columns.includes('therapist_name'),
    'therapist_name is back: it does not exist, and it rolls the whole payment back');
  // NOW() fills created_at, so the placeholders are one short of the columns.
  assert.equal(placeholders, columns.length - 1);
  assert.ok(!/cd\.therapistName/.test(src), 'the parameter for the dropped column is still passed');
});

test('bundles gets the columns its save writes and its page reads', () => {
  const migrations = fs.readdirSync(path.join(API, 'migrations'));
  const file = migrations.find(name => /bundles_thumbnail/.test(name));
  assert.ok(file, 'the migration adding the bundle columns is gone');
  const sql = fs.readFileSync(path.join(API, 'migrations', file), 'utf8');
  for (const column of ['thumbnail', 'details_content_json', 'updated_at']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `bundles.${column} is not added`);
  }
  // And the save still writes them — a migration for columns nobody writes is
  // not the fix either.
  assert.match(read('routes/core/catalog.js'), /INSERT INTO bundles[\s\S]{0,200}thumbnail/);
});

test('nothing writes to a registrations table — there is none', () => {
  const src = read('routes/auth.js');
  assert.ok(!/INTO registrations\b/i.test(src),
    'the INSERT that threw ER_NO_SUCH_TABLE on every signup is back');
  // "التسجيلات" is a view over users, which is why the table was never missed.
  assert.match(read('routes/registrations.js'), /FROM users/);
});

test('the schema check covers writes, and can only ever plan them', () => {
  const tool = read('tools/explain-sql.cjs');
  assert.match(tool, /PREPARE/);
  assert.match(tool, /ROLLBACK/);
  // Whatever the tool sends, it is one of these verbs. EXECUTE is not among
  // them, which is what keeps a checked write from becoming a performed one.
  const allowed = new Set(['EXPLAIN', 'PREPARE', 'DEALLOCATE', 'SELECT', 'SET', 'START', 'ROLLBACK']);
  const verbs = [...tool.matchAll(/\.query\(\s*['"`]([A-Za-z]+)/g)].map(m => m[1].toUpperCase());
  assert.ok(verbs.length >= 5, 'the statements this tool sends can no longer be read off it');
  for (const verb of verbs) assert.ok(allowed.has(verb), `the tool sends ${verb}`);
});
