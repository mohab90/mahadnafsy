'use strict';

// The owner's certificates round (26 Oct 2026): institute certificates in the section, the English name typed once and read everywhere, a mark when a
// certificate was printed at the institute or downloaded by the client, a delete button for a wrong one, the certificate itself on the client's page
// with two prints, a track as ONE certificate, training hours on every course and track, the form's measurements saved once, and «إضافة شهادة».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('the English name typed on a request is the client\'s: fallback chain, sync on save, and a backfill', () => {
  const { effectiveCertificate } = require('../lib/certificateEnglish');
  const base = { cert_course_en: 'Course', course_title_en: 'Course', cert_duration: '60 Hours' };
  assert.equal(effectiveCertificate({ ...base, request_name_en: 'MOHAMED ALI' }).name, 'MOHAMED ALI',
    'a client whose file has no English name prints the one typed on their certificate request');
  assert.equal(effectiveCertificate({ ...base, name_en: 'File Name', request_name_en: 'MOHAMED ALI' }).name, 'FILE NAME');
  assert.equal(effectiveCertificate({ ...base, cert_name_en: 'Desk Name', name_en: 'File Name' }).name, 'DESK NAME');
  assert.match(read('api/routes/certificates.js'), /UPDATE subscribers SET name_en=\? WHERE id=\? AND tenant_id=\? AND \(name_en IS NULL OR TRIM\(name_en\)=''\)/);
  assert.match(read('api/migrations/307_v26_certificates_print_marks_tracks_hours.sql'), /UPDATE subscribers s\s+JOIN \(SELECT cr\.tenant_id, cr\.subscriber_id/);
});

test('the migration adds the print marks, the soft delete and the track hours', () => {
  const sql = read('api/migrations/307_v26_certificates_print_marks_tracks_hours.sql');
  for (const column of ['printed_at DATETIME', 'printed_by VARCHAR', 'print_count INT', 'deleted_at DATETIME', 'deleted_by VARCHAR']) {
    assert.match(sql, new RegExp(`ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /ALTER TABLE bundles ADD COLUMN IF NOT EXISTS hours DOUBLE NULL/);
});

test('a wrong certificate is deleted softly — revoked first — and the client\'s lists leave it out', () => {
  const lms = read('api/routes/lms.js');
  const route = lms.slice(lms.indexOf("router.delete('/api/admin/completions/:id'"));
  assert.match(route, /requirePermission\('manage_courses'\)/);
  assert.match(route, /row\.status === 'active'\) return res\.status\(409\)/, 'a valid certificate is revoked before it can be deleted');
  assert.match(route, /UPDATE course_completions SET deleted_at=NOW\(\), deleted_by=\? WHERE id=\? AND tenant_id=\?/);
  assert.match(read('api/routes/admin/subscribers.js'), /cc\.deleted_at IS NULL/);
  assert.match(read('api/routes/admin/stafflists.js'), /cc\.deleted_at IS NULL/);
  assert.match(read('api/routes/instituteCertificates.js'), /cc\.deleted_at IS NULL/);
});

test('the desk\'s print is recorded, the client\'s download is recorded apart, and the client page shows both', () => {
  const desk = read('api/routes/instituteCertificates.js');
  assert.match(desk, /router\.post\('\/api\/admin\/institute-certificates\/:id\/printed'/);
  assert.match(desk, /SET printed_at = NOW\(\), printed_by = \?, print_count = print_count \+ 1/);
  assert.match(read('api/routes/admin/subscribers.js'), /printedAt: safeIsoString\(completion\.printed_at\)[\s\S]*downloadedAt: safeIsoString\(completion\.downloaded_at\)/);
  const panel = read('admin/pages/unified-client/UnifiedClientCertificatesPanel.tsx');
  assert.match(panel, /اتطبعت في المعهد/);
  assert.match(panel, /العميل شافها ونزّلها من حسابه/);
  assert.match(panel, /onDeleteCertificate\(cert\.id\)/);
  assert.match(read('admin/pages/unified-client/useUnifiedClientLifecycleActions.ts'), /adminDelete\(`\/admin\/completions\/\$\{encodeURIComponent\(certificateId\)\}`\)/);
});

test('the client page shows the certificate itself and prints it in full or on the form', () => {
  const modal = read('admin/pages/unified-client/UnifiedClientCertificateViewModal.tsx');
  assert.match(modal, /<iframe/);
  assert.match(modal, /certificate\?staff=1&embed=1/);
  assert.match(modal, /طباعة كاملة/);
  assert.match(modal, /طباعة الاسم والكورس والساعات فقط/);
  assert.match(modal, /institute-certificates\/\$\{encodeURIComponent\(cert\.id\)\}\/printed/);
  assert.match(read('admin/pages/unified-client/UnifiedClientEditTab.tsx'), /تعديل بيانات الشهادة[\s\S]*subscriber\?\.nameEn/, 'the edit tab shows the English name and the national id');
});

test('the form\'s measurements are the institute\'s, saved once on the server, and the print reads them there', () => {
  const desk = read('api/routes/instituteCertificates.js');
  assert.match(desk, /router\.get\('\/api\/admin\/institute-certificates\/layout'/);
  assert.match(desk, /setTenantSetting\('certificate_form_layout', layout/);
  assert.match(read('api/routes/public.js'), /getTenantSetting\('certificate_form_layout', \{ tenantId: row\.tenant_id/);
  const { formLayout } = require('../lib/certificateHtml');
  assert.deepEqual(Object.keys(formLayout({})).sort(), ['codeTop', 'courseTop', 'hoursTop', 'nameTop']);
  assert.equal(formLayout({ nameTop: 17, courseTop: 22, hoursTop: 23.5, codeTop: 25 }).hoursTop, 23.5);
  const lib = read('admin/lib/certificateForm.ts');
  assert.doesNotMatch(lib, /localStorage/, 'no per-computer offsets any more');
  assert.match(read('admin/pages/dashboard/tabs/InstituteCertificatesPanel.tsx'), /<FormLayoutModal/);
});

test('«إضافة شهادة»: search a client, their courses and tracks, issue and print', () => {
  const modal = read('admin/pages/dashboard/tabs/AddInstituteCertificateModal.tsx');
  assert.match(modal, /\/admin\/client-lookup\?q=/);
  assert.match(modal, /institute-certificates\/client\/\$\{encodeURIComponent\(subscriberId\)\}\/items/);
  assert.match(modal, /force: true/);
  assert.match(read('admin/pages/dashboard/tabs/InstituteCertificatesPanel.tsx'), /<AddInstituteCertificateModal/);
  assert.match(read('api/routes/instituteCertificates.js'), /router\.post\('\/api\/admin\/institute-certificates', \.\.\.desk/);
});

test('training hours are set on every course and every track, and the certificate prints them', () => {
  assert.match(read('api/routes/core/catalog.js'), /hours=VALUES\(hours\)/);
  assert.match(read('api/lib/mappers.js'), /hours: r\.hours != null && Number\(r\.hours\) > 0/);
  assert.match(read('admin/pages/dashboard/tabs/courses/BundlesPanel.tsx'), /ساعات التدريب اللي بتطلع في شهادة المسار/);
  assert.match(read('admin/pages/dashboard/tabs/CoursesTab.tsx'), /ساعات التدريب اللي بتطلع في الشهادة/);
  assert.match(read('api/routes/public.js'), /COALESCE\(c\.hours, b\.hours\) AS hours_count/);
});
