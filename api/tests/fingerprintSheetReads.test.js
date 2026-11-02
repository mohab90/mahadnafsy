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
