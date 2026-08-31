'use strict';
// Which callers share the scope rule, and which deliberately do not.
//
// Counting `scope.kind === 'assigned_cs'` across the finance routes suggests
// nine copies of one rule. Reading them says otherwise, and the difference
// matters: two of them are wider than the shared clause on purpose, and folding
// them in would take payments away from the staff who can currently see them.
//
// This is written down as a test because "consolidate the duplicates" is the
// obvious next move for whoever reads that count, and it is the wrong one here.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROUTES = path.join(__dirname, '..', 'routes');
const read = rel => fs.readFileSync(path.join(ROUTES, rel), 'utf8');

test('orders and finance take the scope clause from one place', () => {
  for (const rel of ['orders.js', 'finance.js']) {
    const s = read(rel);
    assert.match(s, /financialScopeClause/, `${rel} should use the shared clause`);
    // No hand-rolled branch/assignment clause left beside it.
    assert.doesNotMatch(
      s,
      /scope\.kind === 'assigned_cs' \? 'assigned_cs_id' : 'assigned_sales_id'/,
      `${rel} still builds the assignment column by hand`,
    );
  }
});

test('payments keeps its own, wider rule', () => {
  // It matches a payment the staff member recorded (staff_id) as well as one
  // belonging to a customer assigned to them. The comment beside it says why:
  // 76% of payments were entered without staff_id and belong to assigned
  // clients. financialScopeClause only knows the assignment half, so replacing
  // this with it would hide the payments those staff entered themselves.
  const s = read('payments.js');
  assert.match(s, /p\.staff_id = \?/, 'the seller half of the rule must survive');
  assert.match(s, /assigned_cs_id|assigned_sales_id/, 'so must the assignment half');
  assert.match(s, /76%/, 'and the reason it is wider must stay written down');
});

test('the shared clause is not quietly widened to match', () => {
  // The other way to "unify" these is to teach financialScopeClause the
  // staff_id half. That would hand every caller a rule two of them do not
  // want, including the reports, where a staff member would start seeing
  // payments they recorded for customers outside their scope.
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'financialScope.js'), 'utf8');
  assert.doesNotMatch(lib, /staff_id/, 'the shared clause scopes by assignment, not by who typed it');
});
