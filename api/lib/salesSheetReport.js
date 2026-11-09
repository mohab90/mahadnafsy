'use strict';

// The sales-sheet comparison (lib/salesSheetReconcile.js) as an Arabic report: a short summary per rep, then the detailed lists — as Markdown (printable) and
// as CSV (opens in Excel: UTF-8 with a BOM). It holds real names and phones: keep it off the repository.

const BOM = String.fromCharCode(0xFEFF);
const LABELS = Object.freeze({
  MATCHED: 'مطابق', DIFFERENT: 'مختلف', REFUNDED: 'اتعمله استرداد', VOIDED: 'دفعته اتمسحت', NO_PAID_BOOKING: 'مسجل بدون حجز مدفوع',
  NOT_REGISTERED: 'مش مسجل في السيستم', OTHER_REP: 'باسم سيلز تاني',
});
const FIELD = { price: 'السعر', course: 'الكورس', date: 'التاريخ', rep: 'السيلز', branch: 'الفرع' };
const fmt = value => (value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim() || '—';
const table = (head, body) => (body.length
  ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map(line => `| ${line.map(cell).join(' | ')} |`)].join('\n')
  : '_مفيش_');

const diffText = row => row.diffs.map(diff => {
  if (diff.field === 'rep') return `السيلز: الشيت ${diff.sheet} · السيستم ${diff.system ?? 'مفيش'}`;
  if (diff.field === 'price') return `السعر: الشيت ${fmt(diff.sheet)} · السيستم ${fmt(diff.system)} (${diff.gap > 0 ? '+' : ''}${fmt(diff.gap)})`;
  return `${FIELD[diff.field] || diff.field}: الشيت ${diff.sheet ?? '—'} · السيستم ${diff.system ?? '—'}${diff.note ? ` (${diff.note})` : ''}`;
}).join(' ؛ ');

const rowLine = row => [row.tab, row.rowNumber, row.name, row.phones[0] || '—', row.course, row.day || '—', fmt(row.price)];

function renderMarkdown(report) {
  const { totals } = report;
  const out = [];
  out.push(`# مطابقة شيت المبيعات — ${report.month}`, '', `معهد الدراسات النفسية · الفترة ${report.from} → ${report.to} · اتعمل ${report.generatedAt.slice(0, 16).replace('T', ' ')} · قراءة فقط: مفيش حاجة اتغيّرت في السيستم.`, '');
  out.push('## الملخص', '', table(['', 'العدد'], [
    ['صفوف الشيت اللي اتقرت', totals.rows], ...Object.entries(LABELS).map(([key, label]) => [label, totals[key]]),
    ['حجوزات في السيستم هذا الشهر', totals.systemBookings], ['حجوزات في السيستم مش في الشيت', totals.missingFromSheet], ['صفوف مقدرناش نقراها', report.unreadable.length],
  ]), '');

  out.push('## كل سيلز', '', table(
    ['التاب', 'الموظف', 'صفوف (روند 1 / 2)', 'مطابق', 'مختلف', 'استرداد/ممسوح', 'مش مسجل/بدون حجز', 'سيلز تاني', 'حجوزات الشيت', 'حجوزات السيستم', 'مكافأة الشيت', 'مكافأة السيستم', 'الفرق'],
    report.perRep.map(rep => [
      rep.tab, rep.staff ? `${rep.staff.name} (أول تارجيت ${rep.staff.firstTarget ?? 'غير محدد'})` : 'مفيش موظف بالاسم ده',
      `${rep.rows} (${rep.rowsByRound[1]} / ${rep.rowsByRound[2]})`, rep.counts.MATCHED, rep.counts.DIFFERENT, rep.counts.REFUNDED + rep.counts.VOIDED,
      rep.counts.NOT_REGISTERED + rep.counts.NO_PAID_BOOKING, rep.counts.OTHER_REP, fmt(rep.sheet.byMarker.bookings), rep.system ? fmt(rep.system.bookings) : '—',
      fmt(rep.sheet.byMarker.amount), rep.system ? fmt(rep.system.amount) : '—', rep.difference == null ? '—' : fmt(rep.difference),
    ])), '');
  for (const rep of report.perRep) {
    out.push(`### ${rep.tab}${rep.staff ? ` — ${rep.staff.name}` : ''}`, '');
    const roundsOf = side => side.rounds.map(round => `${round.label}: ${fmt(round.bookings)} حجز ← ${fmt(round.amount)}`).join(' · ');
    out.push(`- من الشيت (الروندات بفاصل «النص التانى»): ${roundsOf(rep.sheet.byMarker)} = **${fmt(rep.sheet.byMarker.amount)}**`);
    if (rep.sheet.byDate.amount !== rep.sheet.byMarker.amount) out.push(`- من الشيت لو الروندات بالتاريخ (1–15 / 16–آخر الشهر): ${roundsOf(rep.sheet.byDate)} = ${fmt(rep.sheet.byDate.amount)}`);
    out.push(`- الشيت بأول تارجيت 10 / 15 / 20: ${fmt(rep.sheet.byFirstTarget[10])} / ${fmt(rep.sheet.byFirstTarget[15])} / ${fmt(rep.sheet.byFirstTarget[20])}`);
    if (rep.system) {
      out.push(`- من السيستم: ${roundsOf(rep.system)} = **${fmt(rep.system.amount)}**${rep.system.onScheme ? '' : ' (الموظف مش على نظام المكافآت: اتحسب هنا بس)'}${rep.system.total !== rep.system.amount ? ` · الإجمالي بعد التعديلات ${fmt(rep.system.total)}` : ''}`);
      out.push(`- الفرق (الشيت − السيستم): **${fmt(rep.difference)}**${rep.reasons.length ? ' — السبب:' : ''}`);
      for (const reason of rep.reasons) out.push(`  - ${reason.label}: ${reason.rows} صف${reason.weight ? ` (${reason.weight > 0 ? '+' : ''}${fmt(reason.weight)} حجز)` : ''}`);
    } else out.push('- من السيستم: مفيش موظف مربوط بالتاب ده، فمفيش حساب من السيستم.');
    out.push('');
  }

  const tabless = report.tabs.filter(item => !item.staff);
  out.push('## تابات ما اتطابقتش مع موظف', '', tabless.length ? table(['التاب', 'ملاحظة'], tabless.map(item => [item.tab, item.ambiguous.length ? `بيطابق أكتر من موظف: ${item.ambiguous.join('، ')}` : 'مفيش موظف بالاسم ده'])) : '_كل التابات اتطابقت_', '');

  const section = (title, category, columns, line) => {
    const rows = report.rows.filter(row => row.category === category);
    out.push(`## ${title} (${rows.length})`, '', table(columns, rows.map(line)), '');
  };
  section('صفوف مختلفة', 'DIFFERENT', ['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'الفروق'], row => [...rowLine(row), diffText(row)]);
  section('عملاء حصلها استرداد', 'REFUNDED', ['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'كود العميل'], row => [...rowLine(row), row.client?.code || '—']);
  section('دفعات اتمسحت', 'VOIDED', ['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'كود العميل'], row => [...rowLine(row), row.client?.code || '—']);
  section('باسم سيلز تاني في السيستم', 'OTHER_REP', ['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'الشيت ↔ السيستم'], row => [...rowLine(row), diffText(row)]);
  section('مش مسجلين في السيستم (ما اترفعوش)', 'NOT_REGISTERED', ['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'ملاحظات'], row => [...rowLine(row), row.notes.join(' ؛ ')]);
  section('مسجلين بدون حجز مدفوع', 'NO_PAID_BOOKING', ['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'كود العميل · ملاحظات'], row => [...rowLine(row), `${row.client?.code || ''} ${row.notes.join(' ؛ ')}`]);

  const noted = report.rows.filter(row => row.category === 'MATCHED' && row.notes.length);
  out.push(`## مطابق وعليه ملاحظات (${noted.length})`, '', table(['التاب', 'صف', 'العميل', 'التليفون', 'الكورس', 'التاريخ', 'سعر الشيت', 'ملاحظات'], noted.map(row => [...rowLine(row), row.notes.join(' ؛ ')])), '');

  out.push(`## حجوزات في السيستم مش في الشيت (${report.missingFromSheet.length})`, '', table(
    ['السيلز في السيستم', 'عنده تاب؟', 'العميل', 'الكود', 'الكورس', 'التاريخ', 'السعر بالمصري', 'سجّلها'],
    [...report.missingFromSheet].sort((a, b) => String(a.owner?.name).localeCompare(String(b.owner?.name), 'ar') || a.day.localeCompare(b.day))
      .map(item => [item.owner?.name || 'مفيش سيلز', item.owner ? (item.ownerHasTab ? 'أيوه' : 'لأ') : '—', item.client, item.clientCode, item.item, item.day, fmt(item.priceEgp), item.recordedBy?.name || '—'])), '');

  out.push(`## صفوف ما اتقراتش (${report.unreadable.length})`, '', table(['التاب', 'صف', 'السبب', 'الخلايا'], report.unreadable.map(item => [item.tab, item.rowNumber, item.reason, item.cells.filter(Boolean).join(' · ')])), '');
  out.push('## أسماء الكورسات (للمراجعة)', '', 'اسم الكورس في الشيت ↔ اسمه في السيستم. لو في اتنين مش واحد بس بنفس الاسم يبقى اتحسبوا اختلاف.', '', table(['الشيت', 'السيستم', 'صفوف'], report.courseNames.map(item => [item.sheet, item.system || '—', item.rows])), '');
  return out.join('\n');
}

function renderCsv(report) {
  const head = ['التاب', 'الصف', 'العميل', 'التليفون', 'الكورس', 'تاريخ الشيت', 'سعر الشيت', 'الروند', 'الحالة', 'الفروق', 'ملاحظات', 'كود العميل', 'الكورس في السيستم', 'سعر السيستم', 'سيلز السيستم', 'تاريخ السيستم'];
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [head, ...report.rows.map(row => [
    row.tab, row.rowNumber, row.name, row.phones.join(' / '), row.course, row.day || '', row.price, row.round ?? '', LABELS[row.category], diffText(row), row.notes.join(' ؛ '),
    row.client?.code || '', row.system?.title || '', row.system?.agreed ?? '', row.system?.rep?.name || '', row.system?.day || row.system?.firstPaidOn || '',
  ])];
  return `${BOM}${lines.map(line => line.map(quote).join(',')).join('\r\n')}\r\n`;
}

module.exports = { LABELS, renderMarkdown, renderCsv };
