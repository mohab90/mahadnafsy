import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { downloadCsv } from '../../../../../shared/csv';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import ChangeBadge from './ChangeBadge';
import {
  EMPLOYEE_COLUMNS, count, employeeCsv, isRefusal, money, percent, sortEmployees,
  type EmployeeColumn, type EmployeeReport, type EmployeeRow, type SortState,
} from './managementFigures';

const show = (column: EmployeeColumn, value: unknown) => {
  if (column.kind === 'text') return String(value ?? '');
  const number = value as number | null | undefined;
  return column.kind === 'money' ? money(number) : column.kind === 'percent' ? percent(number) : count(number);
};

/** «تقرير الموظفين»: one row per sales / collection / support employee for the period, a totals row, sorting and the CSV of what is shown. */
export default function EmployeeReportTab({ query, onRefused }: { query: string; onRefused: () => void }) {
  const [report, setReport] = useState<EmployeeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'collectedEgp', descending: true });

  useEffect(() => {
    let current = true;
    setReport(null); setError(null);
    mysqlAdmin.getManagementEmployees(query)
      .then(next => { if (current) setReport(next); })
      .catch((reason: unknown) => {
        if (!current) return;
        if (isRefusal(reason)) onRefused(); else setError('تعذر تحميل تقرير الموظفين — جرّب تاني');
      });
    return () => { current = false; };
  }, [query, onRefused]);

  const rows = useMemo(() => (report ? sortEmployees(report.rows, sort) : []), [report, sort]);
  if (error) return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>;
  if (!report) return <div className="flex justify-center py-10" role="status" aria-label="جاري التحميل"><div className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" /></div>;
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-400">مفيش موظفين مبيعات أو تحصيل في الفترة دي.</p>;

  const pick = (key: EmployeeColumn['key']) => setSort(old => (old.key === key ? { key, descending: !old.descending } : { key, descending: key !== 'name' }));
  const exportCsv = () => downloadCsv(`employees_${report.period.from}_${report.period.to}`, employeeCsv(report, rows));
  const headerCell = 'whitespace-nowrap px-2 py-2 text-xs font-bold text-gray-600';

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {report.period.from === report.period.to ? report.period.from : `${report.period.from} ← ${report.period.to}`} · السهم مقارنة بالفترة اللي قبلها ({report.period.previous.from} ← {report.period.previous.to})
        </p>
        <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">
          <Download size={13} />تصدير CSV
        </button>
      </div>
      {/* The table scrolls inside its own box; the page itself never scrolls sideways. */}
      <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-gray-50">
            <tr>
              {EMPLOYEE_COLUMNS.map(column => (
                <th key={column.key} scope="col" className={`${headerCell} ${column.kind === 'text' ? 'text-right' : 'text-center'}`} title={column.hint}
                  aria-sort={sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => pick(column.key)} className="inline-flex items-center gap-0.5 hover:text-primary-700">
                    {column.label}{sort.key === column.key && (sort.descending ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row: EmployeeRow) => (
              <tr key={row.id} className="hover:bg-gray-50/60">
                {EMPLOYEE_COLUMNS.map(column => (
                  <td key={column.key} className={`px-2 py-2 ${column.kind === 'text' ? 'whitespace-nowrap text-right font-semibold text-gray-900' : 'text-center tabular-nums text-gray-700'}`}>
                    {show(column, row[column.key as keyof EmployeeRow])}
                    {column.key === 'bookings' && <div><ChangeBadge vs={row.vsBookings} /></div>}
                    {column.key === 'collectedEgp' && <div><ChangeBadge vs={row.vsCollected} /></div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-extrabold">
            <tr>
              {EMPLOYEE_COLUMNS.map((column, index) => (
                <td key={column.key} className={`px-2 py-2 ${index === 0 ? 'text-right' : 'text-center tabular-nums'}`}>
                  {index === 0 ? 'الإجمالي' : show(column, report.totals[column.key as keyof EmployeeReport['totals']])}
                  {column.key === 'bookings' && <div><ChangeBadge vs={report.totals.vsBookings} /></div>}
                  {column.key === 'collectedEgp' && <div><ChangeBadge vs={report.totals.vsCollected} /></div>}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {report.unattributed.collectedEgp > 0 && (
        <p className="text-xs text-amber-700">فلوس مالهاش موظف في الجدول (عميل من غير موظف متسجل): {money(report.unattributed.collectedEgp)} ج — مش داخلة في الإجمالي فوق.</p>
      )}
    </div>
  );
}
