import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Droplets, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }
interface CashFlowMonth { month: string; revenue: number; refunds: number; expenses: number; netCashFlow: number; }
interface CashFlow {
  period: { from: string; to: string };
  branch: string | null;
  operating: { inflows: number; outflows: number; refunds: number; netOperatingCashFlow: number };
  monthly: CashFlowMonth[];
}

const money = (value: number) =>
  Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });

const periodDates = (months: number) => {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};

const CashFlowTab: React.FC<Props> = ({ notify }) => {
  const [monthsCount, setMonthsCount] = useState(6);
  const [data, setData] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const { from, to } = periodDates(monthsCount);
      try {
        const result = await mysqlAdmin.getFinancialCashFlow(from, to);
        if (active) setData(result);
      } catch (error) {
        if (active) {
          setData(null);
          notify('error', error instanceof Error ? error.message : 'تعذر تحميل التدفق النقدي');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [monthsCount, notify]);

  const months = useMemo(() => {
    if (!data) return [];
    const source = new Map(data.monthly.map((row) => [row.month, row]));
    const { from } = periodDates(monthsCount);
    const start = new Date(`${from}T00:00:00Z`);
    return Array.from({ length: monthsCount }, (_, index) => {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      const key = date.toISOString().slice(0, 7);
      return source.get(key) || { month: key, revenue: 0, refunds: 0, expenses: 0, netCashFlow: 0 };
    });
  }, [data, monthsCount]);

  if (loading) {
    return <div className="flex min-h-56 items-center justify-center text-gray-500"><RefreshCw className="ml-2 animate-spin" size={18} /> جاري تحميل دفتر الأستاذ…</div>;
  }
  if (!data) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">لا يمكن عرض تدفق نقدي تقديري. راجع اتصال قاعدة البيانات ثم أعد المحاولة.</div>;
  }

  const max = Math.max(1, ...months.flatMap((row) => [row.revenue, row.expenses + row.refunds]));

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-blue-700 to-cyan-600 p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold"><Droplets size={22} /> قائمة التدفق النقدي</h2>
            <p className="mt-1 text-sm text-blue-100">حركة حساب النقدية الفعلية من قيود دفتر الأستاذ.</p>
          </div>
          <select value={monthsCount} onChange={(event) => setMonthsCount(Number(event.target.value))} className="rounded-xl border border-white/30 bg-blue-700 px-3 py-2 text-sm">
            <option value={3}>3 أشهر</option>
            <option value={6}>6 أشهر</option>
            <option value={12}>12 شهرًا</option>
          </select>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['التدفق الداخل', data.operating.inflows],
            ['التدفق الخارج', data.operating.outflows],
            ['الاستردادات', data.operating.refunds],
            ['صافي التدفق', data.operating.netOperatingCashFlow],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-white/15 p-3 text-center">
              <div className="font-black">{money(Number(value))} ج.م</div>
              <div className="text-xs text-blue-100">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-gray-800"><BarChart3 size={17} className="text-blue-600" /> التدفق الشهري من دفتر الأستاذ</h3>
        <div className="grid gap-3">
          {months.map((row) => (
            <div key={row.month} className="grid grid-cols-[5rem_1fr_7rem] items-center gap-3 text-xs">
              <strong>{row.month}</strong>
              <div className="space-y-1">
                <div className="h-2 rounded bg-green-400" style={{ width: `${Math.max(1, row.revenue / max * 100)}%` }} title={`داخل ${money(row.revenue)}`} />
                <div className="h-2 rounded bg-red-400" style={{ width: `${Math.max(1, (row.expenses + row.refunds) / max * 100)}%` }} title={`خارج ${money(row.expenses + row.refunds)}`} />
              </div>
              <span className={`text-left font-bold ${row.netCashFlow >= 0 ? 'text-green-700' : 'text-red-700'}`}>{money(row.netCashFlow)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-center gap-4 text-xs text-gray-600">
          <span><i className="ml-1 inline-block h-2 w-3 rounded bg-green-400" /> داخل</span>
          <span><i className="ml-1 inline-block h-2 w-3 rounded bg-red-400" /> خارج + استردادات</span>
        </div>
      </section>

      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle size={18} />
        التقرير يعرض فقط القيود المرحلة على حساب النقدية 1100؛ أي عملية غير مرحلة محاسبيًا لن تظهر هنا.
      </div>
    </div>
  );
};

export default CashFlowTab;
