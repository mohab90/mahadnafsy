'use strict';
/**
 * Behavioural: a payment cannot be refunded for more than it took, however the
 * refunds are split. Runs the real applyRefundReversal against a stateful mock
 * connection that remembers the refund rows the function itself writes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRefundReversal } = require('../lib/refunds');

function statefulConn(payment) {
  const refundRows = [];
  const negativePayments = [];
  return {
    refundRows,
    async query(sql, params) {
      if (sql.includes('FROM payments WHERE id')) return [[payment]];
      if (sql.includes('FROM accounting_periods')) return [[]];
      if (sql.includes('SELECT code,is_active FROM tenant_chart_of_accounts')) {
        return [params.slice(1).map(code => ({ code, is_active: 1 }))];
      }
      if (sql.includes('INSERT INTO refunds')) { refundRows.push(Number(params[4])); return [{ affectedRows: 1 }]; }
      if (sql.includes('INSERT INTO payments')) { negativePayments.push(params.find(v => typeof v === 'number' && v < 0)); return [{ affectedRows: 1 }]; }
      if (sql.includes('FROM refunds WHERE')) return [[{ total: refundRows.reduce((a, b) => a + b, 0) }]];
      if (sql.includes("source='refund'")) return [[{ total: -negativePayments.reduce((a, b) => a + b, 0) }]];
      return [[]];
    },
  };
}
const base = {
  id: 'pay-1', subscriber_id: 's1', course_id: 'c1', bundle_id: null, amount: 1000, amount_egp: 1000,
  currency: 'EGP', payment_type: 'COURSE', status: 'paid', payment_method: 'cash', branch: 'DAQQI', branch_id: 'branch-daqqi',
};
const args = amount => ({ paymentId: 'pay-1', refundAmount: amount, refundCurrency: 'EGP', tenantId: 't1', actor: 'x' });

test('a second partial refund cannot take the total past what was paid', async () => {
  const conn = statefulConn(base);
  const first = await applyRefundReversal(args(700), conn);
  assert.equal(first.remaining, 300);
  await assert.rejects(() => applyRefundReversal(args(700), conn), /المتبقي القابل للاسترداد \(300\)/);
});

test('the rest of a payment can still be refunded after a partial one', async () => {
  const conn = statefulConn(base);
  await applyRefundReversal(args(700), conn);
  const second = await applyRefundReversal(args(300), conn);
  assert.equal(second.partial, true, 'never the full reversal, which would count the first 700 twice');
  assert.equal(second.remaining, 0);
  assert.equal(second.fullyRefunded, true);
});

test('a refund recorded only as a negative payment row is still counted', async () => {
  const conn = statefulConn(base);
  const originalQuery = conn.query.bind(conn);
  // the ledger insert is allowed to fail; the payment row is the second source
  conn.query = async (sql, params) => {
    if (sql.includes('INSERT INTO refunds')) throw new Error('ledger down');
    return originalQuery(sql, params);
  };
  await applyRefundReversal(args(600), conn);
  await assert.rejects(() => applyRefundReversal(args(600), conn), /القابل للاسترداد/);
});
