'use strict';

// The audit trail says who did what, and says so when it cannot.
//
// Three things were wrong:
//
//   the actor    POST /api/admin/activity-logs took `actor`, `at` and `id`
//                straight from the request body, so an admin could write a row
//                under anybody's name at any timestamp — and a chosen id with
//                INSERT IGNORE could pre-empt a genuine row arriving later. A
//                log an admin can forge is not evidence about an admin.
//   the middleware  a failed activity_logs insert was `.catch(() => {})`, so a
//                gap in the trail left no row and no log line.
//   the login log   same shape in loginAudit, on the table a security question
//                gets answered from.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the server decides the actor, the time and the id — never the caller', () => {
  const src = read('api/routes/admin-operations.js');
  const start = src.indexOf(`router.post('/api/admin/activity-logs'`);
  assert.ok(start > 0, 'the route moved');
  const route = src.slice(start, start + 1400);

  assert.ok(!/a\.actor/.test(route), 'the actor is taken from the body again');
  assert.ok(!/a\.user_id/.test(route), '…or from a second body field');
  assert.ok(!/a\.at\b/.test(route), 'the timestamp is taken from the body again');
  assert.ok(!/a\.id\b/.test(route), 'the row id is taken from the body again');

  assert.match(route, /const id = uuidv4\(\);/);
  assert.match(route, /req\.user\?\.email \|\| req\.user\?\.uid \|\| 'admin'/);
  assert.match(route, /new Date\(\)\.toISOString\(\)/);

  // INSERT IGNORE let a pre-inserted id swallow the real row.
  assert.ok(!/INSERT IGNORE INTO activity_logs/.test(route),
    'INSERT IGNORE lets a chosen id silently drop a later genuine row');
  assert.match(route, /INSERT INTO activity_logs/);
});

test('a lost audit row is reported, not swallowed', () => {
  const mw = read('api/middleware/adminAudit.js');
  assert.ok(!/INSERT INTO activity_logs[\s\S]{0,240}?\.catch\(\(\) => \{\}\)/.test(mw),
    'the activity log insert discards its failure again');
  assert.match(mw, /\.catch\(error => \{/);
  assert.match(mw, /logger\.error\('\[audit\] activity log write failed/);
  assert.match(mw, /require\('\.\.\/lib\/logger'\)/);

  const login = read('api/lib/loginAudit.js');
  assert.ok(!/catch \(_\) \{ \/\* Authentication must not fail/.test(login),
    'the login history insert discards its failure again');
  assert.match(login, /logger\.warn\('\[login-audit\] write failed'/);
  // And it still must not break sign-in.
  assert.match(login, /\} catch \(error\) \{/);
  assert.ok(!/throw/.test(login.slice(login.indexOf('} catch (error) {'))),
    'an audit failure must never stop someone signing in');
});

test('the middleware still records what it always recorded', () => {
  // The fix is about the failure path; the happy path has to be untouched.
  const mw = read('api/middleware/adminAudit.js');
  assert.match(mw, /const actor = req\.user\?\.email \|\| req\.user\?\.uid \|\| 'admin';/);
  assert.match(mw, /\['POST', 'PUT', 'PATCH', 'DELETE'\]\.includes\(req\.method\)/);
  assert.match(mw, /res\.statusCode >= 200 && res\.statusCode < 300/,
    'only a successful mutation is an event worth recording');
});
