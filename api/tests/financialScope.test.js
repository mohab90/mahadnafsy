'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  financialRecordMatches,
  resolveFinancialScope,
} = require('../lib/financialScope');

test('branch roles are forced to their configured finance branch', () => {
  const scope = resolveFinancialScope({
    staffRecord: { id: 'S1', role: 'daqqi_manager' },
  });
  assert.equal(scope.kind, 'branch');
  assert.equal(scope.branch, 'DAQQI');
  assert.equal(scope.branchId, 'branch-daqqi');
  assert.throws(
    () => resolveFinancialScope({
      staffRecord: { id: 'S1', role: 'daqqi_manager' },
    }, { requestedBranch: 'ONLINE_EGYPT' }),
    /outside your financial scope/
  );
});

test('full-scope finance users may request one valid branch', () => {
  const scope = resolveFinancialScope({
    staffRecord: { id: 'A1', role: 'accountant' },
  }, { requestedBranch: 'tagamoa' });
  assert.equal(scope.kind, 'all');
  assert.equal(scope.branchId, 'branch-tagamoa');
});

test('a per-staff data_scope override beats the role default', () => {
  // The bug this fixes: an HR lead who also runs sales is stored as role='hr',
  // whose DATA_SCOPE is 'none', so every financial aggregate answered
  // FINANCIAL_SCOPE_UNSUPPORTED even though her permissions allowed the page.
  const hrOnly = { staffRecord: { id: 'H1', role: 'hr' } };
  assert.throws(() => resolveFinancialScope(hrOnly), /not available/);

  const hybrid = { staffRecord: { id: 'H1', role: 'hr', data_scope: 'all' } };
  assert.equal(resolveFinancialScope(hybrid).kind, 'all');

  // A branch override is honoured and still validated…
  const branchBound = { staffRecord: { id: 'H2', role: 'hr', data_scope: 'branch:DAQQI' } };
  assert.equal(resolveFinancialScope(branchBound).branchId, 'branch-daqqi');
  // …and garbage falls back to the role default rather than widening reach.
  const garbage = { staffRecord: { id: 'H3', role: 'hr', data_scope: 'everything' } };
  assert.throws(() => resolveFinancialScope(garbage), /not available/);
});

test('assigned scopes cannot open aggregates but can be matched to owned records', () => {
  const req = { staffRecord: { id: 'C1', role: 'collection' } };
  assert.throws(() => resolveFinancialScope(req), /not available/);
  const scope = resolveFinancialScope(req, { allowAssigned: true });
  assert.equal(scope.kind, 'assigned_cs');
  assert.equal(financialRecordMatches(scope, { assigned_cs_id: 'C1' }), true);
  assert.equal(financialRecordMatches(scope, { assigned_cs_id: 'C2' }), false);
});
