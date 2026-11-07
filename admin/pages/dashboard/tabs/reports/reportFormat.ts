import type { CsvValue } from '../../../../../shared/csv';

/**
 * «تقارير الإدارة»: a report as the server answers it (api/lib/reportRunner.js) and how it becomes a CSV file or a page to print.
 */
export type ReportColumn = { key: string; label: string; kind: 'text' | 'number' | 'money' };
export type ReportCatalogEntry = { key: string; group: string; groupLabel: string; title: string; description: string };
export type ReportResult = ReportCatalogEntry & { from: string; to: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[]; notes: string[] };

/** A cell as the screen and the printout show it: numbers grouped in Arabic-Indic-free Latin digits, text as it is, nothing as a dash. */
export function cellText(value: string | number | null | undefined, kind: ReportColumn['kind']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && kind !== 'text') return Math.round(value * 10) / 10 === Math.round(value) ? Math.round(value).toLocaleString('ar-EG-u-nu-latn') : value.toLocaleString('ar-EG-u-nu-latn');
  return String(value);
}

/** The period as a sentence: one day, or from → to. */
export const periodText = (from: string, to: string) => (from === to ? from : `${from} → ${to}`);

/** The rows of the CSV file: the title and period, the headings, the figures as numbers (not grouped text), and the notes under them. */
export function csvRows(report: ReportResult): CsvValue[][] {
  return [
    [report.title, periodText(report.from, report.to)],
    report.columns.map(column => column.label),
    ...report.rows.map(row => report.columns.map(column => (row[column.key] ?? ''))),
    ...report.notes.map(note => [note]),
  ];
}

export const csvFileName = (report: ReportResult) => `${report.key}_${report.from}_${report.to}`;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch] as string));

/** A self-contained page for the browser's print dialog: right to left, the title, the period, the table and the notes. Every value is escaped. */
export function printHtml(report: ReportResult): string {
  const head = report.columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = report.rows.map(row => `<tr>${report.columns.map(column => `<td>${escapeHtml(cellText(row[column.key], column.kind))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>`
    + '<style>body{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}p{margin:2px 0 12px;color:#555;font-size:13px}'
    + 'table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}th{background:#f3f4f6}.note{font-size:12px;color:#555}</style></head><body>'
    + `<h1>معهد الدراسات النفسية — ${escapeHtml(report.title)}</h1><p>${escapeHtml(report.description)} · ${escapeHtml(periodText(report.from, report.to))}</p>`
    + `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    + report.notes.map(note => `<p class="note">${escapeHtml(note)}</p>`).join('') + '</body></html>';
}
