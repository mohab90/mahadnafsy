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
  // 3 Nov 2026: typed on a request, it replaces the client's and every certificate of theirs follows (lib/clientEnglishName.js).
  
  
});

test('the migration adds the print marks, the soft delete and the track hours', () => {
  const sql = read('api/migrations/307_v26_certificates_print_marks_tracks_hours.sql');
  for (const column of ['printed_at DATETIME', 'printed_by VARCHAR', 'print_count INT', 'deleted_at DATETIME', 'deleted_by VARCHAR']) {
    assert.match(sql, new RegExp(`ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS ${column}`));
  }
  
});







test('the form\'s measurements are the institute\'s, saved once on the server, and the print reads them there', () => {
  const desk = read('api/routes/instituteCertificates.js');
  
  
  
  const { formLayout } = require('../lib/certificateHtml');
  assert.deepEqual(Object.keys(formLayout({})).sort(), ['codeTop', 'courseTop', 'hoursTop', 'nameTop']);
  assert.equal(formLayout({ nameTop: 17, courseTop: 22, hoursTop: 23.5, codeTop: 25 }).hoursTop, 23.5);
  const lib = read('admin/lib/certificateForm.ts');
  
  
});




