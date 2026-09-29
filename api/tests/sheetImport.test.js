'use strict';

// «عدل امكانيه اي رفع شيت لان فيها مشكله بيقرا الشيت غلط وبيقرا البيانات غلط».
// The cells here are the ones the Dokki workbook and the online collection
// sheet of 29-30 September 2026 actually hold. The screen's reader
// (shared/sheetImport.ts, bundled here) and the server's (api/lib/sheetCells.js,
// for a linked Google Sheet) must give the same answers on every one of them.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const server = require('../lib/sheetCells');

let screen = null;
try {
  const esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'shared/sheetImport.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', absWorkingDir: ROOT,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  screen = module.exports;
} catch { screen = null; }
const readers = [['server', server], ...(screen ? [['screen', screen]] : [])];

test('both readers are here', { skip: !screen && 'esbuild is not installed' }, () => {
  assert.ok(screen.readXlsx && screen.tabClientRows);
});

test('the institute\'s headings name the right columns', () => {
  const tabs = {
    '2026': ['التاريخ', 'الاسم', 'التليفون', 'الكورس', 'القيمة', 'المحصل', 'المسترد', 'المتبقى'],
    'مديونية 2024': ['التاريخ', 'الاسم', 'الموبيل', 'الكورس', 'القيمة', 'الباقى', 'المسترد', 'الباقى'],
    'مديونية 2023': ['التاريخ', 'الايم', 'الموبيل', 'الكورس', 'القيمة', 'المتبقى', 'المسترد', 'الباقى'],
    certificates: ['Timestamp', 'اسم العميل', 'الكورس المشترك فيه', 'الشهادة المحصل عنها المبلغ', 'جهة التحصيل', 'المبلغ', 'رقم المستند', 'رقم العميل الى محول منه فودافون كاش'],
    old: ['\ufeffالاسم', 'الهاتف', 'قيمة الكورس', 'اسم الكورس', 'المحصل'],
  };
  const want = {
    '2026': { date: 0, name: 1, phone: 2, course: 3, expected: 4, paid: 5, refund: 6, remaining: 7 },
    'مديونية 2024': { date: 0, name: 1, phone: 2, course: 3, expected: 4, remaining: 5, refund: 6 },
    'مديونية 2023': { date: 0, name: 1, phone: 2, course: 3, expected: 4, remaining: 5, refund: 6 },
    certificates: { date: 0, name: 1, course: 2, cert: 3, expected: 5, phone: 7 },
    old: { name: 0, phone: 1, expected: 2, course: 3, paid: 4 },
  };
  for (const [who, lib] of readers) {
    for (const [tab, headings] of Object.entries(tabs)) {
      const layout = lib.detectLayout([headings, ['x', 'y']]);
      assert.equal(layout.headerRow, 0, `${who} ${tab}`);
      assert.deepEqual(layout.columns, want[tab], `${who} ${tab}`);
    }
  }
});

test('a sheet with no heading row is told apart by what its columns hold', () => {
  // The online collection sheet: date, sales, client, phone, course, price, remaining, officer.
  const courses = ['علم النفس الاكلينكى 2025', 'الصحه النفسيه " الارشاد النفسي " 2025', 'التلاعب و التحصين النفسي'];
  const sales = ['سما شوشة', 'رودينا ثروت', 'دنيا وائل', 'شيماء عابد'];
  const officers = ['وفاء', 'fatma'];
  const rows = Array.from({ length: 40 }, (_, i) => [
    45700 + i + 0.5, sales[i % 4], `عميل رقم ${i} محمد احمد`, 1000000000 + i * 7919,
    courses[i % 3], 3000 + i * 10, 1000 + i, officers[i % 2]]);
  for (const [who, lib] of readers) {
    const layout = lib.detectLayout(rows);
    assert.equal(layout.guessed, true, who);
    assert.deepEqual(layout.columns, { phone: 3, date: 0, expected: 5, remaining: 6, name: 2, course: 4, officer: 7, sales: 1 }, who);
    // A client whose course says «دبلومة» and whose note says «باقي» names two
    // fields too — but a row with a phone number in it is a client, not headings.
    const first = lib.detectLayout([['احمد علي', '01012345678', 'دبلومة اللايف كوتش', 'باقي قسط'], ['منى', '01098765432', 'كورس', '']]);
    assert.equal(first.headerRow, -1, who);
  }
});

test('every number in a cell, and what cannot be used said', () => {
  const cells = [
    ['01558282609-01050954780', ['01558282609', '01050954780'], []],
    ['0122377051601201280864', ['01223770516', '01201280864'], []],
    ['\u2066+20 11 02073626\u2069', ['01102073626'], []],
    [1009441632, ['01009441632'], []],
    [201110016019, ['01110016019'], []],
    ['00249902201422\\01555354817', ['+249902201422', '01555354817'], []],
    ['01062673575-972599463474', ['01062673575', '+972599463474'], []],
    ['1552594173+/+249 99 914 7035', ['01552594173', '+249999147035'], []],
    ['٠١٠٠٩٤٤١٦٣٢', ['01009441632'], []],
    ['15123875029', ['+15123875029'], []],
    ['0555000111', ['0555000111'], []],
    ['01010000000', [], ['01010000000']],
    ['114785023', [], ['114785023']],
    ['11023725733', [], ['11023725733']],
    ['#ERROR!', [], ['#ERROR!']],
    [null, [], []],
  ];
  for (const [who, lib] of readers) {
    for (const [cell, phones, bad] of cells) {
      assert.deepEqual(lib.splitPhones(cell), { phones, bad }, `${who} ${JSON.stringify(cell)}`);
    }
  }
});

test('amounts in any writing, and the paid before the system from the remaining', () => {
  for (const [who, lib] of readers) {
    assert.equal(lib.parseAmount('1,500'), 1500, who);
    assert.equal(lib.parseAmount('١٥٠٠ ج'), 1500, who);
    assert.equal(lib.parseAmount(2800), 2800, who);
    assert.equal(lib.parseAmount('-40'), -40, who);
    assert.equal(lib.parseAmount(''), null, who);
    // The remaining is the figure the desk keeps; the collected one misses refunds.
    assert.equal(lib.paidBefore({ _expected: '4600', _paid: '1000', _remaining: '2900' }), 1700, who);
    assert.equal(lib.paidBefore({ _expected: '3000', _paid: '1,500', _remaining: '' }), 1500, who);
    assert.equal(lib.paidBefore({ _expected: '4140', _paid: '4180', _remaining: '-40' }), 4140, who);
    assert.equal(lib.paidBefore({ _expected: '', _paid: '500', _remaining: '200' }), 500, who);
  }
});

test('a column of dates is read one way', () => {
  for (const [who, lib] of readers) {
    // The Dokki tabs: form timestamps month first, and serials Excel made of
    // the ones it could read day first — 46235 is «1/8/2026», 8 January.
    assert.deepEqual(lib.readDateColumn(['12/31/2025 15:56:52', 46235.64, '1/13/2026 14:48:57', 46296.77]),
      ['2025-12-31', '2026-01-08', '2026-01-13', '2026-01-10'], who);
    // The online sheet: day first, and its serials are right as they are.
    assert.deepEqual(lib.readDateColumn([45795.717, '26/9/2026', '3:56:45 م 2025/01/14', '12\\10\\2025', null]),
      ['2025-05-18', '2026-09-26', '2025-01-14', '2025-10-12', null], who);
  }
});

test('a row keeps its extra numbers and says what was wrong with the rest', () => {
  const tab = { name: '2026', rows: [
    ['التاريخ', 'الاسم', 'التليفون', 'الكورس', 'القيمة', 'المحصل', 'المسترد', 'المتبقى'],
    ['12/31/2025 15:56:52', ' اميمه  مصطفي ', '01558282609-01050954780', 'الصحة النفسية', 2800, '1,000', 0, 1800],
    [46235.64, 'سالى محسن محمد', 114785023, 'علم النفس الايكلنيكى', 3680, 3680, 0, 0],
    [null, '', '', '', '', '', '', ''],
  ] };
  for (const [who, lib] of readers) {
    const rows = lib.tabClientRows(tab, lib.detectLayout(tab.rows));
    assert.equal(rows.length, 2, `${who}: an empty row is not a client`);
    assert.deepEqual(
      [rows[0]._name, rows[0]._phone, rows[0]._otherPhones, rows[0]._date, rows[0]._expected, rows[0]._paid, rows[0]._remaining],
      ['اميمه مصطفي', '01558282609', '01050954780', '2025-12-31', '2800', '1000', '1800'], who);
    assert.equal(rows[1]._phone, '', who);
    assert.match(rows[1]._issues[0], /رقم مش سليم: 114785023 \(ناقص أو زيادة أرقام\)/, who);
    assert.equal(rows[1]._date, '2026-01-08', who);
  }
});

// A real .xlsx, made here: two tabs, shared and inline strings, a number, an
// error cell and a cell skipped (B2 empty on tab 2).
function xlsx(parts) {
  const files = Object.entries(parts).map(([name, text]) => {
    const data = Buffer.from(text, 'utf8');
    return { name: Buffer.from(name), data: zlib.deflateRawSync(data), size: data.length };
  });
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(file.data.length, 18); local.writeUInt32LE(file.size, 22); local.writeUInt16LE(file.name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(file.data.length, 20); central.writeUInt32LE(file.size, 24); central.writeUInt16LE(file.name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, file.name, file.data);
    centrals.push(central, file.name);
    offset += 30 + file.name.length + file.data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const whole = Buffer.concat([...locals, directory, end]);
  return whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength);
}

test('an .xlsx is read tab by tab, with no library', { skip: !screen && 'esbuild is not installed' }, async () => {
  const book = xlsx({
    'xl/workbook.xml': '<workbook><sheets><sheet name="مديونية 2025" sheetId="1" r:id="rId1"/><sheet name="Sheet &amp; 2" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>الاسم</t></si><si><r><t>التلي</t></r><r><t xml:space="preserve">فون</t></r></si><si><t>رهام &amp; محمود</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1102073626</v></c></row>'
      + '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>هادي</t></is></c><c r="C1" t="e"><v>#ERROR!</v></c></row>'
      + '</sheetData></worksheet>',
  });
  const tabs = await screen.readXlsx(book);
  assert.deepEqual(tabs, [
    { name: 'مديونية 2025', rows: [['الاسم', 'التليفون'], ['رهام & محمود', 1102073626]] },
    { name: 'Sheet & 2', rows: [['هادي', null, '#ERROR!']] },
  ]);
  const [row] = screen.tabClientRows(tabs[0], screen.detectLayout(tabs[0].rows));
  assert.equal(row._phone, '01102073626', 'the zero Excel dropped is back');
});

test('the upload screens read through the one reader and write through the import', () => {
  const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const panel = read('admin/pages/dashboard/tabs/online/OldDataImportPanel.tsx');
  assert.match(panel, /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared\/sheetImport'/);
  assert.match(panel, /accept="\.xlsx,\.xlsm,\.csv,\.tsv,\.txt"/);
  assert.doesNotMatch(panel, /importRow\b/, 'no row-by-row save left');
  // Two thousand clients in one request outlast the proxy's 65 seconds.
  assert.match(panel, /const BATCH = 200;/);
  assert.match(panel, /await importRows\(rows\.slice\(start, start \+ BATCH\), source\)/);
  const section = read('admin/pages/dashboard/tabs/online-clients-sections/OldDataImportSection.tsx');
  assert.match(section, /adminPost<ImportResult>\('\/admin\/old-data\/import'/);
  assert.doesNotMatch(section, /saveSubscriber/, 'the old-data screens no longer save a file row by row');
  const routes = read('api/routes/collection-distribution.js');
  assert.match(routes, /router\.post\('\/api\/admin\/old-data\/import', requireAuth, requireAdminOrStaff, requirePermission\('manage_subscribers'\),/);
  assert.match(routes, /autoAssign: true/);
});
