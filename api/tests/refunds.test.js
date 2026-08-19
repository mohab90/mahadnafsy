'use strict';
/**
 * Behavioral tests for lib/refunds.js#applyRefundReversal — the function
 * that replaced two duplicated, drifted copies of the same ~60 lines (one in
 * finance.js, actually called by the frontend; one dead in admin-utils.js,
 * removed). Neither copy called assertWritable (PAY-04: a refund could
 * silently mutate a financially closed accounting period) or updated
 * orders.status (PAY-05: a refunded order stayed marked "paid" forever).
 * Uses a mock connection — no real DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// periodLock and finance both touch the DB internally in ways that are
// awkward to fully re-mock here, so this suite focuses on what
// applyRefundReversal itself is responsible for: which queries it issues,
// in what order, and that it surfaces the period-lock check before mutating
// anything. lib/periodLock.js and lib/finance.js already have their own
// direct unit tests (periodLock.test.js, journal.test.js).
const { applyRefundReversal } = require('../lib/refunds');

function mockConn(paymentRow, { periodClosed = false, leadId = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM payments WHERE id')) return [[paymentRow]];
      if (sql.includes('FROM accounting_periods')) {
        return periodClosed ? [[{ id: 'p1', period_label: '2026-01', status: 'closed' }]] : [[]];
      }
      if (sql.includes('SELECT code,is_active FROM tenant_chart_of_accounts')) {
        return [params.slice(1).map(code => ({ code, is_active: 1 }))];
      }
      if (sql.includes('FROM financial_documents')) return [[]];
      if (sql.includes('SELECT next_number FROM finance_document_sequences')) {
        return [[{ next_number: 2 }]];
      }
      if (sql.includes('SELECT id,status FROM enrollments')) return [[{ id: 'enr-1', status: 'active' }]];
      if (sql.includes('SELECT id FROM course_completions')) {
        return paymentRow?.course_id ? [[{ id: 'cc-1' }]] : [[]];
      }
      if (sql.includes('SELECT id,certificate_code,status,version FROM course_completions')) {
        return [[{ id: 'cc-1', certificate_code: 'MHAD-TEST', status: 'active', version: 1 }]];
      }
      if (sql.includes('UPDATE orders SET status')) return [{ affectedRows: 1 }];
      if (sql.includes('SELECT lead_id FROM subscribers')) return [[leadId ? { lead_id: leadId } : undefined]];
      if (sql.includes('INSERT INTO journal_entries') || sql.includes('journal')) return [{ insertId: 1 }];
      return [[]];
    },
  };
}

test('applyRefundReversal: returns null when the refund request has no linked payment', async () => {
  const conn = mockConn(null);
  const result = await applyRefundReversal({ paymentId: null, tenantId: 't1', actor: 'admin' }, conn);
  assert.equal(result, null);
  assert.equal(conn.calls.length, 0, 'must not issue any query when there is nothing to reverse');
});

test('applyRefundReversal: refuses to mutate a payment in a closed accounting period', async () => {
  const conn = mockConn(
    { id: 'pay-1', subscriber_id: 's1', course_id: 'c1', bundle_id: null, amount: 500, amount_egp: 500, currency: 'EGP', payment_type: 'COURSE', status: 'paid', transaction_id: null },
    { periodClosed: true }
  );
  await assert.rejects(() => applyRefundReversal({ paymentId: 'pay-1', refundAmount: 500, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, conn), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
  assert.ok(!conn.calls.some(c => c.sql.includes("SET status='refunded'")), 'must not touch the payment once the period-lock check rejects it');
});

test('applyRefundReversal: marks the payment refunded, cancels its commission, revokes the entitlement, and flips the linked order', async () => {
  const conn = mockConn({
    id: 'pay-1', subscriber_id: 's1', course_id: 'c1', bundle_id: null,
    amount: 500, amount_egp: 500, currency: 'EGP', payment_type: 'COURSE', status: 'paid', transaction_id: 'txn-abc',
  });
  const result = await applyRefundReversal({ paymentId: 'pay-1', refundAmount: 500, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin@x.com' }, conn);

  assert.ok(conn.calls.some(c => c.sql.includes("SET status='refunded'") && c.sql.includes('payments')), 'must mark the payment refunded');
  assert.ok(conn.calls.some(c => c.sql.includes('payment_audit_log')), 'must write an audit trail row');
  assert.ok(conn.calls.some(c => c.sql.includes("SET status='CANCELLED'") && c.sql.includes('crm_commissions')), 'must cancel any pending commission on the refunded payment');
  assert.ok(conn.calls.some(c => c.sql.includes("UPDATE enrollments SET status='revoked'")), 'must auditably revoke the course entitlement');
  assert.ok(conn.calls.some(c => c.sql.includes('INSERT INTO entitlement_events')), 'must preserve an entitlement audit event');
  assert.ok(conn.calls.some(c => c.sql.includes("UPDATE course_completions") && c.sql.includes("status='revoked'")), 'must revoke a paid-only completion certificate');
  assert.ok(conn.calls.some(c => c.sql.includes('INSERT INTO certificate_lifecycle_events')), 'must preserve certificate revocation history');
  assert.ok(conn.calls.some(c => c.sql.includes('INSERT INTO financial_documents')), 'must issue immutable invoice/credit-note documents');

  const orderUpdateCall = conn.calls.find(c => c.sql.includes('UPDATE orders SET status'));
  assert.ok(orderUpdateCall, 'must update the linked order — this is exactly the PAY-05 gap being closed');
  assert.deepEqual(orderUpdateCall.params, ['t1', 'pay-1', 'txn-abc']);
  assert.equal(result.orderUpdated, true);
});

test('applyRefundReversal: skips enrollment removal for a non-course payment (e.g. consultation)', async () => {
  const conn = mockConn({
    id: 'pay-2', subscriber_id: 's1', course_id: null, bundle_id: null,
    amount: 300, amount_egp: 300, currency: 'EGP', payment_type: 'CONSULTATION', status: 'paid', transaction_id: null,
  });
  await applyRefundReversal({ paymentId: 'pay-2', refundAmount: 300, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, conn);
  assert.ok(!conn.calls.some(c => c.sql.includes("UPDATE enrollments SET status='revoked'")), 'a consultation payment has no entitlement to revoke');
});

test('applyRefundReversal: logs a lead_timeline entry when the subscriber has a linked lead (FIN-02)', async () => {
  const conn = mockConn(
    { id: 'pay-3', subscriber_id: 's1', course_id: 'c1', bundle_id: null, amount: 400, amount_egp: 400, currency: 'EGP', payment_type: 'COURSE', status: 'paid', transaction_id: null },
    { leadId: 'lead-42' }
  );
  await applyRefundReversal({ paymentId: 'pay-3', refundAmount: 400, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, conn);
  const timelineCall = conn.calls.find(c => c.sql.includes('INSERT INTO lead_timeline'));
  assert.ok(timelineCall, 'must record the refund on the linked lead\'s timeline so CRM/sales staff see it');
  assert.equal(timelineCall.params[2], 'lead-42');
  assert.equal(timelineCall.params[3], 'payment_refunded');
});

test('applyRefundReversal: does not error when the subscriber has no linked lead', async () => {
  const conn = mockConn(
    { id: 'pay-4', subscriber_id: 's1', course_id: null, bundle_id: null, amount: 200, amount_egp: 200, currency: 'EGP', payment_type: 'OTHER', status: 'paid', transaction_id: null },
    { leadId: null }
  );
  await assert.doesNotReject(() => applyRefundReversal({ paymentId: 'pay-4', refundAmount: 200, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, conn));
  assert.ok(!conn.calls.some(c => c.sql.includes('INSERT INTO lead_timeline')));
});

test('applyRefundReversal: rejects an already-refunded payment before writing another reversal', async () => {
  const conn = mockConn({
    id: 'pay-5', subscriber_id: 's1', course_id: null, bundle_id: null,
    amount: 200, amount_egp: 200, currency: 'EGP', payment_type: 'OTHER', status: 'refunded',
  });
  await assert.rejects(
    () => applyRefundReversal({ paymentId: 'pay-5', refundAmount: 200, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, conn),
    /already refunded/,
  );
  assert.ok(!conn.calls.some(c => c.sql.includes('INSERT INTO journal_entries')));
});

test('applyRefundReversal: rejects partial and Paymob refunds while those workflows are deferred', async () => {
  const partialConn = mockConn({
    id: 'pay-6', subscriber_id: 's1', course_id: null, bundle_id: null,
    amount: 500, amount_egp: 500, currency: 'EGP', payment_type: 'OTHER', status: 'paid',
  });
  await assert.rejects(
    () => applyRefundReversal({ paymentId: 'pay-6', refundAmount: 100, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, partialConn),
    /Partial refunds are not enabled/,
  );

  const paymobConn = mockConn({
    id: 'pay-7', subscriber_id: 's1', course_id: null, bundle_id: null,
    amount: 500, amount_egp: 500, currency: 'EGP', payment_type: 'OTHER',
    payment_method: 'paymob_card', source: 'paymob', status: 'paid',
  });
  await assert.rejects(
    () => applyRefundReversal({ paymentId: 'pay-7', refundAmount: 500, refundCurrency: 'EGP', tenantId: 't1', actor: 'admin' }, paymobConn),
    /Paymob refunds are suspended/,
  );
});

// ── Paymob double-webhook guard ─────────────────────────────────────────────
// The payments INSERT in finalisePaymobOrder is the only thing standing between
// a retried webhook and a second journal posting for the same money. The two
// idempotency checks before it are reads outside the transaction, so a
// concurrent pair can pass both. If that INSERT ever starts swallowing
// duplicates, the same revenue gets booked twice with no error anywhere.
test('the paymob payments insert must not swallow duplicate keys', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'routes', 'public-orders.js'), 'utf8');
  const start = source.indexOf('INSERT INTO payments');
  assert.ok(start > 0, 'the payments insert must exist');
  const statement = source.slice(start, source.indexOf(';', start));
  assert.ok(!/ON DUPLICATE KEY/i.test(statement),
    'ON DUPLICATE KEY UPDATE here would let postPaymentJournal book the same payment twice');
  assert.ok(!/INSERT\s+IGNORE/i.test(statement),
    'INSERT IGNORE here would have the same effect as ON DUPLICATE KEY UPDATE');
});

test('the paymob in-flight guard must work across processes, not just one', () => {
  // A Set lives in one Node process. The API runs behind a process manager, so
  // a second worker has its own empty Set and walks straight past it — two
  // workers could then finalise the same order at once. Only a lock the workers
  // share (the database) actually guards this.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'routes', 'public-orders.js'), 'utf8');
  const start = source.indexOf('async function finalisePaymobOrder');
  const guard = source.slice(start, source.indexOf('async function _finalisePaymobOrderInner'));
  assert.match(guard, /GET_LOCK/, 'the guard must take a database-level lock');
  assert.match(guard, /RELEASE_LOCK/, 'and release it');
  assert.ok(/finally\s*\{[\s\S]*RELEASE_LOCK/.test(guard),
    'the release must be in a finally, or a thrown error strands the lock until the session ends');
  assert.ok(/finally\s*\{[\s\S]*lockConn\.release\(\)/.test(guard),
    'the lock connection must be returned to the pool in a finally');
});
