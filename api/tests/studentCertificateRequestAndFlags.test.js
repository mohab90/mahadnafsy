'use strict';

// «في مشكله حاليا في حجز شهاده واختيار شهادات وشايف في مشاكل في التصميم وعرض الايقونات» (27 Oct 2026).
//
// The student's «طلب شهادة إضافية» printed the server's machine codes («certificate_not_eligible», «courseId required»)
// as its error, offered every enrolled course as «اختياري» when the server refuses a request without one that is
// finished, and the admin's certificate card printed the raw ISO timestamp. Windows draws a flag emoji as two letters,
// so every market chip read «EG محلي» / «SA سعودي».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function load(rel) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, rel)], bundle: true, write: false, format: 'cjs', platform: 'node' });
  const module_ = { exports: {} };
  new Function('module', 'exports', out.outputFiles[0].text)(module_, module_.exports);
  return module_.exports;
}

test('a refused certificate request says what to do, in Arabic, never the server\'s code', () => {
  const lib = load('client/lib/certificateRequestMessage.ts');
  if (!lib) return;
  const say = message => lib.certificateRequestMessage(new Error(message));
  assert.match(say('certificate_not_eligible'), /خلصته/);
  assert.match(say('certificate_request_exists'), /طلبت الشهادة دي/);
  assert.match(say('courseId required'), /اختار الكورس/);
  assert.match(say('not_subscribed'), /مشترك/);
  assert.equal(say('الاسم مطلوب'), 'الاسم مطلوب', 'Arabic from the server is kept');
  for (const raw of ['Internal server error', 'HTTP 500', '', 'ER_DUP_ENTRY']) {
    assert.match(say(raw), /تعذر إرسال طلب الشهادة/, raw);
    assert.doesNotMatch(say(raw), /[A-Za-z]{4}/);
  }
  assert.match(lib.certificateRequestMessage('not an error'), /تعذر إرسال طلب الشهادة/);
});

test('the student\'s form asks for the course the server requires, and offers only finished ones', () => {
  const tab = read('client/components/student-dashboard/StudentCertificatesTab.tsx');
  assert.match(tab, /const certifiableCourses = enrolledCourses\.filter\(course => completions\.some\(completion => completion\.course_id === String\(course\.id\)\)\);/);
  assert.match(tab, /\{certifiableCourses\.map\(c => <option key=\{c\.id\} value=\{c\.id\}>\{c\.title\}<\/option>\)\}/);
  assert.match(tab, /الكورس المرتبط \*/);
  assert.doesNotMatch(tab, /الكورس المرتبط \(اختياري\)/);
  assert.match(tab, /setExtraCertError\(certificateRequestMessage\(error\)\)/);
  assert.match(tab, /طُلبت في \{cairoStamp\(req\.requestedAt\) \|\| req\.requestedAt\}/);
  // the server still refuses without a course, and says so by code — the message map covers each one
  const route = read('api/routes/certificates.js');
  for (const code of ["'courseId required'", "'certificate_not_eligible'", "'certificate_request_exists'", "'not_subscribed'"]) assert.ok(route.includes(code), code);
});

test('the admin\'s certificate card shows the issue date as a date, not the raw timestamp', () => {
  for (const file of ['admin/pages/unified-client/UnifiedClientCertificatesPanel.tsx', 'admin/pages/unified-client/UnifiedClientCertificateViewModal.tsx']) {
    const source = read(file);
    assert.match(source, /import \{ cairoStamp \} from '\.\.\/\.\.\/\.\.\/shared\/cairoDate';/, file);
    assert.match(source, /صدرت في \{cairoStamp\(cert\.issuedAt\) \|\| cert\.issuedAt\}/, file);
    assert.doesNotMatch(source, /صدرت في \{cert\.issuedAt\}/, file);
  }
});

test('flag emoji have a font of their own, so Windows draws a flag and not «EG»', () => {
  for (const app of ['admin', 'client']) {
    const css = read(`${app}/index.css`);
    assert.match(css, /font-family: 'Twemoji Country Flags';[\s\S]*?src: url\('\.\/assets\/fonts\/TwemojiCountryFlags\.woff2'\) format\('woff2'\);\s*unicode-range: U\+1F1E6-1F1FF/, app);
    const tailwind = read(`${app}/tailwind.config.js`);
    assert.match(tailwind, /sans: \['Twemoji Country Flags', 'Tajawal', 'sans-serif'\]/, app);
    const font = path.join(ROOT, app, 'assets', 'fonts', 'TwemojiCountryFlags.woff2');
    assert.ok(fs.statSync(font).size > 50 * 1024, `${app}: the font file is there`);
    assert.equal(fs.readFileSync(font).subarray(0, 4).toString('latin1'), 'wOF2', `${app}: and is a woff2`);
  }
  assert.match(read('admin/index.css'), /body \{\s*font-family: 'Twemoji Country Flags', 'Tajawal', sans-serif;/);
});
