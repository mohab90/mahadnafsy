'use strict';
/**
 * The real shared/csv.ts, compiled and run (csvExports.test.js tests copies of its functions and the text of the file; this runs the file): a field is quoted only when it
 * needs to be and its quotes are doubled; rows are joined with CRLF; the reader gives back exactly what the writer wrote — commas, quotes and newlines inside a quoted
 * field, the Excel BOM, empty rows dropped — and the delimiter is read off the header outside quotes (comma, semicolon, tab; a tie goes to the comma).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

const csv = bundle('shared/csv.ts');
const skip = !csv && 'esbuild is not installed';

test('a field is quoted only when it needs to be, and its own quotes are doubled', { skip }, () => {
  const { csvField } = csv;
  assert.equal(csvField('أحمد "أبو مازن"'), '"أحمد ""أبو مازن"""');
  assert.equal(csvField('ملاحظة: اتفقنا على 3 أقساط, الأول في سبتمبر'), '"ملاحظة: اتفقنا على 3 أقساط, الأول في سبتمبر"');
  assert.equal(csvField('سطر\nثانٍ'), '"سطر\nثانٍ"');
  assert.equal(csvField(' مسافة سابقة'), '" مسافة سابقة"', 'edge whitespace is kept by quoting');
  assert.equal(csvField('اسم عادي'), 'اسم عادي');
  assert.equal(csvField(0), '0', 'a zero is a zero, not an empty cell');
  assert.equal(csvField(false), 'false');
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
  assert.equal(csv.toCsv([['a', 'b'], ['c', 'd']]), 'a,b\r\nc,d', 'CRLF between rows, none after the last');
  assert.equal(csv.CSV_BOM, '﻿', 'the mark that tells Excel the file is UTF-8');
});

test('the reader gives back exactly what the writer wrote', { skip }, () => {
  const rows = [
    ['الاسم', 'ملاحظة', 'الهاتف'],
    ['أحمد "أبو مازن"', 'اتفقنا على 3 أقساط, الأول في سبتمبر', '01001234567'],
    ['منى', 'سطر أول\nسطر ثانٍ', ''],
    [' بمسافة ', 'عادي', '0'],
  ];
  const text = csv.CSV_BOM + csv.toCsv(rows);
  assert.deepEqual(csv.parseCsvRows(text), rows, 'a comma, a doubled quote, a newline and edge spaces all survive');
  assert.deepEqual(csv.parseCsvRows('a,b\n\n,\nc,d\n'), [['a', 'b'], ['c', 'd']], 'blank rows are dropped, a lone newline ends a row');
  assert.deepEqual(csv.parseCsvRows('a;"b;c";d', ';'), [['a', 'b;c', 'd']], 'another delimiter, quoted');
  assert.deepEqual(csv.parseCsvRows('  x  ,"  y  "'), [['x', '  y  ']], 'unquoted fields are trimmed, quoted ones kept as written');
});

test('the delimiter is read off the header, and only outside quotes', { skip }, () => {
  const { detectCsvDelimiter } = csv;
  assert.equal(detectCsvDelimiter('name,phone,city'), ',');
  assert.equal(detectCsvDelimiter('name;phone;city'), ';');
  assert.equal(detectCsvDelimiter('name\tphone\tcity'), '\t');
  assert.equal(detectCsvDelimiter('"last, first";phone;city'), ';', 'a comma inside a quoted heading does not elect the comma');
  assert.equal(detectCsvDelimiter('"say ""hi"", ok";b;c'), ';', 'a doubled quote inside a quoted heading does not end it');
  assert.equal(detectCsvDelimiter('single'), ',', 'nothing to count: the comma');
  assert.equal(detectCsvDelimiter('a,b;c'), ',', 'a tie goes to the comma');
  assert.equal(detectCsvDelimiter('﻿name;phone'), ';', 'the BOM is not part of the header');
});
