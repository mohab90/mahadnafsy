import { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Users, Wallet, Calendar, Building2 } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

interface Summary {
  headcount: { total: number; active: number; full_time: number; part_time: number };
  salStats: { avg_base: number | null; total_monthly: number | null };
  leaveStats: { total_requests: number; pending: number; approved: number; days_this_month: number };
  attStats: { total_logs: number; this_month: number; avg_late_minutes: number | null };
  recruitStats: { open_jobs: number; active_applicants: number; hired_total: number };
  onboardStats: { in_progress: number; completed: number };
}

interface PayrollTrendRow {
  year: number; month: number; total_net: number; total_allowances: number; employee_count: number; status: string;
}

interface DepartmentRow {
  id: string; name: string; headcount: number; avg_salary: number | null; total_salary: number | null;
}

const MONTHS_AR = ['', 'يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// HR-06: these 3 report endpoints (routes/hr/reports.js) were fully built and
// working, but had zero frontend consumer. Wired up here rather than left
// dead or deleted, since they're genuinely useful HR-wide analytics.
export default function HrAnalyticsTab({ notify }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<PayrollTrendRow[]>([]);
  const [depts, setDepts] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, d] = await Promise.all([
        mysqlAdmin.adminGet<Summary>('/admin/hr/reports/summary'),
        mysqlAdmin.adminGet<PayrollTrendRow[]>('/admin/hr/reports/payroll-trend'),
        mysqlAdmin.adminGet<DepartmentRow[]>('/admin/hr/reports/department-stats'),
      ]);
      setSummary(s);
      setTrend(Array.isArray(t) ? t : []);
      setDepts(Array.isArray(d) ? d : []);
    } catch { notify('error', 'فشل تحميل تقارير HR'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('ar-EG-u-nu-latn');
  const maxTrend = Math.max(1, ...trend.map(r => Number(r.total_net) || 0));

  if (loading) {
    return <div className="flex items-center justify-center py-20"><RefreshCw size={28} className="animate-spin text-primary-500" /></div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-slate-800 to-gray-700 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 size={22} /> تقارير وتحليلات HR</h2>
            <p className="text-gray-300 text-sm mt-0.5">نظرة عامة على القوى العاملة والرواتب والإجازات والتوظيف</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-xl text-sm">
            <RefreshCw size={14} /> تحديث
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي الموظفين', value: summary.headcount?.total ?? 0, icon: Users, color: 'blue' },
            { label: 'نشطون', value: summary.headcount?.active ?? 0, icon: Users, color: 'emerald' },
            { label: 'متوسط الراتب الأساسي', value: `${fmt(summary.salStats?.avg_base)} ج.م`, icon: Wallet, color: 'violet' },
            { label: 'إجمالي الرواتب الشهري', value: `${fmt(summary.salStats?.total_monthly)} ج.م`, icon: Wallet, color: 'amber' },
            { label: 'طلبات إجازة معلقة', value: summary.leaveStats?.pending ?? 0, icon: Calendar, color: 'red' },
            { label: 'أيام إجازة هذا الشهر', value: summary.leaveStats?.days_this_month ?? 0, icon: Calendar, color: 'blue' },
            { label: 'وظائف مفتوحة', value: summary.recruitStats?.open_jobs ?? 0, icon: Building2, color: 'emerald' },
            { label: 'متقدمون نشطون', value: summary.recruitStats?.active_applicants ?? 0, icon: Building2, color: 'violet' },
          ].map(k => (
            <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4`}>
              <div className="flex items-center gap-2 text-gray-500 mb-1"><k.icon size={14} /><span className="text-xs">{k.label}</span></div>
              <div className="text-xl font-extrabold text-gray-900">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Payroll trend */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">اتجاه صافي الرواتب (آخر 6 أشهر معتمدة/مدفوعة)</h3>
          {trend.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">لا توجد بيانات رواتب معتمدة بعد</p>
          ) : (
            <div className="space-y-3">
              {trend.map(row => (
                <div key={`${row.year}-${row.month}`} className="flex items-center gap-3">
                  <span className="text-xs w-16 shrink-0 text-gray-600">{MONTHS_AR[row.month]} {row.year}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-600 rounded-full" style={{ width: `${Math.round((Number(row.total_net) || 0) / maxTrend * 100)}%` }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-24 text-right">{fmt(row.total_net)} ج.م</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Department breakdown */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="font-bold text-gray-800">التوزيع حسب القسم</h3>
          </div>
          {depts.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">لا توجد أقسام مُعرَّفة بعد</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs font-semibold">
                  <th className="px-4 py-2 text-right">القسم</th>
                  <th className="px-4 py-2 text-center">عدد الموظفين</th>
                  <th className="px-4 py-2 text-center">متوسط الراتب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {depts.map(d => (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{d.name}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{d.headcount}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{fmt(d.avg_salary)} ج.م</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
