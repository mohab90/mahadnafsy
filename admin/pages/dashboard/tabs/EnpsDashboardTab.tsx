import React, { useEffect, useState } from 'react';
import { Smile, Meh, Frown, Users, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type EnpsData = {
  enps: number | null;
  total: number;
  avg: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  comments: { score: number; comment: string; period: string; created_at: string }[];
  periods: string[];
};

// Employee Net Promoter Score — staff satisfaction. Individual responses are
// anonymized by design (the API returns aggregates + comments only).
export default function EnpsDashboardTab({ notify }: { notify: NotifyFn }) {
  const [data, setData] = useState<EnpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>('all');

  const load = React.useCallback(() => {
    setLoading(true);
    const path = period === 'all' ? '/admin/hr/enps' : `/admin/hr/enps?period=${period}`;
    mysqlAdmin.adminGet<EnpsData>(path)
      .then(res => setData(res))
      .catch(() => notify('error', 'تعذر تحميل بيانات eNPS'))
      .finally(() => setLoading(false));
  }, [period, notify]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  }
  if (!data) return null;

  const scoreColor = data.enps === null ? 'text-gray-400'
    : data.enps >= 30 ? 'text-emerald-600' : data.enps >= 0 ? 'text-amber-500' : 'text-red-500';
  const pct = (n: number) => data.total > 0 ? Math.round((n / data.total) * 100) : 0;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">رضا الموظفين (eNPS)</h2>
          <p className="text-xs text-gray-500">استبيان مجهول — يعرض النتائج المجمّعة فقط دون هوية الموظف</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="all">كل الفترات</option>
            {data.periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={load} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50" title="تحديث"><RefreshCw size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <div className={`text-4xl font-black ${scoreColor}`}>{data.enps === null ? '—' : data.enps}</div>
          <div className="text-xs text-gray-500 mt-1">مؤشر eNPS</div>
          <div className="text-[10px] text-gray-400 mt-0.5">(المروّجون − المنتقدون)</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <div className="flex items-center justify-center gap-1 text-emerald-600"><Smile size={20} /><span className="text-2xl font-bold">{data.promoters}</span></div>
          <div className="text-xs text-gray-500 mt-1">مروّجون (9-10)</div>
          <div className="text-[10px] text-gray-400">{pct(data.promoters)}%</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <div className="flex items-center justify-center gap-1 text-amber-500"><Meh size={20} /><span className="text-2xl font-bold">{data.passives}</span></div>
          <div className="text-xs text-gray-500 mt-1">محايدون (7-8)</div>
          <div className="text-[10px] text-gray-400">{pct(data.passives)}%</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <div className="flex items-center justify-center gap-1 text-red-500"><Frown size={20} /><span className="text-2xl font-bold">{data.detractors}</span></div>
          <div className="text-xs text-gray-500 mt-1">منتقدون (0-6)</div>
          <div className="text-[10px] text-gray-400">{pct(data.detractors)}%</div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
        <Users size={18} className="text-indigo-500" />
        <span className="text-sm text-gray-600">إجمالي الردود: <strong className="text-gray-900">{data.total}</strong></span>
        {data.avg !== null && <span className="text-sm text-gray-600">متوسط الدرجة: <strong className="text-gray-900">{data.avg}/10</strong></span>}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <h3 className="font-bold text-gray-800 text-sm mb-3">ملاحظات الموظفين (مجهولة)</h3>
        {data.comments.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">لا توجد ملاحظات مكتوبة بعد</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.comments.map((c, i) => (
              <div key={i} className="border border-gray-100 rounded-xl px-3 py-2 flex items-start gap-3">
                <span className={`flex-shrink-0 w-8 h-8 rounded-full grid place-items-center text-sm font-bold ${c.score >= 9 ? 'bg-emerald-50 text-emerald-600' : c.score >= 7 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>{c.score}</span>
                <div className="min-w-0">
                  <p className="text-sm text-gray-700">{c.comment}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{c.period}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
