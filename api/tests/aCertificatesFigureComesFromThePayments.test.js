'use strict';
/**
 * «في بعض الشهادات مكتوب سعرها غلط في جدول عملاء الاونلاين محتاجة مراجعة دقيقة جدا» (15 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { certificateDue } = require('../lib/certificatePricing');
const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('a certificate shows the price list\'s figure for its type and currency, else its own price', () => {
  const pricing = { AIN_SHAMS: { egyptianEGP: 1000, residentEGP: 1000, residentSAR: 900, foreignUSD: 60 } };
  assert.equal(certificateDue(pricing, { type: 'AIN_SHAMS', currency: 'EGP', price: 500 }), 1000, 'a stale price is not shown');
  assert.equal(certificateDue(pricing, { type: 'AIN_SHAMS', currency: 'SAR', price: 500 }), 900);
  assert.equal(certificateDue(pricing, { type: 'OTHER', currency: 'EGP', price: 750 }), 750, 'nothing on the list: its own');
  assert.equal(certificateDue({}, { type: 'OTHER', currency: 'EGP', price: null }), 0);
});

test('the clients lists read that figure, voiding a certificate payment takes its money off, and the review exists', () => {
  for (const file of ['api/routes/admin/stafflists.js', 'api/routes/admin/subscribers.js']) {
    assert.match(read(file), /price: certificateDue\(certificatePricingConfig, request\) \|\| undefined/, file);
  }
  const voiding = read('api/lib/paymentCorrections.js');
  assert.match(voiding, /if \(pay\.certificate_request_id\) await syncCertificateRequest\(conn, tenantId, pay\.certificate_request_id\)/);
  const routes = read('api/routes/certificates.js');
  assert.match(routes, /router\.get\('\/api\/admin\/certificate-requests\/audit'/);
  assert.match(routes, /router\.post\('\/api\/admin\/certificate-requests\/audit\/fix'/);
  assert.match(read('admin/pages/dashboard/tabs/CertRequestsTab.tsx'), /<CertificatePriceAudit /);
});
