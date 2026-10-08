'use strict';

// CRIT-04 of the 7 Oct 2026 audit: the automatic certificate waits for 95% of
// the course price, but a completion recorded by staff and a client's own
// certificate request took any payment at all — a 25% instalment earned the
// certificate. One rule now (lib/coursePaid.js), on the price agreed for the
// course or for the track that holds it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPaidForCourse, PAID_SHARE } = require('../lib/coursePaid');
const { PAID_THRESHOLD } = require('../lib/autoCertificate');

// One client: payments by item, «مدفوع قبل السيستم», and the catalogue.
function clientDb({ payments = {}, prior = {}, catalogue = {}, tracks = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ');
      calls.push(flat);
      if (/SELECT crm_json FROM subscribers/.test(flat)) return [[{ crm_json: JSON.stringify({ priorPaid: prior }) }]];
      if (/FROM bundle_courses/.test(flat)) return [tracks.map(id => ({ bundle_id: id }))];
      if (/SELECT currency, SUM\(amount\)/.test(flat)) {
        const key = /bundle_id=\?/.test(flat) ? `bundle:${params[2]}` : params[2];
        return [payments[key] ? [{ currency: 'EGP', paid: payments[key] }] : []];
      }
      if (/MAX\(course_expected\)/.test(flat)) return [[{ price: null, paid: null }]];
      if (/FROM `(courses|bundles)`/.test(flat)) {
        const key = /`bundles`/.test(flat) ? `bundle:${params[0]}` : params[0];
        return [catalogue[key] ? [{ price: catalogue[key] }] : []];
      }
      return [[]];
    },
  };
}
const paid = (db) => hasPaidForCourse(db, { tenantId: 't', subscriberId: 's', courseId: 'c-1' });

test('one share, the automatic certificate\'s', () => {
  assert.equal(PAID_SHARE, 0.9); // «90 % من فلوسه» (8 Oct 2026)
  assert.equal(PAID_THRESHOLD, PAID_SHARE);
});

test('a quarter of the course is not the course; what is left within 5% is', async () => {
  assert.equal(await paid(clientDb({ payments: { 'c-1': 750 }, catalogue: { 'c-1': 3000 } })), false);
  assert.equal(await paid(clientDb({ payments: { 'c-1': 2850 }, catalogue: { 'c-1': 3000 } })), true);
});

test('money paid before the system counts as a payment', async () => {
  assert.equal(await paid(clientDb({ prior: { 'c-1': 3000 }, catalogue: { 'c-1': 3000 } })), true);
  assert.equal(await paid(clientDb({ payments: { 'c-1': 1000 }, prior: { 'c-1': 2000 }, catalogue: { 'c-1': 3000 } })), true);
});

test('a course inside a track is paid when the track is', async () => {
  const track = { tracks: ['b-1'], catalogue: { 'c-1': 3000, 'bundle:b-1': 5000 } };
  assert.equal(await paid(clientDb({ ...track, payments: { 'bundle:b-1': 1250 } })), false);
  assert.equal(await paid(clientDb({ ...track, payments: { 'bundle:b-1': 5000 } })), true);
});

test('with no price anywhere, any money in counts, as before; none does not', async () => {
  assert.equal(await paid(clientDb({ payments: { 'c-1': 100 } })), true);
  assert.equal(await paid(clientDb({})), false);
});

test('the certificate, carnet or book paid beside the course is not the course', async () => {
  const db = clientDb({ payments: { 'c-1': 3000 }, catalogue: { 'c-1': 3000 } });
  await paid(db);
  assert.ok(db.calls.some(sql => /COALESCE\(payment_type, ''\) IN \('', 'COURSE', 'BUNDLE', 'OTHER'\)/.test(sql)));
});
