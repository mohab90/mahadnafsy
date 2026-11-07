import { useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { downloadCsv } from '../../../../../shared/csv';
import { cellText, csvFileName, csvRows, periodText, printHtml, type ReportCatalogEntry, type ReportResult } from './reportFormat';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * One report of «تقارير الإدارة»: its one-line description, a button that shows it for the period on the page, and the two exports — a CSV file (opens in Excel) and
 * a printout — each of which asks the server for the figures at the click, so a file is never older than the moment it was asked for.
 */
export function ReportCard({ entry, from, to, notify }: { entry: ReportCatalogEntry; from: string; to: string; notify: Notify }) {
  const [report, setReport] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchReport = () => mysqlAdmin.adminGet<ReportResult>(`/admin/reports/run/${entry.key}?from=${from}&to=${to}`);
  const act = async (what: (fresh: ReportResult) => void) => {
    setBusy(true);
    try { what(await fetchReport()); } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تجهيز التقرير'); } finally { setBusy(false); }
  };
  const show = () => { if (open) { setOpen(false); return; } void act(fresh => { setReport(fresh); setOpen(true); }); };
  const exportCsv = () => void act(fresh => downloadCsv(csvFileName(fresh), csvRows(fresh)));
  const print = () => void act(fresh => {
    const win = window.open('', '_blank');
    if (!win) { notify('error', 'المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة'); return; }
    win.document.write(printHtml(fresh)); win.document.close(); win.focus(); win.print();
  });

  return (
    <article className="rounded-2xl border border-gray-200 bg-white" data-testid="report-card" data-report={entry.key}>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-gray-800">{entry.title}</h4>
          <p className="text-xs text-gray-500">{entry.description}</p>
        </div>
        <button type="button" onClick={show} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">{open ? 'إخفاء' : 'عرض'}</button>
        <button type="button" onClick={exportCsv} disabled={busy} className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-50"><Download size={13} /> Excel / CSV</button>
        <button type="button" onClick={print} disabled={busy} className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-50"><Printer size={13} /> طباعة</button>
        {busy && <RefreshCw size={14} className="animate-spin text-gray-400" />}
      </div>
      {open && report && (
        <div className="border-t border-gray-100 p-4">
          <p className="mb-2 text-[11px] text-gray-400">الفترة: {periodText(report.from, report.to)}</p>
          {report.rows.length === 0 ? <p className="py-4 text-center text-xs text-gray-400">مفيش أرقام في الفترة دي</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500"><tr>{report.columns.map(column => <th key={column.key} className="px-2 py-1.5 text-right">{column.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {report.rows.map((row, i) => <tr key={i}>{report.columns.map(column => <td key={column.key} className="px-2 py-1.5 text-gray-700">{cellText(row[column.key], column.kind)}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}
          {report.notes.map(note => <p key={note} className="mt-2 text-[11px] text-gray-500">{note}</p>)}
        </div>
      )}
    </article>
  );
}
