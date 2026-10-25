'use strict';

// «دا شكل الشهادة … مطابق 100% للصورة» (14 Oct 2026). The institute's design is one
// picture; the certificate IS that picture with the client's lines written on it.
//   · the client's own copy shows the whole design;
//   · the desk's copy («من السيستم») prints onto the pre-printed paper: only the name
//     (17 cm from the top) and the course (22 cm) with its duration under it, the
//     trainer left empty;
//   · the desk can change the name, the course, the duration and the trainer on one
//     certificate, English only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const { certificateHtml, certificateFormHtml, formOffsets } = require('../lib/certificateHtml');
const { effectiveCertificate, certificateDuration } = require('../lib/certificateEnglish');

const sample = {
  studentName: 'AHMED MOHAMED ALI', courseName: 'Clinical Psychology Diploma', duration: '60 Hours', trainer: 'Dr Sara Adel',
  serialNo: 'C-1', certCode: 'CERT-ABC-123', year: '2026', issuedAt: 'October 14, 2026', qrUrl: '/api/qr?size=90&data=x', verifyUrl: 'https://example.test/certificate/x',
};

test("the client's copy is the supplied picture with the lines written on it", () => {
  const html = certificateHtml(sample);
  assert.ok(html.includes('src="/api/certificate-template.jpg"'), 'the picture is the design');
  assert.ok(html.includes('>AHMED MOHAMED ALI</div>'));
  assert.ok(html.includes('>Clinical Psychology Diploma</div>'));
  assert.ok(html.includes('>completed 60 training hours in 2026</div>'), 'the sentence under the course');
  assert.ok(html.includes('>CERT-ABC-123</div>'), "the certificate's own code, small, under it");
  assert.match(html, /font-weight:900;color:#000[^>]*>Clinical Psychology Diploma/, 'the course is bold and solid black');
  assert.ok(html.includes('>Dr Sara Adel</div>'), "the course's trainer is written for the client");
  assert.doesNotMatch(html, /<svg/, 'nothing of the design is redrawn');
  const jpg = fs.readFileSync(path.join(__dirname, '../assets/certificate-template.jpg'));
  assert.equal(jpg.readUInt16BE(0), 0xFFD8, 'the template is a JPEG');
});

test('the desk copy writes the name, the course, the sentence and the code, at 16 and 22.6 cm, and leaves the trainer empty', () => {
  const html = certificateFormHtml({ ...sample });
  assert.ok(html.includes('>AHMED MOHAMED ALI</span>'));
  assert.ok(html.includes('>Clinical Psychology Diploma</span>'));
  assert.ok(html.includes('>completed 60 training hours in 2026</span>'));
  assert.ok(html.includes('>CERT-ABC-123</span>'), 'the code prints on the paper too');
  assert.ok(!html.includes('Dr Sara Adel'), 'the trainer is for a pen');
  assert.ok(!html.includes('C-1<') && !html.includes('QR'), 'no serial, no QR on the paper');
  assert.match(html, /top:calc\(16cm - 0\.8cm\)/, 'the name is 16 cm from the top — 1 cm higher');
  assert.match(html, /top:calc\(22\.6cm - 0\.8cm\)/, 'the course is a little lower');
  assert.match(html, /class="guide"/, 'the picture is only a screen guide');
  assert.match(read('api/routes/public.js'), /\.toolbar, \.verify-note, \.guide \{ display: none !important; \}/, 'and never printed');
});

test('the distances can be moved, but stay on the sheet', () => {
  assert.deepEqual(formOffsets({ nameTop: '16.5', courseTop: '21' }), { nameTop: 16.5, courseTop: 21 });
  assert.deepEqual(formOffsets({ nameTop: '99', courseTop: 'abc' }), { nameTop: 16, courseTop: 22.6 });
  assert.deepEqual(formOffsets(), { nameTop: 16, courseTop: 22.6 });
  assert.match(certificateFormHtml({ ...sample, nameTop: 16, courseTop: 21 }), /top:calc\(16cm - 0\.8cm\)/);
});

test('a duration is English, from the desk or from the course hours', () => {
  assert.equal(certificateDuration('6 Months', 60), '6 Months');
  assert.equal(certificateDuration('', 60), '60 Hours');
  assert.equal(certificateDuration('', 12.5), '12.5 Hours');
  assert.equal(certificateDuration('', null), '');
  assert.equal(certificateDuration('٦٠ ساعة', 60), '', 'an Arabic duration is not printed');
});

test("the desk's change on one certificate wins; otherwise the client's file and the course say it", () => {
  const sources = { name_en: 'ali hassan', course_title_en: 'CBT Practitioner', hours: 40, instructor_name: 'Dr Mona' };
  assert.deepEqual(effectiveCertificate(sources), { name: 'ALI HASSAN', course: 'CBT Practitioner', duration: '40 Hours', trainer: 'Dr Mona' });
  assert.deepEqual(
    effectiveCertificate({ ...sources, cert_name_en: 'Aly Hassan Mostafa', cert_course_en: 'CBT Diploma', cert_duration: '3 Months', cert_trainer: 'Dr Hany' }),
    { name: 'ALY HASSAN MOSTAFA', course: 'CBT Diploma', duration: '3 Months', trainer: 'Dr Hany' });
  assert.equal(effectiveCertificate({ ...sources, cert_name_en: 'علي حسن' }).name, 'ALI HASSAN', 'an Arabic change is ignored: English only');
});

test('a name or a course from the database is escaped, never markup', () => {
  for (const html of [
    certificateHtml({ ...sample, studentName: 'A <B> & C', courseName: '<img src=x onerror=1>', trainer: '<b>x</b>' }),
    certificateFormHtml({ ...sample, studentName: 'A <B> & C', courseName: '<img src=x onerror=1>' }),
  ]) {
    assert.ok(html.includes('A &lt;B&gt; &amp; C'));
    assert.ok(!html.includes('<img src=x') && !html.includes('<b>x</b>'));
  }
});

test('a long name shrinks to stay on one line', () => {
  const size = html => Number(/font-size:(\d+)px;font-weight:900;color:#000/.exec(html)[1]);
  assert.equal(size(certificateHtml({ ...sample, studentName: 'ALI HASSAN' })), 30);
  const long = size(certificateHtml({ ...sample, studentName: 'MOHAMED ABDELRAHMAN IBRAHIM EL SAYED HASSAN' }));
  assert.ok(long < 20 && long >= 14);
});

test('the page serves the form copy, the picture, and never counts the desk as a download', () => {
  const route = read('api/routes/public.js');
  assert.match(route, /const formMode = String\(req\.query\.mode \|\| ''\) === 'form';/);
  assert.match(route, /if \(!formMode && !embedded && String\(req\.query\.staff \|\| ''\) !== '1'\) \{/);
  assert.match(route, /router\.get\('\/api\/certificate-template\.jpg'/);
  assert.match(route, /@page \{ size: A4 portrait; margin: 0; \}/);
});

test('the desk can edit, and print on the form, from the certificates list', () => {
  const routes = read('api/routes/instituteCertificates.js');
  assert.match(routes, /router\.put\('\/api\/admin\/institute-certificates\/:id\/edit'/);
  assert.match(routes, /CERT_ENGLISH_ONLY/);
  assert.match(read('api/migrations/281_v26_certificate_edits.sql'), /cert_name_en VARCHAR\(160\)/);
  const panel = read('admin/pages/dashboard/tabs/InstituteCertificatesPanel.tsx');
  assert.match(panel, /طباعة على النموذج/);
  assert.match(panel, /<CertificateEditModal /);
  assert.match(read('admin/lib/certificateForm.ts'), /nameTop: 16, courseTop: 22\.6/);
});

test("the client's viewer writes the same lines on the same picture", () => {
  const sheet = read('client/components/CertificateSheet.tsx');
  assert.match(sheet, /CERT_TEMPLATE = '\/api\/certificate-template\.jpg'/);
  for (const needle of ['{certName}', '{certCourse}', '{line}', '{trainer}', 'completed ${hours[1]} training hours']) assert.ok(sheet.includes(needle), needle);
  assert.doesNotMatch(sheet, /<svg/, 'nothing of the design is redrawn');
  assert.match(read('client/components/CourseCertificate.tsx'), /<CertificateSheet/);
  // Printing is the server's page: it carries its own nonce'd script (the API's policy allows none).
  const page = read('api/routes/public.js');
  assert.match(page, /script-src 'nonce-\$\{nonce\}'/);
  assert.match(page, /document\.getElementById\('printBtn'\)\.addEventListener\('click', printNow\)/);
  assert.doesNotMatch(page, /onclick="window\.print\(\)"/);
});
