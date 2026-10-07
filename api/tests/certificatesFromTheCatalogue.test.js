'use strict';
// «حجز/اشتراك شهادة مش بيظهر الشهادات المدخلة في قسم الشهادات».
//
// «تسعير الشهادات» holds eleven certificates on production, eight of them added
// by customer service. Every screen offering one carried its own list of the
// eight the system started with, and the requests table stored the type in an
// ENUM of those eight — so an added certificate could be priced and never
// requested, and a deleted one was still offered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { certificateTypeCodes, resolveCertificatePrice } = require('../lib/certificatePricing');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const catalogue = {
  social_solidarity: { egyptianEGP: 1400, residentEGP: 1900, residentSAR: 200, foreignUSD: 60, label: 'شهادة التضامن الاجتماعي' },
  '016': { egyptianEGP: 2800, residentEGP: 3800, residentSAR: 550, foreignUSD: 150, label: 'شهادة جامعه الازهر وباعتماد المحافظة' },
};

test('a certificate customer service added can be requested and is priced', () => {
  const codes = certificateTypeCodes(catalogue);
  assert.ok(codes.has('016'));
  assert.ok(codes.has('SOCIAL_SOLIDARITY'));
  assert.ok(!codes.has('NOT_A_CERT'));
  assert.equal(resolveCertificatePrice({ type: '016', nationality: 'EGYPTIAN', pricingConfig: catalogue }).price, 2800);
  // Stored upper-cased, priced from the key as it was typed.
  assert.equal(resolveCertificatePrice({ type: 'SOCIAL_SOLIDARITY', nationality: 'EGYPTIAN', pricingConfig: catalogue }).price, 1400);
  assert.match(read('api/migrations/219_v26_certificate_type_from_the_catalogue.sql'),
    /MODIFY COLUMN type VARCHAR\(64\) NOT NULL/);
  const route = read('api/routes/certificates.js');
  assert.doesNotMatch(route, /CERT_TYPES\.includes/);
  assert.equal((route.match(/certificateTypeCodes\(pricingConfig\)\.has\(/g) || []).length, 2);
});

test('every screen that offers a certificate lists the catalogue', () => {
  const users = [
    'admin/components/PaymentModal.tsx',
    'admin/pages/dashboard/tabs/CertRequestsTab.tsx',
    'admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx',
    'admin/pages/unified-client/UnifiedClientCertificatesPanel.tsx',
    'admin/pages/unified-client/UnifiedClientSidebarCards.tsx',
  ];
  for (const rel of users) {
    const source = read(rel);
    assert.match(source, /useCertificateCatalog\(\)/, rel);
    // None keeps a list of its own.
    assert.doesNotMatch(source, /american_board:\s*'/, rel);
  }
  const student = read('client/components/student-dashboard/StudentCertificatesTab.tsx');
  assert.match(student, /const EXTRA_TYPES = Object\.keys\(certPricingMap\)\.length/);
});
