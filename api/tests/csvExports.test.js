'use strict';

// Every CSV the institute takes offline is written by one module.
//
// Fifteen screens used to build their own. They all remembered the BOM — Excel
// reads a UTF-8 file as Windows-1252 without one and Arabic opens as mojibake,
// which is loud enough that it got fixed everywhere. Quoting is the quiet
// failure, and two of the fifteen skipped it:
//
//   قاعدة بيانات العملاء  — joined the values raw, wrapping only الكورسات in
//                           quotes without doubling the quotes inside it
//   عمولات المبيعات       — joined the values raw, no quoting at all
//
// The institute's fields are free text. A note «اتفقنا على 3 أقساط, الأول في
// سبتمبر» opens an extra column; a name «أحمد "أبو مازن"» ends its field early.
// Either way every heading after it in that row is wrong, the file says
// something different from the screen, and nothing warns anyone.
//
// The rule this test holds: no screen builds a CSV line itself. shared/csv.ts
// does it, once, by RFC 4180.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// `.` does not match \r, so `//.*$` never strips a full-line comment out of a
// CRLF file — which is most of this repo. [^\n] does.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

function browserSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const app of ['admin', 'client', 'shared']) walk(path.join(ROOT, app));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

const read = rel => codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('no screen builds a CSV line of its own', () => {
  const files = browserSources();
  // Denominator: a walk that stopped matching would report a clean bill.
  assert.ok(files.length > 300, `expected both app trees, saw ${files.length}`);

  const offenders = [];
  for (const rel of files) {
    if (rel === 'shared/csv.ts') continue;
    const source = read(rel);
    // The two shapes a hand-rolled writer takes: quoting a field itself, or
    // handing a text/csv Blob to the browser.
    if (/replace\(\/"\/g,\s*'""'\)/.test(source)) offenders.push(`${rel} (quotes a field itself)`);
    else if (/new Blob\([^)]*\btype:\s*'text\/csv/.test(source.replace(/\n/g, ' '))) {
      offenders.push(`${rel} (builds its own download)`);
    }
  }
  assert.deepEqual(offenders, [], 'these write CSV without shared/csv: ' + offenders.join(', '));

  // The premise: the shared writer is genuinely what they all reach for now.
  // An empty offender list with nobody importing it would mean the exports
  // were deleted, not fixed.
  const adopters = files.filter(rel => /from '[^']*shared\/csv'/.test(read(rel)));
  assert.ok(adopters.length >= 13, `expected the migrated exports, saw ${adopters.length}`);
});

test('a field only gets quotes when it needs them, and its own quotes get doubled', () => {
  // Run the rule, do not read it. Ported from shared/csv.ts — if that file's
  // logic drifts from RFC 4180 the source assertions below catch it.
  const source = fs.readFileSync(path.join(ROOT, 'shared', 'csv.ts'), 'utf8');
  assert.match(source, /if \(!\/\[",\\n\\r\]\/\.test\(text\) && text\.trim\(\) === text\) return text;/);
  assert.match(source, /return `"\$\{text\.replace\(\/"\/g, '""'\)\}"`;/);
  assert.match(source, /\.join\('\\r\\n'\)/, 'RFC 4180 lines end CRLF; a lone \\n puts old Excel on one line');

  const csvField = value => {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[",\n\r]/.test(text) && text.trim() === text) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };

  // The real row that broke the client database export.
  assert.equal(csvField('أحمد "أبو مازن"'), '"أحمد ""أبو مازن"""');
  assert.equal(csvField('ملاحظة: اتفقنا على 3 أقساط, الأول في سبتمبر'),
    '"ملاحظة: اتفقنا على 3 أقساط, الأول في سبتمبر"');
  assert.equal(csvField('سطر\nثانٍ'), '"سطر\nثانٍ"');
  assert.equal(csvField(' مسافة سابقة'), '" مسافة سابقة"', 'Excel eats leading space in a bare field');
  assert.equal(csvField('اسم عادي'), 'اسم عادي', 'nothing to escape, so no quotes to read around');
  assert.equal(csvField(0), '0', 'a zero payment is a zero, not an empty cell');
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('a row survives the round trip Excel would make of it', () => {
  const csvField = value => {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[",\n\r]/.test(text) && text.trim() === text) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const toCsv = rows => rows.map(row => row.map(csvField).join(',')).join('\r\n');

  // A minimal RFC 4180 reader, so the assertion is "a parser gets the row
  // back", not "the string looks how I expected".
  const parseLine = line => {
    const out = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === ',') { out.push(field); field = ''; }
      else field += ch;
    }
    out.push(field);
    return out;
  };

  const row = ['أحمد "أبو مازن"', 'ملاحظة: اتفقنا على 3 أقساط, الأول في سبتمبر', '01001234567'];
  const parsed = parseLine(toCsv([row]));
  assert.equal(parsed.length, 3, 'three columns written, three read — this is what used to be four');
  assert.deepEqual(parsed, row);
});

test('every export still stamps the file UTF-8', () => {
  const source = fs.readFileSync(path.join(ROOT, 'shared', 'csv.ts'), 'utf8');
  assert.ok(source.includes(`export const CSV_BOM = '${String.fromCharCode(0xfeff)}'`),
    'the literal mark, not the escape text — the escape would ship as five characters');
  // Both writers prepend it, so no caller can forget.
  assert.match(source, /new Blob\(\[CSV_BOM \+ csv\]/);
  assert.match(source, /downloadCsvText\(filename, toCsv\(rows\)\)/);
});

test('what the writer writes, the leads import reads back', () => {
  // The two halves used to disagree. The reader split on '\n' and then on ',',
  // so re-importing a file this system had exported was enough to corrupt it:
  // a comma inside a quoted note opened an extra column, «""» toggled twice
  // and disappeared, and a note with a newline became two half rows.
  const source = fs.readFileSync(path.join(ROOT, 'shared', 'csv.ts'), 'utf8');
  assert.match(source, /export function parseCsvRows/);
  // The ported copy below is only as good as its agreement with the source, so
  // pin the three decisions that make it a reader rather than a splitter.
  // Plain includes, not regexes: every one of these lines is mostly regex
  // metacharacters, and escaping them is how a pin ends up matching nothing.
  const pins = [
    [`if (source[index + 1] === '"') { field += '"'; index++; continue; }`,
      'a doubled quote is one quote, not two toggles'],
    [`if (char === '\\r') { if (source[index + 1] === '\\n') index++; endRow(); continue; }`,
      'CRLF ends one row, not two'],
    [`if (char === ',') { endField(); continue; }`,
      'a comma outside quotes ends a field'],
    [`    if (quoted) {`,
      'and inside quotes it is data — this branch is what makes that true'],
    [`if (char === '"' && field.trim() === '') { quoted = true; wasQuoted = true; field = ''; continue; }`,
      'only a quote that opens the field opens a quoted field'],
    [`const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;`,
      'the BOM we write is not part of the first heading'],
    [`row.push(wasQuoted ? field : field.trim())`,
      'quotes are how the writer says the whitespace was meant'],
  ];
  for (const [line, why] of pins) {
    assert.ok(source.includes(line), `${why} — shared/csv.ts no longer has: ${line}`);
  }

  const csvField = value => {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[",\n\r]/.test(text) && text.trim() === text) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const toCsv = rows => rows.map(row => row.map(csvField).join(',')).join('\r\n');

  // Ported from shared/csv.ts parseCsvRows.
  const parseCsvRows = text => {
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const rows = [];
    let row = [], field = '', quoted = false, wasQuoted = false;
    const endField = () => { row.push(wasQuoted ? field : field.trim()); field = ''; wasQuoted = false; };
    const endRow = () => { endField(); rows.push(row); row = []; };
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c !== '"') { field += c; continue; }
        if (src[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false; continue;
      }
      if (c === '"' && field.trim() === '') { quoted = true; wasQuoted = true; field = ''; continue; }
      if (c === ',') { endField(); continue; }
      if (c === '\r') { if (src[i + 1] === '\n') i++; endRow(); continue; }
      if (c === '\n') { endRow(); continue; }
      field += c;
    }
    if (field !== '' || row.length > 0) endRow();
    return rows.filter(cells => cells.some(cell => cell !== ''));
  };

  const original = [
    ['الاسم', 'الهاتف', 'ملاحظات'],
    ['أحمد "أبو مازن"', '01001234567', 'اتفقنا على 3 أقساط, الأول في سبتمبر'],
    ['منى', '01109876543', 'سطر\nثانٍ'],
    ['خالد', '01234567890', ''],
  ];
  // Through the BOM too — that is how the file reaches the import button.
  assert.deepEqual(parseCsvRows('\uFEFF' + toCsv(original)), original);
});

test('the leads import parses through the shared reader, not its own split', () => {
  const source = read('admin/pages/dashboard/tabs/leads/leadCsvUtils.ts');
  assert.match(source, /import \{ parseCsvRows \} from '[^']*shared\/csv'/);
  assert.ok(!/text\.split\('\n'\)/.test(source), 'a row is not a line: a quoted field may contain one');
  assert.ok(!/\.split\(','\)/.test(source), 'a field is not a comma-separated token');
});
