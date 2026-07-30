'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCertificatePayment } = require('../lib/certificatePayments');

function fakeDb(initialRequest = null) {
  const state = { request: initialRequest ? structuredClone(initialRequest) : null, inserts: 0, updates: 0 };
  return {
    state,
    async query(sql, params) {
      if (sql.includes('FROM certificate_requests') && sql.includes('FOR UPDATE')) {
        return [[state.request ? structuredClone(state.request) : undefined]];
      }
      if (sql.startsWith('INSERT INTO certificate_requests')) {
        state.request = {
          id: params[0], subscriber_id: params[1], course_id: params[2], type: params[3],
          status: params[4], price: params[5], paid_amount: params[6], currency: params[7],
        };
        state.inserts += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE certificate_requests')) {
        state.request.paid_amount = params[0];
        state.request.currency ||= params[1];
        state.request.status = state.request.price == null || Number(state.request.price) <= Number(params[2])
          ? 'PAID'
          : 'PRICED';
        state.updates += 1;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('certificate payment creates one table-backed request and can leave it pending approval', async () => {
  const db = fakeDb();
  const payment = {
    id: 'pay-1', subscriber_id: 'sub-1', certificate_request_id: 'certreq-1',
    cert_type: 'institute', course_id: 'course-1', amount: 500,
    currency: 'EGP', date: '2026-07-25',
  };
  const id = await applyCertificatePayment(payment, db, 'tenant-1', { settle: false });

  assert.equal(id, 'certreq-1');
  assert.equal(db.state.inserts, 1);
  assert.deepEqual(db.state.request, {
    id: 'certreq-1',
    subscriber_id: 'sub-1',
    course_id: 'course-1',
    type: 'INSTITUTE',
    status: 'PRICED',
    price: 500,
    paid_amount: 0,
    currency: 'EGP',
  });

  await applyCertificatePayment(payment, db, 'tenant-1');
  assert.equal(db.state.request.paid_amount, 500);
  assert.equal(db.state.request.status, 'PAID');
});

test('certificate settlement rejects ownership, overpayment and currency drift', async () => {
  const request = {
    id: 'certreq-2', subscriber_id: 'sub-1', type: 'INSTITUTE', status: 'PRICED',
    price: 1000, paid_amount: 400, currency: 'EGP',
  };
  const payment = {
    id: 'pay-2', subscriber_id: 'sub-1', certificate_request_id: 'certreq-2',
    cert_type: 'institute', amount: 600, currency: 'EGP', date: '2026-07-25',
  };
  const db = fakeDb(request);

  await applyCertificatePayment(payment, db, 'tenant-1');
  assert.equal(db.state.request.paid_amount, 1000);
  assert.equal(db.state.request.status, 'PAID');
  await assert.rejects(() => applyCertificatePayment(payment, db, 'tenant-1'), /already fully paid/);

  await assert.rejects(
    () => applyCertificatePayment({ ...payment, subscriber_id: 'sub-2' }, fakeDb(request), 'tenant-1'),
    /another subscriber/,
  );
  await assert.rejects(
    () => applyCertificatePayment({ ...payment, currency: 'SAR' }, fakeDb(request), 'tenant-1'),
    /currency does not match/,
  );
});
