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

/**
 * The scope as a SQL fragment, the way financialRecordMatches is it in memory.
 *
 * Nine routes across finance.js, orders.js and payments.js each translated a
 * scope into `AND …=?` by hand, differing only in which alias carries the
 * branch. That is a row-level access rule, and nine copies of one is nine
 * chances for a copy to drift and hand a rep somebody else's rows.
 *
 * @param scope             from resolveFinancialScope
 * @param branchColumn      the column holding branch_id, e.g. 'pl.branch_id'
 * @param subscriberAlias   the joined subscribers alias carrying the assignment
 * @returns { sql, params } — sql is '' for an unrestricted scope, and
 *          ' AND 1=0' where the scope permits nothing, so a caller that forgets
 *          to check gets no rows rather than all of them.
 */
function financialScopeClause(scope, { branchColumn, subscriberAlias = 's' } = {}) {
  if (!scope) return { sql: ' AND 1=0', params: [] };
  if (scope.branchId) {
    if (!branchColumn) return { sql: ' AND 1=0', params: [] };
    return { sql: ` AND ${branchColumn}=?`, params: [scope.branchId] };
  }
  if (scope.kind === 'assigned_cs') {
    return { sql: ` AND ${subscriberAlias}.assigned_cs_id=?`, params: [scope.staffId] };
  }
  if (scope.kind === 'assigned_sales') {
    return { sql: ` AND ${subscriberAlias}.assigned_sales_id=?`, params: [scope.staffId] };
  }
  if (scope.kind === 'all' || scope.kind === 'branch') return { sql: '', params: [] };
  // An unrecognised scope closes rather than opens — the same direction
  // leadScope takes, and the one a new scope kind should default to.
  return { sql: ' AND 1=0', params: [] };
}

module.exports = {
  FinancialScopeError,
  financialRecordMatches,
  financialScopeClause,
  resolveFinancialScope,
};
