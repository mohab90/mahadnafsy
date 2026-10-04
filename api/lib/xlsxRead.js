'use strict';

// The tabs of an .xlsx, read on the server with nothing but zlib — the same
// reading as shared/sheetImport.ts readXlsx (the browser's), for the import
// tools that run on the server. No dependency: an .xlsx is a zip of XML.

const zlib = require('zlib');

function unzip(buffer, wanted) {
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('not an .xlsx file');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const parts = new Map();
  for (let n = 0; n < count && buffer.readUInt32LE(offset) === 0x02014b50; n++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    parts.set(name, (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'));
  }
  return parts;
}

const xmlText = value => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? xmlText(m[1]) : null; };
const runsText = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join('');
const columnIndex = ref => [...((ref.match(/^[A-Z]+/) || ['A'])[0])].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;

/** @returns {{name: string, rows: (string|number|null)[][]}[]} */
function readXlsx(buffer) {
  const parts = unzip(buffer, name => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
  const workbook = parts.get('xl/workbook.xml');
  if (!workbook) throw new Error('not an .xlsx file');
  const shared = [...(parts.get('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => runsText(m[1]));
  const targets = new Map([...(parts.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)]
    .map(m => [attr(m[0], 'Id') || '', (attr(m[0], 'Target') || '').replace(/^\/?(xl\/)?/, 'xl/')]));
  const tabs = [];
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const xml = parts.get(targets.get(attr(tag, 'r:id') || '') || '');
    if (!xml) continue;
    const rows = [];
    for (const [rowXml] of xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
      const cells = [];
      for (const [cellXml] of rowXml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const open = (cellXml.match(/^<c\b[^>]*>/) || [cellXml])[0];
        const type = attr(open, 't');
        const raw = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = null;
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? null;
        else if (type === 'inlineStr') value = runsText((cellXml.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
        else if (raw !== undefined) value = ['str', 'e', 'b'].includes(type) ? xmlText(raw) : (Number.isFinite(Number(raw)) ? Number(raw) : xmlText(raw));
        cells[columnIndex(attr(open, 'r') || '')] = value;
      }
      const filled = Array.from(cells, cell => (cell === undefined ? null : cell));
      if (filled.some(cell => cell !== null && cell !== '')) rows.push(filled);
    }
    tabs.push({ name: attr(tag, 'name') || `Sheet${tabs.length + 1}`, rows });
  }
  return tabs;
}

module.exports = { readXlsx };
