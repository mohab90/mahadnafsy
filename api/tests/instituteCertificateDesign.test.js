'use strict';

// «دا شكل الشهادة … بالظبط وبالحرف» (14 Oct 2026): the printable institute
// certificate follows the supplied design — on the server's page and in the
// client's viewer alike — and carries the English name and course only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const { certificateHtml } = require('../lib/certificateHtml');

const sample = {
  studentName: 'AHMED MOHAMED ALI', courseName: 'Clinical Psychology Diploma', trainingManager: 'walid abdrahman',
  serialNo: 'C-1', issuedAt: 'October 14, 2026', logoUrl: '/brand/logo.png', qrUrl: '/api/qr?size=90&data=x', verifyUrl: 'https://example.test/certificate/x',
};

const LINES = [
  'INSTITUTE OF', 'PSYCHOLOGICAL STUDIES', 'CERTIFICATE', 'OF ACHIEVEMENT', 'PSYCHOLOGY INSTITUTE',
  'IS PROUDLY PRESENTED TO', 'FOR THE SUCCESSFUL COMPLETION', 'OF THE TRAINING COURSE', 'Trainer', 'Training manager',
  'PSY TRAINING MANAGER', 'معهد الدراسات', 'النفسية',
];

test('the server sheet has every line of the design, the name and the course', () => {
  const html = certificateHtml(sample);
  for (const line of LINES) assert.ok(html.includes(`>${line}<`), `«${line}» is on the sheet`);
  assert.ok(html.includes('>AHMED MOHAMED ALI</div>'));
  assert.ok(html.includes('>Clinical Psychology Diploma</div>'));
  assert.ok(html.includes('>WALID ABDRAHMAN<'), 'the stamp carries the manager, in capitals');
  assert.match(html, /width="600" height="849"/, 'an A4 portrait canvas');
});

test("the viewer draws the same lines on the same canvas", () => {
  const sheet = read('client/components/CertificateSheet.tsx');
  for (const line of LINES) assert.ok(sheet.includes(`>${line}</text>`), `«${line}» is in the viewer`);
  assert.match(sheet, /CERT_W = 600;/);
  assert.match(sheet, /CERT_H = 849;/);
  assert.match(read('client/components/CourseCertificate.tsx'), /<CertificateSheet/);
});

test('a name or a course from the database is escaped, never markup', () => {
  const html = certificateHtml({ ...sample, studentName: 'A <B> & C', courseName: '<img src=x onerror=1>' });
  assert.ok(html.includes('A &lt;B&gt; &amp; C'));
  assert.ok(!html.includes('<img src=x'), 'no markup through the course title');
});

test('a long name shrinks to stay on one line', () => {
  const short = certificateHtml({ ...sample, studentName: 'ALI HASSAN' });
  const long = certificateHtml({ ...sample, studentName: 'MOHAMED ABDELRAHMAN IBRAHIM EL SAYED HASSAN' });
  const size = html => Number(/font-size:(\d+)px;font-weight:700;color:#C8161D/.exec(html)[1]);
  assert.equal(size(short), 30);
  assert.ok(size(long) < 20 && size(long) >= 14);
});

test('the printed page is one A4 sheet with no margin', () => {
  assert.match(read('api/routes/public.js'), /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.match(read('api/routes/public.js'), /\.cert \{ zoom: 1\.32;/);
  assert.match(read('client/components/CourseCertificate.tsx'), /@page \{ size: A4 portrait; margin: 0; \}/);
});
