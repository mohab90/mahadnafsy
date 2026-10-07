'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCertificatePayment } = require('../lib/certificatePayments');

function fakeDb(initialRequest = null) {
  const state = { request: initialRequest ? structuredClone(initialRequest) : null, inserts: 0, updates: 0 };
  return {
    state,
    async query(sql, params) {
      if (sql.includes('FROM tenant_settings')) return [[state.content ? { config_json: JSON.stringify(state.content) } : undefined]];
      if (sql.includes('FROM site_config')) return [[undefined]];
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
        // SET paid_amount=?, currency=COALESCE(currency,?), price=?, status=CASE WHEN ? IS NULL OR ?<=? …
        state.request.paid_amount = params[0];
        state.request.currency ||= params[1];
        state.request.price = params[2];
        state.request.status = params[3] == null || Number(params[4]) <= Number(params[5]) ? 'PAID' : 'PRICED';
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

// «لما بندخل ان العميل دفع 500 من سعر الشهاده بيسجل ان الشهاده كلها ب500» (7 Oct 2026).
test("part of a certificate paid is part paid: the price is the certificate's, not the payment", async () => {
  const db = fakeDb();
  await applyCertificatePayment({
    id: 'pay-9', subscriber_id: 'sub-1', certificate_request_id: 'certreq-9', amount: 500, currency: 'EGP',
    cert_type: 'AMERICAN_BOARD', price: 1800,
  }, db, 'tenant-default');
  assert.equal(db.state.request.price, 1800);
  assert.equal(db.state.request.paid_amount, 500);
  assert.equal(db.state.request.status, 'PRICED', 'still owed 1,300');
});

test("with no price typed, the certificate takes the price list's", async () => {
  const db = fakeDb();
  db.state.content = { extra_cert_pricing: JSON.stringify({ american_board: { egyptianEGP: 1800, residentSAR: 300, foreignUSD: 90 } }) };
  await applyCertificatePayment({
    id: 'pay-10', subscriber_id: 'sub-1', certificate_request_id: 'certreq-10', amount: 300, currency: 'SAR', cert_type: 'AMERICAN_BOARD',
  }, db, 'tenant-default');
  assert.equal(db.state.request.price, 300, 'the SAR price, as the dialog reads it');
  assert.equal(db.state.request.status, 'PAID');
});
