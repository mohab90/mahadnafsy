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

test('assigned scopes cannot open aggregates but can be matched to owned records', () => {
  const req = { staffRecord: { id: 'C1', role: 'collection' } };
  assert.throws(() => resolveFinancialScope(req), /not available/);
  const scope = resolveFinancialScope(req, { allowAssigned: true });
  assert.equal(scope.kind, 'assigned_cs');
  assert.equal(financialRecordMatches(scope, { assigned_cs_id: 'C1' }), true);
  assert.equal(financialRecordMatches(scope, { assigned_cs_id: 'C2' }), false);
});
