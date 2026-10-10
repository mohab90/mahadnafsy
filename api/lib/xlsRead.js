'use strict';

// The tabs of an old Excel file (.xls, Excel 97–2003), read with nothing but
// Buffer — the companion of lib/xlsxRead.js, returning the same shape.
//
// «رفع شيت البصمة مش بيقبل» (5 Oct 2026): fingerprint devices and their
// software export .xls, and the upload asked people to re-save it as .xlsx
// first. An .xls is a compound file (a small FAT file system) holding one
// stream, «Workbook», of BIFF8 records; only the records that carry cell values
// are read here. Device software also writes an HTML or «XML Spreadsheet 2003»
// table under the .xls name, so those are read too.

const ENDOFCHAIN = 0xfffffffe;

function compoundStreams(buffer) {
  if (buffer.length < 512 || buffer.readUInt32LE(0) !== 0xe011cfd0 || buffer.readUInt32LE(4) !== 0xe11ab1a1) {
    throw new Error('not an .xls file');
  }
  const sectorSize = 1 << buffer.readUInt16LE(0x1e);
  const miniSectorSize = 1 << buffer.readUInt16LE(0x20);
  const firstDirSector = buffer.readUInt32LE(0x30);
  const miniCutoff = buffer.readUInt32LE(0x38);
  const firstMiniFat = buffer.readUInt32LE(0x3c);
  let difatSector = buffer.readUInt32LE(0x44);
  const sectorAt = n => (n + 1) * sectorSize;

  // The FAT's own sectors: 109 listed in the header, the rest in DIFAT sectors.
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = buffer.readUInt32LE(0x4c + i * 4);
    if (s < 0xfffffffa) fatSectors.push(s);
  }
  for (let guard = 0; difatSector < 0xfffffffa && guard < 10000; guard++) {
    const at = sectorAt(difatSector);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const s = buffer.readUInt32LE(at + i * 4);
      if (s < 0xfffffffa) fatSectors.push(s);
    }
    difatSector = buffer.readUInt32LE(at + sectorSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) {
    const at = sectorAt(s);
    for (let i = 0; i < sectorSize / 4 && at + i * 4 + 4 <= buffer.length; i++) fat.push(buffer.readUInt32LE(at + i * 4));
  }
  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let s = start; s < 0xfffffffa && s !== ENDOFCHAIN && !seen.has(s) && s < table.length; s = table[s]) {
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start, fat).map(s => buffer.subarray(sectorAt(s), sectorAt(s) + sectorSize)));

  const dir = readChain(firstDirSector);
  const entries = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameLength = dir.readUInt16LE(at + 0x40);
    entries.push({
      name: dir.toString('utf16le', at, at + Math.max(0, nameLength - 2)),
      type: dir[at + 0x42],
      start: dir.readUInt32LE(at + 0x74),
      size: dir.readUInt32LE(at + 0x78),
    });
  }
  const root = entries.find(entry => entry.type === 5);
  const miniStream = root ? readChain(root.start) : Buffer.alloc(0);
  const miniFatBytes = firstMiniFat < 0xfffffffa ? readChain(firstMiniFat) : Buffer.alloc(0);
  const miniFat = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatBytes.readUInt32LE(i));

  return name => {
    const entry = entries.find(item => item.type === 2 && item.name.toLowerCase() === name.toLowerCase());
    if (!entry) return null;
    if (entry.size < miniCutoff) {
      return Buffer.concat(chain(entry.start, miniFat)
        .map(s => miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize))).subarray(0, entry.size);
    }
    return readChain(entry.start).subarray(0, entry.size);
  };
}

// A string in BIFF8: a character count, a flags byte (bit 0: two bytes a
// character), then the characters — and when it runs past its record into a
// CONTINUE, the next record starts with a fresh flags byte.
class RecordReader {
  constructor(segments) { this.segments = segments; this.seg = 0; this.pos = 0; }
  get current() { return this.segments[this.seg]; }
  ensure() { while (this.current && this.pos >= this.current.length) { this.seg += 1; this.pos = 0; } return Boolean(this.current); }
  u8() { this.ensure(); const v = this.current[this.pos]; this.pos += 1; return v; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n) { for (let left = n; left > 0;) { if (!this.ensure()) return; const step = Math.min(left, this.current.length - this.pos); this.pos += step; left -= step; } }
  chars(count, highByte) {
    let out = '';
    let wide = highByte;
    for (let left = count; left > 0;) {
      if (this.pos >= (this.current?.length ?? 0)) {
        this.seg += 1; this.pos = 0;
        if (!this.current) break;
        wide = (this.current[this.pos] & 1) === 1; // the continuation's own flags
        this.pos += 1;
      }
      const room = this.current.length - this.pos;
      const take = Math.min(left, wide ? Math.floor(room / 2) : room);
      if (take <= 0) { this.pos = this.current.length; continue; }
      out += wide
        ? this.current.toString('utf16le', this.pos, this.pos + take * 2)
        : this.current.toString('latin1', this.pos, this.pos + take);
      this.pos += wide ? take * 2 : take;
      left -= take;
    }
    return out;
  }
  richString() {
    const count = this.u16();
    const flags = this.u8();
    const runs = flags & 8 ? this.u16() : 0;
    const ext = flags & 4 ? this.u32() : 0;
    const text = this.chars(count, (flags & 1) === 1);
    this.skip(runs * 4 + ext);
    return text;
  }
}

function rkNumber(rk) {
  let value;
  if (rk & 2) value = rk >> 2;
  else {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    value = bytes.readDoubleLE(0);
  }
  return rk & 1 ? value / 100 : value;
}

function readBiff(workbook) {
  const records = [];
  for (let at = 0; at + 4 <= workbook.length;) {
    const type = workbook.readUInt16LE(at);
    const size = workbook.readUInt16LE(at + 2);
    records.push({ type, offset: at, data: workbook.subarray(at + 4, at + 4 + size) });
    at += 4 + size;
  }
  const sheets = [];
  let shared = [];
  for (let i = 0; i < records.length; i++) {
    const { type, data } = records[i];
    if (type === 0x0085) { // BOUNDSHEET
      const reader = new RecordReader([data.subarray(6)]);
      const count = reader.u8();
      const name = reader.chars(count, (reader.u8() & 1) === 1);
      if (data[5] === 0) sheets.push({ name, offset: data.readUInt32LE(0) });
    } else if (type === 0x00fc) { // SST and its CONTINUEs
      const segments = [data];
      while (records[i + 1]?.type === 0x003c) segments.push(records[++i].data);
      const reader = new RecordReader(segments);
      reader.u32();
      const unique = reader.u32();
      shared = [];
      for (let n = 0; n < unique && reader.ensure(); n++) shared.push(reader.richString());
    } else if (type === 0x000a && sheets.length) break; // end of the globals
  }

  return sheets.map(sheet => {
    const cells = [];
    const put = (row, col, value) => { (cells[row] ||= [])[col] = value; };
    let at = records.findIndex(record => record.offset === sheet.offset);
    let pendingFormula = null;
    for (at = at < 0 ? records.length : at + 1; at < records.length; at++) {
      const { type, data } = records[at];
      if (type === 0x000a) break;
      if (type === 0x00fd) put(data.readUInt16LE(0), data.readUInt16LE(2), shared[data.readUInt32LE(6)] ?? null);
      else if (type === 0x0203) put(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
      else if (type === 0x027e) put(data.readUInt16LE(0), data.readUInt16LE(2), rkNumber(data.readInt32LE(6)));
      else if (type === 0x00bd) {
        const row = data.readUInt16LE(0);
        const first = data.readUInt16LE(2);
        for (let k = 0; 4 + k * 6 + 6 <= data.length - 2; k++) put(row, first + k, rkNumber(data.readInt32LE(4 + k * 6 + 2)));
      } else if (type === 0x0204) {
        put(data.readUInt16LE(0), data.readUInt16LE(2), new RecordReader([data.subarray(6)]).richString());
      } else if (type === 0x0006) {
        const row = data.readUInt16LE(0); const col = data.readUInt16LE(2);
        if (data.readUInt16LE(12) !== 0xffff) put(row, col, data.readDoubleLE(6));
        else if (data[6] === 0) pendingFormula = { row, col };
        else if (data[6] === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE');
      } else if (type === 0x0207 && pendingFormula) {
        put(pendingFormula.row, pendingFormula.col, new RecordReader([data]).richString());
        pendingFormula = null;
      } else if (type === 0x0205 && data[7] === 0) put(data.readUInt16LE(0), data.readUInt16LE(2), data[6] ? 'TRUE' : 'FALSE');
    }
    const rows = [];
    for (const row of cells) {
      if (!row) continue;
      const filled = Array.from(row, cell => (cell === undefined ? null : cell));
      if (filled.some(cell => cell !== null && cell !== '')) rows.push(filled);
    }
    return { name: sheet.name, rows };
  });
}

const entity = text => String(text)
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();

/** An HTML table or an «XML Spreadsheet 2003» saved under the .xls name. */
function readMarkupTable(text) {
  const rows = [];
  if (/<Workbook\b[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(text)) {
    for (const [rowXml] of text.matchAll(/<(?:ss:)?Row\b[\s\S]*?<\/(?:ss:)?Row>/gi)) {
      const cells = [];
      for (const [cellXml] of rowXml.matchAll(/<(?:ss:)?Cell\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:ss:)?Cell>)/gi)) {
        const index = /ss:Index="(\d+)"/i.exec(cellXml);
        if (index) while (cells.length < Number(index[1]) - 1) cells.push(null);
        const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(cellXml);
        cells.push(data ? entity(data[1]) : null);
      }
      if (cells.some(cell => cell !== null && cell !== '')) rows.push(cells);
    }
  } else {
    for (const [rowHtml] of text.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => entity(m[1]));
      if (cells.some(Boolean)) rows.push(cells);
    }
  }
  return [{ name: 'Sheet1', rows }];
}

/** @returns {{name: string, rows: (string|number|null)[][]}[]} */
function readXls(buffer) {
  if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0xe011cfd0) {
    const stream = compoundStreams(buffer);
    const workbook = stream('Workbook');
    if (!workbook) throw Object.assign(new Error('ملف Excel قديم جداً (Excel 95). احفظه .xlsx وارفعه تاني'), { statusCode: 400, code: 'XLS_TOO_OLD' });
    return readBiff(workbook);
  }
  let text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  // Arabic device software writes Windows-1256, saying so in a meta tag or not at all.
  if (text.includes('�')) { try { text = new TextDecoder('windows-1256').decode(buffer); } catch { /* keep UTF-8 */ } }
  if (/<table\b|<Workbook\b/i.test(text)) return readMarkupTable(text);
  throw new Error('not an .xls file');
}

const looksLikeXls = buffer => buffer.length >= 8 && buffer.readUInt32LE(0) === 0xe011cfd0;
const looksLikeMarkupTable = buffer => /^\s*(?:\uFEFF)?\s*<[\s\S]{0,4000}(<table\b|<Workbook\b)/i.test(buffer.subarray(0, 4096).toString('utf8'));

module.exports = { readXls, looksLikeXls, looksLikeMarkupTable };
