'use strict';

// Columns that do not exist, asked for by name.
//
// `EXPLAIN` hands a statement to the database, which resolves every table and
// column and refuses what it cannot run — without executing it. Run over all
// 1,475 SELECTs in the API (tools/explain-sql.cjs), it found statements naming
// columns no table has. Each one throws the moment its line is reached:
//
//   * the manual Google Sheets import asked courses for `is_active`. courses has
//     `is_published`. The import answered 500 before reading a row — while the
//     automatic sync beside it, doing the same job, had the column right.
//   * bulk SMS to subscribers filtered on `status`. subscribers has no such
//     column; `is_active` carries the state — the same confusion that made the
//     churn report answer 500 on every open. A filtered send never went out.
//
// These are source pins. The running check is tools/explain-sql.cjs against a
// real database; this keeps the two known ones from coming back between runs.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

test('nothing asks courses for is_active — the column is is_published', () => {
  for (const rel of ['routes/gsheets.js', 'lib/sheets.js']) {
    const src = read(rel);
    assert.ok(!/FROM courses[^`'"]*is_active/i.test(src), `${rel} queries courses on is_active again`);
  }
  // Both copies of the same lookup now agree, including on deleted courses.
  const wanted = 'FROM courses WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL';
  assert.ok(read('routes/gsheets.js').includes(wanted), 'the manual import lost the corrected query');
  assert.ok(read('lib/sheets.js').includes(wanted), 'the automatic sync lost the corrected query');
});

test('nothing filters subscribers on a status column', () => {
  const src = read('routes/misc/messaging.js');
  assert.ok(!/FROM subscribers[\s\S]{0,200}?AND status=\?/.test(src),
    'bulk SMS filters subscribers by status again — the column does not exist');
  assert.match(src, /AND is_active=\?/);
  assert.match(src, /UNSUPPORTED_SUBSCRIBER_STATUS/);
  // Leads do have a status column; that branch is untouched.
  assert.match(src, /FROM leads WHERE tenant_id=\? AND phone IS NOT NULL AND phone != ''/);
});

test('the schema check itself is in the repo and refuses to execute anything', () => {
  const tool = read('tools/explain-sql.cjs');
  assert.match(tool, /EXPLAIN/);
  assert.match(tool, /SET SESSION TRANSACTION READ ONLY/);
  // A plan, not a lock: FOR UPDATE and its modifiers are stripped together —
  // splitting them left "SKIP LOCKED" stranded and reported a working query.
  assert.match(tool, /FOR\\s\+UPDATE\(\\s\+SKIP\\s\+LOCKED\|\\s\+NOWAIT\)\?/);
  assert.ok(!/\bawait db\.query\((?!'EXPLAIN|'SET SESSION)/.test(tool),
    'the tool runs something other than EXPLAIN');
});
