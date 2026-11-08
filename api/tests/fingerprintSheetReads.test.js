'use strict';
/**
 * 2 Nov 2026, «لما برفع شيت البصمة للموظفين بيعمل ايرور»: two uploads of the device's sheet answered 500 «not an .xlsx file» (production log). A workbook
 * whose part names the exporting software writes with Windows backslashes, a leading slash or other capitals was «not a workbook» to a reader that
 * looked for exactly «xl/workbook.xml»; and a zip that is not a workbook at all answered a 500, which the screen can only show as «تعذر قراءة الشيت».
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { readXlsx } = require('../lib/xlsxRead');

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A zip of the given parts: [[name, text]], deflated, no extras. */
function zip(parts) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of parts) {
    const raw = Buffer.from(text, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const WORKBOOK = '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
const SHEET = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>رقم البصمة</t></is></c><c r="B1"><v>7</v></c></row></sheetData></worksheet>';

test('the standard layout reads', () => {
  const tabs = readXlsx(zip([['xl/workbook.xml', WORKBOOK], ['xl/_rels/workbook.xml.rels', RELS], ['xl/worksheets/sheet1.xml', SHEET]]));
  assert.deepEqual(tabs[0].rows, [['رقم البصمة', 7]]);
});

test('text saved the way Excel and Google Sheets save it — shared strings, rich runs included — reads, whatever the part name\'s capitals', () => {
  const shared = '<sst><si><t>اسم الموظف</t></si><si><r><t>ريم </t></r><r><t>حماده</t></r></si></sst>';
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" s="50" t="s"><v>0</v></c><c r="B1"><v>7</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>8</v></c></row></sheetData></worksheet>';
  for (const name of ['xl/sharedStrings.xml', 'xl/sharedstrings.xml', 'xl\\SharedStrings.xml']) {
    const tabs = readXlsx(zip([['xl/workbook.xml', WORKBOOK], ['xl/_rels/workbook.xml.rels', RELS], [name, shared], ['xl/worksheets/sheet1.xml', sheet]]));
    assert.deepEqual(tabs[0].rows, [['اسم الموظف', 7], ['ريم حماده', 8]], name);
  }
});

test('backslashes, a leading slash and other capitals in the part names read too', () => {
  for (const [workbook, rels, sheet] of [
    ['xl\\workbook.xml', 'xl\\_rels\\workbook.xml.rels', 'xl\\worksheets\\sheet1.xml'],
    ['/xl/workbook.xml', '/xl/_rels/workbook.xml.rels', '/xl/worksheets/sheet1.xml'],
    ['xl/Workbook.xml', 'xl/_rels/Workbook.xml.rels', 'xl/worksheets/Sheet1.xml'],
  ]) {
    const tabs = readXlsx(zip([[workbook, WORKBOOK], [rels, RELS], [sheet, SHEET]]));
    assert.deepEqual(tabs[0].rows, [['رقم البصمة', 7]], workbook);
  }
});

test('a zip that is not a workbook, or a file that is not a zip, is a 400 with a sentence, not a 500', () => {
  for (const buffer of [zip([['readme.txt', 'hello']]), Buffer.from('PK not really a zip at all')]) {
    assert.throws(() => readXlsx(buffer), error => error.statusCode === 400 && error.code === 'NOT_A_WORKBOOK' && /Excel/.test(error.message));
  }
});

// ── «بصمه شهر 10.xlsx»: the device's attlog saved from Excel — no headings, the number first, the time as an Excel date number ──
const { readDeviceSheet } = require('../lib/attendanceSheet');
const { deepSanitize } = require('../middleware/sanitize');

const attlogSheet = rows => `<worksheet><sheetData>${rows.map((cells, i) => `<row r="${i + 1}">${cells.map((v, c) => `<c r="${'ABCDEF'[c]}${i + 1}"><v>${v}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
const workbookOf = rows => zip([['xl/workbook.xml', WORKBOOK], ['xl/_rels/workbook.xml.rels', RELS], ['xl/worksheets/sheet1.xml', attlogSheet(rows)]]);

test('an attlog saved as .xlsx (number, date-number time, 1, 0, 1, 0) is read into punches, the month before and after dropped', () => {
  // 46296 = 1 Oct 2026; .4375 = 10:30. 46327 = 1 Nov 2026.
  const buffer = workbookOf([[143, 46296.4375, 1, 0, 1, 0], [143, 46296.77083, 1, 0, 1, 0], [21, 46297.46875, 1, 0, 1, 0], [21, 46327.5, 1, 0, 1, 0]]);
  const sheet = readDeviceSheet(buffer, { filename: 'بصمه شهر 10.xlsx', month: '2026-10' });
  assert.deepEqual(sheet.punches, [
    { bioNo: '143', name: '', date: '2026-10-01', time: '10:30' },
    { bioNo: '143', name: '', date: '2026-10-01', time: '18:30' },
    { bioNo: '21', name: '', date: '2026-10-02', time: '11:15' },
  ]);
  assert.equal(sheet.skipped.outsideMonth, 1);
});

test('the body sanitiser does not cut a file sent as base64 (it cut every .xlsx over ~37 KB, so the zip arrived broken)', () => {
  const sheetRows = Array.from({ length: 3000 }, (_, i) => [1 + (i % 29), 46296 + i / 100, 1, 0, 1, 0]);
  const base64 = workbookOf(sheetRows).toString('base64');
  assert.ok(base64.length > 50_000, 'a realistic size');
  const body = deepSanitize({ fileBase64: `data:application/octet-stream;base64,${base64}`, filename: 'x.xlsx', note: 'n'.repeat(60_000) });
  assert.equal(body.fileBase64.length, base64.length + 'data:application/octet-stream;base64,'.length);
  assert.equal(body.note.length, 50_000, 'an ordinary text field is still capped');
  const buffer = Buffer.from(body.fileBase64.replace(/^data:[^,]*,/, ''), 'base64');
  assert.equal(readXlsx(buffer)[0].rows.length, 3000);
});
