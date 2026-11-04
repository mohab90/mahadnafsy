import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Loader2, RefreshCw, TrendingUp, UserX, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type AttendanceRow = {
  id: string; name: string; role?: string; department_name?: string | null;
  present_days: number; absent_days: number; excused_days: number; late_days: number; total_late_minutes: number; deduction_days: number; flagged_days: number;
};
type SalesRow = { id: string; name: string; total_leads: number; converted_leads: number; revenue_egp: number; conversion_rate: number | null };

// A day missed without permission costs two days of pay, one with permission costs one (api/lib/payrollCalc.js).
const UNEXCUSED_ABSENCE_DAYS = 2;
const num = (value: unknown) => Number(value) || 0;
const fmt = (n: number) => Math.round(n).toLocaleString('ar-EG-u-nu-latn');

const MONTHS_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function lastMonths(count: number) {
  const [year, month] = cairoMonthOnly().split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + (month - 1) - i;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return { key: `${y}-${String(m).padStart(2, '0')}`, year: y, month: m, label: `${MONTHS_AR[m]} ${y}` };
  });
}

/**
 * «نظرة عامة» of the merged staff-performance page (4 Nov 2026): one month of the team in one look — who is absent without permission (each such day costs two days of pay),
 * who is late, and who brings the money. Each half is drawn only for the viewer who may read it: the attendance half needs view_hr, the sales half the sales-performance key.
 */
export function StaffOverviewSection({ notify }: { notify: NotifyFn }) {
  const months = useMemo(() => lastMonths(6), []);
  const [monthKey, setMonthKey] = useState(months[0].key);
  const [attendance, setAttendance] = useState<AttendanceRow[] | null>(null);
  const [sales, setSales] = useState<SalesRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const picked = months.find(m => m.key === monthKey) || months[0];
    const from = `${picked.key}-01`;
    const lastDay = new Date(Date.UTC(picked.year, picked.month, 0)).getUTCDate();
    const to = `${picked.key}-${String(lastDay).padStart(2, '0')}`;
    const [att, perf] = await Promise.allSettled([
      mysqlAdmin.adminGet<AttendanceRow[]>(`/admin/hr/attendance/summary?month=${picked.month}&year=${picked.year}`),
      mysqlAdmin.adminGet<{ staff: SalesRow[] }>(`/admin/reports/sales-performance?from=${from}&to=${to}`),
    ]);
    setAttendance(att.status === 'fulfilled' && Array.isArray(att.value) ? att.value : null);
    setSales(perf.status === 'fulfilled' && Array.isArray(perf.value?.staff) ? perf.value.staff : null);
    if (att.status === 'rejected' && perf.status === 'rejected') notify('error', 'تعذّر تحميل أرقام الفريق');
    setLoading(false);
  }, [monthKey, months, notify]);
  useEffect(() => { void load(); }, [load]);

  const attendanceView = useMemo(() => {
    if (!attendance) return null;
    const absent = attendance.reduce((s, r) => s + num(r.absent_days), 0);
    const excused = attendance.reduce((s, r) => s + num(r.excused_days), 0);
    const unexcused = absent - excused;
    const lateMinutes = attendance.reduce((s, r) => s + num(r.total_late_minutes), 0);
    // The days of pay the month's absences cost, as payroll will charge them.
    const costDays = excused + unexcused * UNEXCUSED_ABSENCE_DAYS;
    const watch = attendance
      .map(r => ({ ...r, unexcused: num(r.absent_days) - num(r.excused_days), score: (num(r.absent_days) - num(r.excused_days)) * UNEXCUSED_ABSENCE_DAYS + num(r.excused_days) + num(r.total_late_minutes) / 60 }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    return { people: attendance.length, absent, excused, unexcused, lateMinutes, costDays, watch, flagged: attendance.reduce((s, r) => s + num(r.flagged_days), 0) };
  }, [attendance]);

  const topSales = useMemo(() => (sales || []).filter(r => num(r.revenue_egp) > 0 || num(r.total_leads) > 0).slice(0, 6), [sales]);
  const maxRevenue = Math.max(1, ...topSales.map(r => num(r.revenue_egp)));

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1">
          {months.map(m => (
            <button key={m.key} type="button" onClick={() => setMonthKey(m.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${monthKey === m.key ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{m.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />تحديث
        </button>
      </div>

      {loading && !attendance && !sales && <div className="flex justify-center py-16 text-gray-400"><Loader2 className="animate-spin" /></div>}

      {attendanceView && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'موظفين محسوبين', value: fmt(attendanceView.people), icon: Users, tone: 'text-indigo-600' },
              { label: 'غياب بدون إذن', value: fmt(attendanceView.unexcused), sub: `كل يوم بيخصم ${UNEXCUSED_ABSENCE_DAYS} يوم`, icon: UserX, tone: attendanceView.unexcused ? 'text-red-600' : 'text-gray-400' },
              { label: 'غياب بإذن', value: fmt(attendanceView.excused), sub: 'كل يوم بيخصم يوم', icon: UserX, tone: 'text-amber-600' },
              { label: 'دقايق التأخير', value: fmt(attendanceView.lateMinutes), icon: Clock, tone: 'text-orange-600' },
            ].map(card => (
              <div key={card.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-1.5 text-xs text-gray-500"><card.icon size={14} />{card.label}</div>
                <div className={`mt-1 text-2xl font-black ${card.tone}`}>{card.value}</div>
                {card.sub && <div className="text-[11px] text-gray-400">{card.sub}</div>}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">الغياب ده هيتحسب على الرواتب بـ <b>{fmt(attendanceView.costDays)}</b> يوم خصم إجمالًا.</p>
          {attendanceView.flagged > 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} />{fmt(attendanceView.flagged)} يوم عليه علامة مراجعة في الحضور — راجعها قبل حساب الرواتب.
            </p>
          )}

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-800">أكتر حد محتاج متابعة في الحضور</div>
            {attendanceView.watch.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">مفيش غياب ولا تأخير الشهر ده</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr><th className="p-3 text-right font-medium">الموظف</th><th className="p-3 text-center font-medium">بدون إذن</th><th className="p-3 text-center font-medium">بإذن</th><th className="p-3 text-center font-medium">دقايق تأخير</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {attendanceView.watch.map(r => (
                      <tr key={r.id}>
                        <td className="p-3"><div className="font-medium text-gray-800">{r.name}</div>{r.department_name && <div className="text-[11px] text-gray-400">{r.department_name}</div>}</td>
                        <td className={`p-3 text-center font-bold ${r.unexcused ? 'text-red-600' : 'text-gray-300'}`}>{fmt(r.unexcused)}</td>
                        <td className="p-3 text-center">{fmt(num(r.excused_days))}</td>
                        <td className="p-3 text-center">{fmt(num(r.total_late_minutes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {sales && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-800"><TrendingUp size={16} className="text-emerald-600" />أعلى المبيعات (جنيه، مدفوع فقط)</div>
          {topSales.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">مفيش مبيعات ولا ليدات الشهر ده</p>
          ) : (
            <div className="space-y-3 p-4">
              {topSales.map(r => (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate font-medium text-gray-800">{r.name}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, (num(r.revenue_egp) / maxRevenue) * 100)}%` }} />
                  </div>
                  <span className="w-24 text-left font-bold text-gray-700">{fmt(num(r.revenue_egp))} ج</span>
                  <span className="w-28 shrink-0 text-left text-xs text-gray-500">{fmt(num(r.converted_leads))}/{fmt(num(r.total_leads))} ليد{r.conversion_rate !== null ? ` · ${r.conversion_rate}%` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && !attendanceView && !sales && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">مفيش أرقام متاحة لحسابك هنا.</p>
      )}
    </div>
  );
}
