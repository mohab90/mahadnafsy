'use strict';

// The collection-sheet comparison (lib/collectionSheetReconcile.js) as an Arabic report: a short summary per collection employee, then the detailed lists — as
// Markdown (printable) and as CSV (opens in Excel: UTF-8 with a BOM). It holds real names, phones and amounts: keep it off the repository.

const BOM = String.fromCharCode(0xFEFF);
const LABELS = Object.freeze({
  FOUND_SAME: 'موجودة بنفس الموظف', OTHER_EMPLOYEE: 'موجودة باسم موظف تاني', TYPE_MISMATCH: 'موجودة بس النوع مختلف (شهادة ↔ كورس)',
  DIFFERENT: 'موجودة بس المبلغ أو التاريخ مختلف', NOT_IN_SYSTEM: 'مش موجودة في السيستم', UNPAID_IN_SYSTEM: 'في السيستم بس فاشلة/معلّقة', NOT_REGISTERED: 'العميل مش مسجل',
});
const TYPE_AR = { COURSE: 'كورس', CERTIFICATE: 'شهادة', CARNEH: 'كارنيه', BOOK: 'كتاب', CONSULTATION: 'استشارة' };
const fmt = value => (value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim() || '—';
const table = (head, body) => (body.length
  ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map(line => `| ${line.map(cell).join(' | ')} |`)].join('\n')
  : '_مفيش_');
const kindsText = kinds => kinds.map(kind => TYPE_AR[kind] || kind).join(' + ');

const detailOf = row => {
  const parts = [];
  for (const diff of row.diffs || []) {
    parts.push(diff.field === 'amount'
      ? `المبلغ: الشيت ${fmt(diff.sheet)} · السيستم ${fmt(diff.system)} (${diff.gap > 0 ? '+' : ''}${fmt(diff.gap)})`
      : `التاريخ: الشيت ${diff.sheet || '—'} · السيستم ${diff.system}${diff.gap != null ? ` (${diff.gap > 0 ? '+' : ''}${diff.gap} يوم)` : ''}`);
  }
  if (row.category === 'OTHER_EMPLOYEE') parts.push(`السيستم: ${[...new Set(row.payments.map(payment => payment.staff?.name || 'بدون موظف'))].join('، ')}`);
  if (row.flags.includes('OTHER_EMPLOYEE') && row.category === 'DIFFERENT') parts.push(`باسم موظف تاني: ${row.payments.map(payment => payment.staff?.name || 'بدون موظف').join('، ')}`);
  if (row.flags.includes('TYPE_MISMATCH') && row.category !== 'TYPE_MISMATCH') parts.push('النوع مختلف');
  return [...parts, ...row.notes.filter(note => !/^النوع:/.test(note) || row.category === 'TYPE_MISMATCH')].join(' ؛ ');
};
const rowLine = row => [row.tab, row.rowNumber, row.name, row.phones[0] || row.senderPhones[0] || '—', row.text || '—', kindsText(row.kinds), row.day || '—', fmt(row.amount)];
const HEAD = ['التاب', 'صف', 'العميل', 'التليفون', 'النص', 'النوع', 'التاريخ', 'المبلغ'];

function renderMarkdown(report) {
  const { totals } = report;
  const out = [];
  out.push(`# مطابقة شيت التحصيل — ${report.month}`, '', `معهد الدراسات النفسية · الفترة ${report.from} → ${report.to} · اتعمل ${report.generatedAt.slice(0, 16).replace('T', ' ')} · قراءة فقط: مفيش حاجة اتغيّرت في السيستم.`, '');
  const unmapped = report.tabs.filter(tab => !tab.employee);
  if (unmapped.length) {
    out.push('## ⚠ تابات مش مربوطة بموظف', '', `${unmapped.map(tab => `«${tab.tab}»${tab.mapError ? ` (${tab.mapError})` : ''}${tab.ambiguous.length ? ` (بيطابق أكتر من موظف: ${tab.ambiguous.join('، ')})` : ''}`).join('، ')} — من غير موظف مفيش مقارنة بالموظف ولا بإجمالي السيستم لهذه التابات. مرّر ملف \`--map=<file.json>\` (اسم التاب ← id الموظف أو اسمه بالظبط).`, '');
  }
  out.push('## الملخص', '', table(['', 'العدد'], [
    ['دفعات الشيت اللي اتقرت', totals.rows], ...Object.entries(LABELS).map(([key, label]) => [label, totals[key]]),
    ['منها عليها اختلاف نوع (شهادة ↔ كورس)', totals.TYPE_FLAGS], ['صفوف تاريخها خارج الشهر', totals.outsideMonth],
    ['دفعات في السيستم للمحصّلين مش في الشيت', totals.missingFromSheet], ['صفوف مقدرناش نقراها', report.unreadable.length],
    ['إجمالي الشيت (ج.م)', fmt(totals.sheetAmount)], ['إجمالي دفعات الشهر في السيستم، كل الموظفين (ج.م)', fmt(totals.systemAmount)],
  ]), '');

  out.push('## كل موظف تحصيل', '', table(
    ['التاب', 'الموظف', 'دفعات', 'بنفس الموظف', 'موظف تاني', 'نوع مختلف', 'مبلغ/تاريخ مختلف', 'مش في السيستم', 'فاشلة/معلّقة', 'عميل مش مسجل', 'إجمالي الشيت', 'إجمالي السيستم', 'الفرق', 'في السيستم مش في التاب'],
    report.perCollector.map(item => [
      item.tab, item.employee ? item.employee.name : 'مفيش موظف بالاسم ده', item.rows, item.counts.FOUND_SAME, item.counts.OTHER_EMPLOYEE, item.counts.TYPE_MISMATCH, item.counts.DIFFERENT,
      item.counts.NOT_IN_SYSTEM, item.counts.UNPAID_IN_SYSTEM, item.counts.NOT_REGISTERED, fmt(item.sheetTotal), item.employee ? fmt(item.systemTotal) : '—', item.difference == null ? '—' : fmt(item.difference),
      `${item.missingFromTab.count} (${fmt(item.missingFromTab.amount)})`,
    ])), '');
  for (const item of report.perCollector) {
    out.push(`### ${item.tab}${item.employee ? ` — ${item.employee.name}` : ''}`, '');
    out.push(`- إجمالي الشيت (دفعات الشهر): **${fmt(item.sheetTotal)}**${item.sheetOutsideMonth ? ` · خارج الشهر ${fmt(item.sheetOutsideMonth)}` : ''}`);
    if (item.employee) {
      out.push(`- إجمالي السيستم (دفعات الشهر المسجلة باسمه، كل الأنواع): **${fmt(item.systemTotal)}** في ${item.systemPayments} دفعة`);
      out.push(`- الفرق (الشيت − السيستم): **${fmt(item.difference)}**${item.reasons.length ? ' — تفصيله:' : ''}`);
      for (const reason of item.reasons) out.push(`  - ${reason.label}: ${reason.rows} ${['PAIRED_GAP', 'MISSING_FROM_TAB'].includes(reason.kind) ? 'دفعة' : 'صف'} (${reason.amount > 0 ? '+' : ''}${fmt(reason.amount)})`);
    } else out.push('- مفيش موظف مربوط بالتاب ده، فمفيش مقارنة بإجمالي السيستم.');
    out.push('');
  }

  const tabless = report.tabs.filter(item => !item.employee);
  out.push('## تابات ما اتطابقتش مع موظف', '', tabless.length ? table(['التاب', 'ملاحظة'], tabless.map(item => [item.tab, item.ambiguous.length ? `بيطابق أكتر من موظف: ${item.ambiguous.join('، ')}` : 'مفيش موظف بالاسم ده'])) : '_كل التابات اتطابقت_', '');

  const section = (title, category, columns, line) => {
    const rows = report.rows.filter(row => row.category === category);
    out.push(`## ${title} (${rows.length})`, '', table(columns, rows.map(line)), '');
  };
  section('دفعات موجودة باسم موظف تاني', 'OTHER_EMPLOYEE', [...HEAD, 'تفاصيل'], row => [...rowLine(row), detailOf(row)]);
  section('دفعات مبلغها أو تاريخها مختلف', 'DIFFERENT', [...HEAD, 'تفاصيل'], row => [...rowLine(row), detailOf(row)]);
  section('شهادة مسجلة كأنها كورس (أو العكس)', 'TYPE_MISMATCH', [...HEAD, 'تفاصيل'], row => [...rowLine(row), detailOf(row)]);
  section('دفعات مش موجودة في السيستم', 'NOT_IN_SYSTEM', [...HEAD, 'كود العميل · ملاحظات'], row => [...rowLine(row), `${row.client?.code || ''} ${detailOf(row)}`]);
  section('دفعات في السيستم بس فاشلة أو معلّقة', 'UNPAID_IN_SYSTEM', [...HEAD, 'تفاصيل'], row => [...rowLine(row), detailOf(row)]);
  section('عملاء مش مسجلين في السيستم', 'NOT_REGISTERED', [...HEAD, 'ملاحظات'], row => [...rowLine(row), detailOf(row)]);

  const noted = report.rows.filter(row => row.category === 'FOUND_SAME' && row.notes.length);
  out.push(`## موجودة بنفس الموظف وعليها ملاحظات (${noted.length})`, '', table([...HEAD, 'ملاحظات'], noted.map(row => [...rowLine(row), detailOf(row)])), '');

  out.push(`## دفعات في السيستم للمحصّلين مش في الشيت (${report.missingFromSheet.length})`, '', table(
    ['الموظف', 'عنده تاب؟', 'العميل', 'الكود', 'النوع', 'الكورس', 'التاريخ', 'المبلغ', 'بالمصري', 'طريقة الدفع'],
    [...report.missingFromSheet].sort((a, b) => String(a.employee?.name).localeCompare(String(b.employee?.name), 'ar') || a.day.localeCompare(b.day))
      .map(item => [item.employee?.name || '—', item.employeeHasTab ? 'أيوه' : 'لأ', item.client, item.clientCode, TYPE_AR[item.type] || item.type, item.title, item.day, `${fmt(item.amount)} ${item.currency}`, fmt(item.amountEgp), item.method])), '');

  out.push(`## صفوف ما اتقراتش (${report.unreadable.length})`, '', table(['التاب', 'صف', 'السبب', 'الخلايا'], report.unreadable.map(item => [item.tab, item.rowNumber, item.reason, item.cells.filter(Boolean).join(' · ')])), '');
  return out.join('\n');
}

function renderCsv(report) {
  const head = ['التاب', 'الموظف', 'الصف', 'العميل', 'التليفون', 'النص', 'النوع', 'التاريخ', 'المبلغ', 'طريقة الدفع', 'الحالة', 'تفاصيل', 'كود العميل', 'دفعات السيستم (تاريخ · مبلغ · موظف)'];
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [head, ...report.rows.map(row => [
    row.tab, row.employee?.name || '', row.rowNumber, row.name, row.phones.join(' / '), row.text, kindsText(row.kinds), row.day || '', row.amount, row.method || '', LABELS[row.category],
    detailOf(row), row.client?.code || '', row.payments.map(payment => `${payment.day} · ${fmt(payment.amountEgp)} · ${payment.staff?.name || 'بدون موظف'}`).join(' ؛ '),
  ])];
  return `${BOM}${lines.map(line => line.map(quote).join(',')).join('\r\n')}\r\n`;
}

module.exports = { LABELS, renderMarkdown, renderCsv };
