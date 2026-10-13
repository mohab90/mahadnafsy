'use strict';

// «في صفحة الشهادات لازم يكون في امكانية تحديد عدد معين من الشهادات وكمان اعملها
// داونلود في شيت اكسل» (13 Oct 2026). Both halves of the certificates page — the
// requests and the institute's own — tick rows, pick the first N shown, and
// download exactly those as an Excel sheet: the client's whole row, the Drive
// links of the pictures last.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

const TABS = 'admin/pages/dashboard/tabs';

test('both certificate screens use the same selection bar and download an Excel sheet', () => {
  for (const file of ['CertRequestsTab.tsx', 'InstituteCertificatesPanel.tsx']) {
    const source = read(`${TABS}/${file}`);
    assert.match(source, /useRowPicker\(/, file);
    assert.match(source, /<SelectionExportBar picker=\{picker\} shown=\{(filtered|shown)\.length\}/, file);
    assert.match(source, /exportToExcel\(/, file);
    assert.match(source, /picker\.chosen\.length \? picker\.chosen : (filtered|shown)/, `${file}: the chosen rows, else everything shown`);
    assert.match(source, /type="checkbox" checked=\{picker\.allSelected\}/, `${file}: a select-all box`);
  }
});

test('the bar picks the first N shown and says how many are chosen', () => {
  const bar = read(`${TABS}/SelectionExportBar.tsx`);
  assert.match(bar, /visible\.slice\(0, wanted\)/);
  assert.match(bar, /Math\.floor\(Number\(count\)\)/);
  assert.match(bar, /wanted > 0/);
  assert.match(bar, /المحدّد: \{picker\.chosen\.length\} من \{shown\}/);
  assert.match(bar, /تنزيل Excel/);
});

test('the sheet is the client\'s whole row and ends with the picture links', () => {
  for (const [file, last] of [['CertRequestsTab.tsx', 'CERT_EXPORT_COLUMNS'], ['InstituteCertificatesPanel.tsx', 'EXPORT_COLUMNS']]) {
    const source = read(`${TABS}/${file}`);
    const columns = source.slice(source.indexOf(`const ${last}`));
    const keys = [...columns.slice(0, columns.indexOf('];')).matchAll(/key: '(\w+)'/g)].map(match => match[1]);
    assert.deepEqual(keys.slice(-2), ['personalPhoto', 'idPhoto'], `${file} ends with the two links`);
    for (const wanted of ['client', 'clientCode', 'phone', 'nameEn']) assert.ok(keys.includes(wanted), `${file} has ${wanted}`);
  }
  assert.ok(read(`${TABS}/CertRequestsTab.tsx`).includes("{ header: 'الرقم القومي / الهوية', key: 'idNumber'"));
});

test('the APIs hand the screens the links and the national id', () => {
  assert.match(read('api/routes/certificates.js'), /s\.personal_photo_url, s\.id_photo_url/);
  assert.match(read('api/routes/certificates.js'), /personalPhotoUrl: row\.personal_photo_url \|\| null/);
  const institute = read('api/routes/instituteCertificates.js');
  assert.match(institute, /s\.national_id, s\.personal_photo_url, s\.id_photo_url/);
  assert.match(institute, /nationalId: row\.national_id \|\| null, personalPhotoUrl/);
});
