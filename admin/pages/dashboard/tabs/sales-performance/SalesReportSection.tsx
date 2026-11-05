import { useEffect, useMemo, useState } from 'react';
import { rangeStartDate } from '../../../../lib/rangeStart';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { STATUS_CFG } from '../leadUtils';

// «تقرير المبيعات»: a section of أداء المبيعات (the page «تقارير المبيعات» was removed on 5 Nov 2026). The numbers are the server's
// (GET /api/admin/reports/sales-breakdown): the leads by status and source, and the collected money in EGP in total, by employee and by course or track, over
// the range chosen. Bars drawn with CSS — no chart library for four lists.

type Range = 'week' | 'month' | '3months' | 'all';
type Breakdown = {
  leads: { status: string; source: string; n: number }[];
  revenue: number; payments: number;
  byStaff: { staffId: string | null; name: string; revenue: number; payments: number }[];
  byItem: { id: string | null; name: string; revenue: number; payments: number }[];
};

const RANGES: [Range, string][] = [['week', 'أسبوع'], ['month', 'الشهر'], ['3months', '3 أشهر'], ['all', 'الكل']];
const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');
const statusLabel = (status: string) => STATUS_CFG[status as keyof typeof STATUS_CFG]?.label || status;

function Bars({ rows, tone }: { rows: { name: string; value: number; extra?: string }[]; tone: string }) {
  const top = rows[0]?.value || 1;
  if (!rows.length) return <p className="py-4 text-center text-sm text-gray-400">لا توجد بيانات في الفترة دي</p>;
  return (
    <div className="space-y-2.5">
      {rows.map(row => (
        <div key={row.name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-gray-700">{row.name}</span>
            <span className="shrink-0 font-bold tabular-nums text-gray-900">{n(row.value)}{row.extra ? <span className="mr-1 text-xs font-normal text-gray-400">{row.extra}</span> : null}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100"><div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${Math.max(2, (row.value / top) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function SalesReportSection() {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<Breakdown | null>(null);
  const [failed, setFailed] = useState(false);
  const from = rangeStartDate(range);

  useEffect(() => {
    let live = true;
    setFailed(false);
    mysqlAdmin.adminGet<Breakdown>(`/admin/reports/sales-breakdown${from ? `?from=${from.slice(0, 10)}` : ''}`)
      .then(result => { if (live) setData(result); })
      .catch(() => { if (live) { setData(null); setFailed(true); } });
    return () => { live = false; };
  }, [from]);

  const view = useMemo(() => {
    const rows = data?.leads || [];
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    const count = (key: 'status' | 'source') => {
      const map = new Map<string, number>();
      rows.forEach(row => map.set(row[key], (map.get(row[key]) || 0) + row.n));
      return [...map].map(([name, value]) => ({ name: key === 'status' ? statusLabel(name) : name, value })).sort((a, b) => b.value - a.value);
    };
    const converted = rows.filter(row => row.status === 'converted').reduce((sum, row) => sum + row.n, 0);
    const revenue = data?.revenue || 0;
    return {
      total, revenue, converted,
      rate: total ? Math.round((converted / total) * 100) : 0,
      average: data && data.payments > 0 ? Math.round(revenue / data.payments) : 0,
      byStatus: count('status'), bySource: count('source').slice(0, 8),
    };
  }, [data]);

  const card = 'rounded-2xl border border-gray-200 bg-white p-5';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-gray-800">تقرير المبيعات</h3>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {RANGES.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setRange(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${range === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>{label}</button>
          ))}
        </div>
      </div>

      {failed && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">تعذر تحميل أرقام التقرير — جرّب تاني بعد شوية.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['إجمالي الليدات', n(view.total)], ['اتحولوا لعملاء', n(view.converted)], ['معدل التحويل', `${n(view.rate)}٪`], ['الإيراد المحصّل', `${n(view.revenue)} ج`],
        ].map(([label, value]) => (
          <div key={label} className={card}><div className="text-xl font-extrabold text-gray-900">{data ? value : '…'}</div><div className="text-xs text-gray-500">{label}</div></div>
        ))}
      </div>
      {view.average > 0 && <p className="text-xs text-gray-500">متوسط الدفعة {n(view.average)} ج على {n(data?.payments || 0)} دفعة.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}><h4 className="mb-3 text-sm font-bold text-gray-700">الليدات حسب الحالة</h4><Bars rows={view.byStatus} tone="bg-violet-400" /></div>
        <div className={card}><h4 className="mb-3 text-sm font-bold text-gray-700">الليدات حسب المصدر</h4><Bars rows={view.bySource} tone="bg-blue-400" /></div>
        <div className={card}><h4 className="mb-3 text-sm font-bold text-gray-700">الإيراد حسب الموظف (ج)</h4>
          <Bars rows={(data?.byStaff || []).map(row => ({ name: row.name, value: row.revenue, extra: `${n(row.payments)} دفعة` }))} tone="bg-emerald-400" /></div>
        <div className={card}><h4 className="mb-3 text-sm font-bold text-gray-700">الإيراد حسب الكورس (ج)</h4>
          <Bars rows={(data?.byItem || []).map(row => ({ name: row.name, value: row.revenue, extra: `${n(row.payments)} دفعة` }))} tone="bg-amber-400" /></div>
      </div>
    </div>
  );
}
