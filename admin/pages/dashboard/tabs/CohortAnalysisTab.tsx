import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Users, TrendingUp, Calendar } from 'lucide-react';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type CohortRow = {
  month: string;
  newSubs: number;
  firstPayment: number;
  retentionByMonth: number[];
};

type CohortData = {
  year: number;
  months: number;
  cohorts: CohortRow[];
};

const MONTH_LABELS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function heatColor(p: number): string {
  if (p === 0)   return 'bg-gray-100 text-gray-400';
  if (p < 10)    return 'bg-emerald-50 text-emerald-600';
  if (p < 25)    return 'bg-emerald-100 text-emerald-700';
  if (p < 40)    return 'bg-emerald-200 text-emerald-800';
  if (p < 60)    return 'bg-emerald-300 text-emerald-900';
  if (p < 80)    return 'bg-emerald-400 text-white';
  return 'bg-emerald-600 text-white';
}

function adminHeaders(): HeadersInit {
  const token = localStorage.getItem('mahad-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function CohortAnalysisTab({ notify }: { notify: NotifyFn }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<CohortData | null>(null);
  const [loading, setLoading] = useState(false);
  const notifyRef = useRef(notify);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/analytics/cohorts?year=${year}&months=${months}`, {
        credentials: 'include',
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      notifyRef.current('error', `خطأ في تحميل بيانات الكوهورت: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [year, months]);

  useEffect(() => { load(); }, [load]);

  const totalNewSubs     = data?.cohorts.reduce((a, c) => a + c.newSubs, 0) ?? 0;
  const totalFirstPay    = data?.cohorts.reduce((a, c) => a + c.firstPayment, 0) ?? 0;
  const conversionRate   = pct(totalFirstPay, totalNewSubs);

  const colHeaders = Array.from({ length: months }, (_, i) => (i === 0 ? 'الشهر 0' : `+${i}`));

  return (
    <div className="space-y-6 p-1" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
            <TrendingUp size={20} className="text-emerald-600" />
            تحليل الكوهورت — الاستبقاء الشهري
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            كل صف = مجموعة مشتركين سجّلوا في نفس الشهر. كل خانة = نسبة من دفع في ذلك الشهر.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={months}
            onChange={e => setMonths(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {[3, 4, 6, 8, 12].map(m => (
              <option key={m} value={m}>{m} أشهر</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
            <Users size={14} /> مشتركون جدد ({year})
          </div>
          <div className="text-2xl font-extrabold text-gray-800">{totalNewSubs.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
            <Calendar size={14} /> دفعة أولى في نفس الشهر
          </div>
          <div className="text-2xl font-extrabold text-emerald-600">{totalFirstPay.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
            <TrendingUp size={14} /> معدل التحويل الأولي
          </div>
          <div className="text-2xl font-extrabold text-blue-600">{conversionRate}%</div>
        </div>
      </div>

      {/* Cohort heatmap table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          جاري التحميل...
        </div>
      ) : data ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-right font-semibold text-gray-600 whitespace-nowrap">شهر التسجيل</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600 whitespace-nowrap">مشتركون</th>
                {colHeaders.map((h, i) => (
                  <th key={i} className="px-3 py-3 text-center font-semibold text-gray-600 whitespace-nowrap min-w-[56px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((row) => {
                const mIdx = parseInt(row.month.slice(5)) - 1;
                const label = `${MONTH_LABELS[mIdx] ?? row.month.slice(5)} ${row.month.slice(0, 4)}`;
                return (
                  <tr key={row.month} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-right font-medium text-gray-700 whitespace-nowrap">{label}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block bg-blue-50 text-blue-700 font-bold px-2.5 py-0.5 rounded-full text-xs">
                        {row.newSubs}
                      </span>
                    </td>
                    {row.retentionByMonth.map((n, offset) => {
                      const p = pct(n, row.newSubs);
                      return (
                        <td key={offset} className="px-2 py-2 text-center">
                          {row.newSubs > 0 ? (
                            <span
                              className={`inline-block w-12 py-1 rounded-lg text-xs font-bold ${heatColor(p)}`}
                              title={`${n} من ${row.newSubs} (${p}%)`}
                            >
                              {p}%
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>الشدة:</span>
            {[['0%','bg-gray-100'],['1-9%','bg-emerald-50'],['10-24%','bg-emerald-100'],['25-39%','bg-emerald-200'],['40-59%','bg-emerald-300'],['60-79%','bg-emerald-400'],['80%+','bg-emerald-600']].map(([lbl, cls]) => (
              <span key={lbl} className="flex items-center gap-1">
                <span className={`inline-block w-5 h-3 rounded ${cls}`} />
                {lbl}
              </span>
            ))}
            <span className="mr-auto">كل خانة = % من المشتركين في الكوهورت الذين دفعوا في ذلك الشهر</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
