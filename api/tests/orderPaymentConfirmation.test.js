'use strict';
/**
 * Behavioral tests for lib/orderPaymentConfirmation.js#confirmOrderPayment —
 * the core of POST /api/admin/orders/:id/confirm-payment (PAY-02/PAY-06).
 * Before this endpoint existed, the admin "Confirm Payment" button and both
 * transfer-linking modals called the generic PATCH with status:'paid', which
 * PATCH deliberately rejects (409) for financial statuses — so every click
 * silently did nothing. Uses a mock connection, no real DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmOrderPayment } = require('../lib/orderPaymentConfirmation');

function mockConn(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const hit = responses.find(r => sql.includes(r.match));
      if (!hit) throw new Error(`mockConn: no canned response for: ${sql.slice(0, 100)}...`);
      return typeof hit.rows === 'function' ? hit.rows(params) : [hit.rows];
    },
  };
}

const baseOrder = {
  id: 'order-1', type: 'course', item_id: 'course-1', item_title: 'Course One',
  amount: 500, currency: 'EGP', payment_method: 'transfer', transaction_id: null,
  subscriber_id: 'sub-1', customer_email: null, customer_name: null, customer_phone: null,
};
const subRow = { id: 'sub-1', tenant_id: 't1', lead_id: null, branch: 'ONLINE_EGYPT', branch_id: 'b1' };

test('confirmOrderPayment: creates a real payment row, posts the journal, and marks the order paid (PAY-02)', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [subRow] },
    { match: 'INSERT INTO payments', rows: {} },
    { match: 'INSERT INTO journal_entries', rows: {} },
    { match: 'tenant_chart_of_accounts', rows: {} },
    { match: 'INSERT INTO journal_entry_lines', rows: {} },
    { match: 'fx_rate_to_egp', rows: {} },
    { match: 'FROM courses WHERE id=', rows: [{ id: 'course-1' }] },
    { match: 'INSERT INTO enrollments', rows: {} },
    { match: "UPDATE orders SET status='paid'", rows: {} },
  ]);

  const { paymentId } = await confirmOrderPayment(
    { order: baseOrder, transfer: null, linkedTransferId: null, tenantId: 't1', staffId: 'staff-1', staffName: 'Staff One', actorEmail: 'admin@x.com' },
    conn
  );

  assert.ok(paymentId.startsWith('manual-'), 'must mint a dedicated manual-* payment id, not reuse the order id');

  const payInsert = conn.calls.find(c => c.sql.includes('INSERT INTO payments'));
  assert.ok(payInsert, 'must actually write a payments row — this is the exact step PAY-02 was skipping');
  assert.equal(payInsert.params[0], paymentId);
  assert.equal(payInsert.params[4], 500, 'amount must come from the order');

  assert.ok(conn.calls.some(c => c.sql.includes('INSERT INTO journal_entries')), 'must post a journal entry, not just a bare status flip');
  assert.ok(conn.calls.some(c => c.sql.includes('INSERT INTO enrollments')), 'must grant enrollment for a course order');

  const orderUpdate = conn.calls.find(c => c.sql.includes("UPDATE orders SET status='paid'"));
  assert.ok(orderUpdate, 'must flip the order to paid');
  assert.equal(orderUpdate.params[1], null, 'linked_transfer_id stays null when no transfer was linked');

  assert.ok(!conn.calls.some(c => c.sql.includes('UPDATE leads')), 'must not touch leads when the subscriber has none linked');
});

test('confirmOrderPayment: enrolls in every course of a bundle order', async () => {
  const bundleOrder = { ...baseOrder, type: 'bundle', item_id: 'bundle-1' };
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [subRow] },
    { match: 'INSERT INTO payments', rows: {} },
    { match: 'INSERT INTO journal_entries', rows: {} },
    { match: 'tenant_chart_of_accounts', rows: {} },
    { match: 'INSERT INTO journal_entry_lines', rows: {} },
    { match: 'fx_rate_to_egp', rows: {} },
    { match: 'FROM bundle_courses', rows: (rows => [{ course_id: 'c1' }, { course_id: 'c2' }])() },
    { match: 'INSERT INTO enrollments', rows: {} },
    { match: "UPDATE orders SET status='paid'", rows: {} },
  ]);

  await confirmOrderPayment(
    { order: bundleOrder, transfer: null, linkedTransferId: null, tenantId: 't1', actorEmail: 'admin@x.com' },
    conn
  );

  const enrollCalls = conn.calls.filter(c => c.sql.includes('INSERT INTO enrollments'));
  assert.equal(enrollCalls.length, 2, 'must enroll into every course belonging to the bundle');
  assert.deepEqual(enrollCalls.map(c => c.params[2]).sort(), ['c1', 'c2']);
});

test('confirmOrderPayment: linking a transfer carries its payment method/transaction id and marks the order linked (PAY-06)', async () => {
  const transfer = { id: 'transfer-1', payment_method: 'INSTAPAY', transaction_id: 'txn-transfer-1' };
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [subRow] },
    { match: 'INSERT INTO payments', rows: {} },
    { match: 'INSERT INTO journal_entries', rows: {} },
    { match: 'tenant_chart_of_accounts', rows: {} },
    { match: 'INSERT INTO journal_entry_lines', rows: {} },
    { match: 'fx_rate_to_egp', rows: {} },
    { match: 'FROM courses WHERE id=', rows: [{ id: 'course-1' }] },
    { match: 'INSERT INTO enrollments', rows: {} },
    { match: "UPDATE orders SET status='paid'", rows: {} },
  ]);

  await confirmOrderPayment(
    { order: baseOrder, transfer, linkedTransferId: 'transfer-1', tenantId: 't1', actorEmail: 'admin@x.com' },
    conn
  );

  const payInsert = conn.calls.find(c => c.sql.includes('INSERT INTO payments'));
  assert.equal(payInsert.params[7], 'INSTAPAY', 'must inherit the transfer payment method');
  assert.equal(payInsert.params[8], 'txn-transfer-1', 'must inherit the transfer transaction id');

  const orderUpdate = conn.calls.find(c => c.sql.includes("UPDATE orders SET status='paid'"));
  assert.equal(orderUpdate.params[1], 'transfer-1', 'must record the linked transfer id (closes PAY-06)');
});

test('confirmOrderPayment: converts the linked lead when the subscriber came from one', async () => {
  const subWithLead = { ...subRow, lead_id: 'lead-1' };
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [subWithLead] },
    { match: 'INSERT INTO payments', rows: {} },
    { match: 'INSERT INTO journal_entries', rows: {} },
    { match: 'tenant_chart_of_accounts', rows: {} },
    { match: 'INSERT INTO journal_entry_lines', rows: {} },
    { match: 'fx_rate_to_egp', rows: {} },
    { match: 'FROM courses WHERE id=', rows: [{ id: 'course-1' }] },
    { match: 'INSERT INTO enrollments', rows: {} },
    { match: "UPDATE orders SET status='paid'", rows: {} },
    { match: 'FROM leads WHERE id=', rows: [{ id: 'lead-1', status: 'new' }] },
    { match: 'UPDATE leads SET status', rows: {} },
    { match: 'INSERT INTO lead_timeline', rows: {} },
  ]);

  await confirmOrderPayment(
    { order: baseOrder, transfer: null, linkedTransferId: null, tenantId: 't1', actorEmail: 'admin@x.com' },
    conn
  );

  const leadUpdate = conn.calls.find(c => c.sql.includes('UPDATE leads SET status'));
  assert.ok(leadUpdate, 'must convert the linked lead once the order is confirmed');
  assert.equal(leadUpdate.params[0], 'converted');
});

test('confirmOrderPayment: throws when the journal fails to post (never leaves a payment with no ledger trace)', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [subRow] },
    { match: 'INSERT INTO payments', rows: {} },
  ]);
  const zeroAmountOrder = { ...baseOrder, amount: 0 };

  await assert.rejects(
    () => confirmOrderPayment({ order: zeroAmountOrder, transfer: null, linkedTransferId: null, tenantId: 't1', actorEmail: 'admin@x.com' }, conn),
    /journal posting failed/i
  );
});
