'use strict';

// «شهادة المعهد … لازم يظهر اسم العميل واسم الكورس بالانجليزي فقط مينفعش بالعربي في
// الشهادة دي» (13 Oct 2026). The certificate fell back to the Arabic name and the
// Arabic course title when the English ones were missing, and printed them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isEnglish, certificateName, certificateCourse, missingForCertificate } = require('../lib/certificateEnglish');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('English means Latin letters and no Arabic ones', () => {
  assert.equal(isEnglish('Ahmed Ali'), true);
  assert.equal(isEnglish("Mohammed Al-Otaibi Jr."), true);
  assert.equal(isEnglish('أحمد علي'), false);
  assert.equal(isEnglish('Ahmed أحمد'), false, 'a mixed name is not English');
  assert.equal(isEnglish('١٢٣'), false);
  assert.equal(isEnglish('   '), false);
  assert.equal(isEnglish(null), false);
});

test('the name prints in capitals from the English name only', () => {
  assert.equal(certificateName('  ahmed   ali  hassan '), 'AHMED ALI HASSAN');
  assert.equal(certificateName('أحمد علي حسن'), null, 'never the Arabic name');
  assert.equal(certificateName(''), null);
});

test('the course is its English title, else a main title that is English, never the Arabic one', () => {
  assert.equal(certificateCourse({ title_en: 'Clinical Psychology Diploma', title: 'دبلومة علم النفس' }), 'Clinical Psychology Diploma');
  assert.equal(certificateCourse({ title_en: null, title: 'CBT Practitioner' }), 'CBT Practitioner');
  assert.equal(certificateCourse({ title_en: '', title: 'دبلومة علم النفس الإكلينيكي' }), null);
  assert.equal(certificateCourse({ title_en: 'دبلومة', title: 'دبلومة' }), null);
  assert.equal(certificateCourse(), null);
});

test('what is missing is said in Arabic for the desk', () => {
  assert.deepEqual(missingForCertificate({ nameEn: 'Ahmed Ali', courseTitleEn: 'CBT', courseTitle: 'x' }), []);
  assert.deepEqual(missingForCertificate({ nameEn: '', courseTitleEn: 'CBT' }), ['الاسم بالإنجليزي للعميل']);
  assert.deepEqual(missingForCertificate({ nameEn: 'Ahmed Ali', courseTitleEn: '', courseTitle: 'دبلومة' }), ['اسم الكورس بالإنجليزي']);
  assert.deepEqual(missingForCertificate({}), ['الاسم بالإنجليزي للعميل', 'اسم الكورس بالإنجليزي']);
});

test('the printable certificate refuses to fall back to the Arabic name or title', () => {
  const route = read('api/routes/public.js');
  const start = route.indexOf("router.get('/api/completions/:code/certificate'");
  const certificate = route.slice(start, start + 6000);
  assert.match(certificate, /s\.name_en AS subscriber_name_en/);
  assert.doesNotMatch(certificate, /COALESCE\(NULLIF\(s\.name_en, ''\), s\.name\)/, 'the Arabic name is no fallback');
  // The name and the course come only through the English-only rule (the desk's own change included).
  assert.match(certificate, /effectiveCertificate\(\{/);
  assert.match(certificate, /name_en: row\.subscriber_name_en/);
  assert.match(certificate, /const studentName = certificate\.name;/);
  assert.match(certificate, /const courseName  = certificate\.course;/);
  assert.match(certificate, /res\.status\(409\)/);
  assert.match(certificate, /الشهادة غير جاهزة للطباعة/);
});

test("the desk's list says what is missing; a certificate that is not ready offers no link, only the edit that completes it", () => {
  assert.match(read('api/routes/instituteCertificates.js'), /missing: missingForCertificate\(/);
  const panel = read('admin/pages/dashboard/tabs/InstituteCertificatesPanel.tsx');
  assert.match(panel, /const ready = !row\.missing\?\.length;/);
  assert.match(panel, /!ready && \(/, 'it says what is missing');
  assert.match(panel, /share && ready && \(/, 'no share for a certificate that is not ready');
  assert.match(panel, /setEditing\(row\)\} title=\{`ناقص:/, 'the dead button opens the edit dialog');
  assert.doesNotMatch(panel, /هيطلع بالعربي/, 'the old promise of an Arabic certificate is gone');
});

test("the client's own viewer never shows an Arabic name or course", () => {
  const viewer = read('client/components/CourseCertificate.tsx');
  assert.match(viewer, /const certName  = \(englishOnly\(edits\?\.nameEn\) \|\| englishOnly\(studentNameEn\)\)\.toUpperCase\(\);/);
  assert.match(viewer, /englishOnly\(edits\?\.courseEn\) \|\| englishOnly\(courseNameEn\) \|\| englishOnly\(courseName\)/);
  assert.doesNotMatch(viewer, /\(studentNameEn \|\| studentName\)/);
  assert.match(viewer, /if \(incomplete\) \{/);
});
