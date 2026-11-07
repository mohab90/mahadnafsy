'use strict';
/** «تقارير الإدارة»: how a report becomes a CSV file and a printout (admin/pages/dashboard/tabs/reports/reportFormat.ts, bundled with esbuild and run). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderAdmin } = require('./_renderAdmin');

const lib = renderAdmin('admin/pages/dashboard/tabs/reports/reportFormat.ts');
const skip = !lib && 'admin dependencies are not installed';
const report = {
  key: 'top-courses', group: 'sales', groupLabel: 'المبيعات', title: 'أكتر كورسات', description: 'وصف <b>', from: '2026-03-01', to: '2026-03-31',
  columns: [{ key: 'title', label: 'الكورس', kind: 'text' }, { key: 'moneyEgp', label: 'المبلغ', kind: 'money' }, { key: 'rate', label: 'نسبة', kind: 'number' }],
  rows: [{ title: 'دبلومة "أ", ب', moneyEgp: 1234567, rate: 12.5 }, { title: '<script>alert(1)</script>', moneyEgp: null, rate: 0 }],
  notes: ['ملاحظة'],
};

test('a cell is grouped in digits for a figure, as it is for text, and a dash for nothing', { skip }, () => {
  const { cellText } = lib.module;
  assert.equal(cellText(1234567, 'money'), '1,234,567');
  assert.equal(cellText(12.5, 'number'), '12.5');
  assert.equal(cellText(1234, 'text'), '1234');
  assert.equal(cellText(null, 'money'), '—');
  assert.equal(cellText('', 'text'), '—');
});

test('the CSV carries the title and period, the headings, the figures as numbers and the notes', { skip }, () => {
  const rows = lib.module.csvRows(report);
  assert.deepEqual(rows[0], ['أكتر كورسات', '2026-03-01 → 2026-03-31']);
  assert.deepEqual(rows[1], ['الكورس', 'المبلغ', 'نسبة']);
  assert.deepEqual(rows[2], ['دبلومة "أ", ب', 1234567, 12.5]);
  assert.deepEqual(rows[3], ['<script>alert(1)</script>', '', 0]);
  assert.deepEqual(rows.at(-1), ['ملاحظة']);
  assert.equal(lib.module.csvFileName(report), 'top-courses_2026-03-01_2026-03-31');
  assert.equal(lib.module.periodText('2026-03-01', '2026-03-01'), '2026-03-01');
});

test('the printout is right to left, names the institute, and escapes everything the data says', { skip }, () => {
  const html = lib.module.printHtml(report);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /معهد الدراسات النفسية — أكتر كورسات/);
  assert.ok(!html.includes('<script>'), 'a value is text, never markup');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /وصف &lt;b&gt;/);
  assert.match(html, /<td>1,234,567<\/td>/);
});
