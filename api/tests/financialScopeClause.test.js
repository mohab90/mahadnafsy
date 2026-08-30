'use strict';
// The scope as SQL, which is a row-level access rule.
//
// Nine routes across finance.js, orders.js and payments.js each translated a
// scope into `AND …=?` by hand, differing only in which alias carries the
// branch. Nine copies of an access rule is nine chances for one to drift and
// hand a rep somebody else's rows.
//
// What these pin is the direction the thing fails in: anything unrecognised
// closes. A clause builder that returns '' when it does not understand its
// input removes the WHERE condition entirely and returns the whole table.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { financialScopeClause } = require('../lib/financialScope');

test('a branch scope filters on the column the caller names', () => {
  const c = financialScopeClause({ kind: 'branch', branchId: 'b1' }, { branchColumn: 'pl.branch_id' });
  assert.equal(c.sql, ' AND pl.branch_id=?');
  assert.deepEqual(c.params, ['b1']);
});

test('an assignment scope filters on the joined subscriber', () => {
  const cs = financialScopeClause({ kind: 'assigned_cs', staffId: 'st1' }, { branchColumn: 'x.branch_id' });
  assert.equal(cs.sql, ' AND s.assigned_cs_id=?');
  assert.deepEqual(cs.params, ['st1']);

  const sales = financialScopeClause(
    { kind: 'assigned_sales', staffId: 'st2' },
    { branchColumn: 'x.branch_id', subscriberAlias: 'sub' },
  );
  assert.equal(sales.sql, ' AND sub.assigned_sales_id=?');
  assert.deepEqual(sales.params, ['st2']);
});

test('an unrestricted scope adds nothing', () => {
  assert.deepEqual(financialScopeClause({ kind: 'all' }, { branchColumn: 'x.branch_id' }), { sql: '', params: [] });
});

test('a branch scope with no column to filter on returns nothing, not everything', () => {
  // The caller forgot to say which column carries the branch. Widening to the
  // whole table is the one answer that must not be given.
  const c = financialScopeClause({ kind: 'branch', branchId: 'b1' }, {});
  assert.equal(c.sql, ' AND 1=0');
});

test('an unknown scope kind closes', () => {
  assert.equal(financialScopeClause({ kind: 'something_new' }, { branchColumn: 'x.branch_id' }).sql, ' AND 1=0');
  assert.equal(financialScopeClause(null, { branchColumn: 'x.branch_id' }).sql, ' AND 1=0');
  assert.equal(financialScopeClause(undefined).sql, ' AND 1=0');
});

test('every value is bound, never interpolated', () => {
  const c = financialScopeClause({ kind: 'assigned_cs', staffId: "'; DROP TABLE payments; --" }, { branchColumn: 'x.b' });
  assert.ok(!c.sql.includes('DROP'), 'the id must not reach the SQL text');
  assert.equal(c.params.length, 1);
});
