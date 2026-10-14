// «خلي الحضور مع كشف المرتبات في تاب واحدة وتفاصيل مع بعض»: one row per
// employee for the month — what the fingerprint sheet and the manual entries
// say (attendance summary), beside what the month's payroll run pays them.
// The two screens below it (attendance, payroll runs) stay as they were; this
// is the reading of both together.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Loader2, Wallet } from 'lucide-react';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { PAYROLL_STATUS_LABELS, PAYROLL_STATUS_COLORS } from './hrLabels';
import { fmtMoney } from './hrFormat';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type AttendanceRow = {
  id: string; name: string; department_name?: string | null; biometric_user_no?: string | null;
  present_days?: number; absent_days?: number; late_days?: number; total_late_minutes?: number;
  leave_days?: number; deduction_days?: number | string; flagged_days?: number;
};
type Run = { id: string; month: number | string; year: number | string; status: string };
type Item = {
  staff_id: string; base_salary?: number | string; net_salary?: number | string;
  absence_deductions?: number | string; absence_deduction?: number | string;
  late_deductions?: number | string; late_deduction?: number | string;
  other_deductions?: number | string; other_deduction?: number | string;
  advance_deductions?: number | string; advance_deduction?: number | string;
  commission?: number | string; bonus_amount?: number | string;
};

const num = (value: unknown) => Number(value) || 0;
const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

export default function HrMonthSheet({ notify }: { notify: Notify }) {
  const [month, setMonth] = useState(cairoMonthOnly());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [items, setItems] = useState<Map<string, Item & { runStatus: string }>>(new Map());
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [y, m] = month.split('-');
    setLoading(true);
    try {
      const [summary, runs] = await Promise.allSettled([
        mysqlAdmin.adminGet<AttendanceRow[]>(`/admin/hr/attendance/summary?month=${parseInt(m, 10)}&year=${y}`),
        mysqlAdmin.adminGet<Run[]>('/admin/hr/payroll'),
      ]);
      setAttendance(summary.status === 'fulfilled' && Array.isArray(summary.value) ? summary.value : []);
      const monthRuns = runs.status === 'fulfilled' && Array.isArray(runs.value)
        ? runs.value.filter(run => Number(run.month) === parseInt(m, 10) && Number(run.year) === Number(y) && run.status !== 'CANCELLED')
        : [];
      const details = await Promise.allSettled(monthRuns.map(run => mysqlAdmin.adminGet<{ items?: Item[] }>(`/admin/hr/payroll/${encodeURIComponent(run.id)}`)
        .then(data => (data.items || []).map(item => ({ ...item, runStatus: run.status })))));
      const byStaff = new Map<string, Item & { runStatus: string }>();
      for (const result of details) if (result.status === 'fulfilled') for (const item of result.value) byStaff.set(item.staff_id, item);
      setItems(byStaff);
      setRunStatus(monthRuns[0]?.status || null);
      if (summary.status === 'rejected') notify('error', 'تعذر تحميل حضور الشهر');
    } finally { setLoading(false); }
  }, [month, notify]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => attendance.map(row => {
    const item = items.get(row.id);
    const deductions = item
      ? num(item.absence_deductions ?? item.absence_deduction) + num(item.late_deductions ?? item.late_deduction)
        + num(item.other_deductions ?? item.other_deduction) + num(item.advance_deductions ?? item.advance_deduction)
      : null;
    return { row, item, deductions };
  }), [attendance, items]);
  const totals = useMemo(() => rows.reduce((acc, { row, item }) => ({
    absent: acc.absent + num(row.absent_days), late: acc.late + num(row.late_days),
    net: acc.net + (item ? num(item.net_salary) : 0),
  }), { absent: 0, late: 0, net: 0 }), [rows]);

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
          <CalendarCheck size={16} className="text-indigo-600" /> كشف الشهر — الحضور والمرتب لكل موظف
        </h3>
        <div className="flex items-center gap-2">
          {runStatus
            ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${PAYROLL_STATUS_COLORS[runStatus] || 'bg-gray-100 text-gray-600'}`}>مسير الرواتب: {PAYROLL_STATUS_LABELS[runStatus] || runStatus}</span>
            : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">مفيش مسير رواتب للشهر ده لسه — احسبه من تحت</span>}
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-gray-100 px-2.5 py-1">{n(attendance.length)} موظف</span>
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{n(totals.absent)} يوم غياب</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{n(totals.late)} يوم تأخير</span>
        {items.size > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"><Wallet size={12} /> صافي المرتبات {fmtMoney(totals.net)}</span>}
      </div>

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" size={20} /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-gray-50 text-right text-xs font-bold text-gray-500">
              <tr>
                <th className="px-3 py-2">الموظف</th>
                <th className="px-3 py-2">حضور</th>
                <th className="px-3 py-2">غياب</th>
                <th className="px-3 py-2">تأخير</th>
                <th className="px-3 py-2">إجازات</th>
                <th className="px-3 py-2">أيام خصم</th>
                <th className="border-r border-gray-200 px-3 py-2">الأساسي</th>
                <th className="px-3 py-2">عمولة ومكافأة</th>
                <th className="px-3 py-2">الخصومات</th>
                <th className="px-3 py-2">الصافي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(({ row, item, deductions }) => (
                <tr key={row.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <p className="font-bold text-gray-800">{row.name}</p>
                    <p className="text-[11px] text-gray-400">{[row.department_name, row.biometric_user_no ? `بصمة #${row.biometric_user_no}` : 'بدون رقم بصمة'].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-emerald-700">{n(num(row.present_days))}</td>
                  <td className={`px-3 py-2 tabular-nums ${num(row.absent_days) ? 'font-bold text-red-600' : 'text-gray-300'}`}>{n(num(row.absent_days))}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{num(row.late_days) ? `${n(num(row.late_days))} يوم · ${n(num(row.total_late_minutes))} د` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{num(row.leave_days) ? n(num(row.leave_days)) : '—'}</td>
                  <td className={`px-3 py-2 tabular-nums ${num(row.deduction_days) ? 'font-bold text-amber-700' : 'text-gray-300'}`}>{num(row.deduction_days) ? n(num(row.deduction_days)) : '—'}</td>
                  <td className="border-r border-gray-100 px-3 py-2 tabular-nums">{item ? fmtMoney(num(item.base_salary)) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-700">{item && (num(item.commission) + num(item.bonus_amount)) ? `+${fmtMoney(num(item.commission) + num(item.bonus_amount))}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-red-600">{deductions ? `−${fmtMoney(deductions)}` : '—'}</td>
                  <td className="px-3 py-2 font-extrabold tabular-nums text-gray-900">{item ? fmtMoney(num(item.net_salary)) : <span className="text-xs font-normal text-gray-400">لسه ما اتحسبش</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-gray-400">مفيش موظفين نشطين</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
