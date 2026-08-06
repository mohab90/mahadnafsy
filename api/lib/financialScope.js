'use strict';

const { VALID_BRANCHES, resolveDataScope } = require('../constants/permissions');
const { branchIdForBranch, normalizeBranch } = require('./branches');

class FinancialScopeError extends Error {
  constructor(message, status = 403, code = 'FINANCIAL_SCOPE_FORBIDDEN') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function resolveFinancialScope(req, { requestedBranch = null, allowAssigned = false } = {}) {
  const dataScope = resolveDataScope(req.staffRecord, {
    isSuperAdmin: req.isSuperAdmin,
    fallback: 'none',
  });
  const normalizedRequested = requestedBranch
    ? normalizeBranch(requestedBranch, null)
    : null;
  if (requestedBranch && (!normalizedRequested || !VALID_BRANCHES.has(normalizedRequested))) {
    throw new FinancialScopeError('Invalid branch', 400, 'INVALID_BRANCH');
  }

  if (dataScope === 'all') {
    return {
      kind: 'all',
      branch: normalizedRequested,
      branchId: normalizedRequested ? branchIdForBranch(normalizedRequested) : null,
      staffId: req.staffRecord?.id || null,
    };
  }

  if (dataScope.startsWith('branch:')) {
    const forcedBranch = normalizeBranch(dataScope.slice('branch:'.length), null);
    if (!forcedBranch || !VALID_BRANCHES.has(forcedBranch)) {
      throw new FinancialScopeError('Invalid configured financial branch scope');
    }
    if (normalizedRequested && normalizedRequested !== forcedBranch) {
      throw new FinancialScopeError('Requested branch is outside your financial scope');
    }
    return {
      kind: 'branch',
      branch: forcedBranch,
      branchId: branchIdForBranch(forcedBranch),
      staffId: req.staffRecord?.id || null,
    };
  }

  if (allowAssigned && ['assigned_cs', 'assigned_sales'].includes(dataScope) && req.staffRecord?.id) {
    return {
      kind: dataScope,
      branch: null,
      branchId: null,
      staffId: req.staffRecord.id,
    };
  }

  throw new FinancialScopeError(
    'Aggregate financial reports are not available for this data scope',
    403,
    'FINANCIAL_SCOPE_UNSUPPORTED'
  );
}

function financialRecordMatches(scope, record) {
  if (!scope || !record) return false;
  if (scope.kind === 'all') {
    return !scope.branchId || String(record.branch_id || '') === String(scope.branchId);
  }
  if (scope.kind === 'branch') {
    return String(record.branch_id || '') === String(scope.branchId);
  }
  if (scope.kind === 'assigned_cs') {
    return String(record.assigned_cs_id || '') === String(scope.staffId);
  }
  if (scope.kind === 'assigned_sales') {
    return String(record.assigned_sales_id || '') === String(scope.staffId);
  }
  return false;
}

module.exports = {
  FinancialScopeError,
  financialRecordMatches,
  resolveFinancialScope,
};
