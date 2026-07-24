import { useMemo, useState } from 'react';
import { BookOpen, Users, DollarSign, BarChart3, Star } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

type Range = 'month' | '3months' | '6months' | 'all';

const STATUS_LABEL: Record<string, string> = {
  active: 'نشط', finished: 'منتهي', paused: 'متوقف', refunded: 'مسترد', leads: 'ليد',
};

function getLastNMonths(n: number) {
  const ms: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    ms.push(d.toISOString().slice(0, 7));
  }
  return ms;
}

// Chart month range now follows the same `range` filter as the KPI cards
// below (PAY-18) — it was previously hardcoded to always show 6 months
// regardless of the selected range.
function getMonthsForRange(range: Range, earliestMonth: string) {
  if (range === 'month') return getLastNMonths(1);
  if (range === '3months') return getLastNMonths(3);
  if (range === '6months') return getLastNMonths(6);
  // 'all' — from the earliest subscriber's signup month through the current month
  const thisMonth = new Date().toISOString().slice(0, 7);
  const start = earliestMonth && earliestMonth < thisMonth ? earliestMonth : thisMonth;
  const ms: string[] = [];
  const cursor = new Date(`${start}-01T00:00:00`);
  const end = new Date(`${thisMonth}-01T00:00:00`);
  while (cursor <= end) {
    ms.push(cursor.toISOString().slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ms;
}

export default function SubscriptionsTab() {
  const { subscribers, courses } = useSiteData();
  const [range, setRange] = useState<Range>('6months');
  const [statusFilter, setStatusFilter] = useState('all');
  const earliestMonth = useMemo(() => subscribers.reduce((min, s) => {
    const m = (s.createdAt || '').slice(0, 7);
    return m && (!min || m < min) ? m : min;
  }, ''), [subscribers]);
  const months = useMemo(() => getMonthsForRange(range, earliestMonth), [range, earliestMonth]);

  const getRangeStart = () => {
    const d = new Date(); d.setDate(1);
    if (range === 'month') { return d.toISOString().slice(0, 7) + '-01'; }
    if (range === '3months') { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); }
    if (range === '6months') { d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); }
    return '2000-01-01';
  };

  const filtered = useMemo(() => {
    const start = getRangeStart();
    return subscribers.filter(s =>
      (statusFilter === 'all' || s.clientStatus === statusFilter) &&
      (s.createdAt || '') >= start
    );
  }, [subscribers, statusFilter, range]);

  // Monthly subscriptions
  const monthlyData = useMemo(() =>
    months.map(m => ({
      month: m.slice(5),
      اشتراكات: subscribers.filter(s => (s.createdAt || '').slice(0, 7) === m).length,
      إيراد: subscribers.filter(s => (s.createdAt || '').slice(0, 7) === m)
                        .reduce((acc, s) => acc + (Number(s.totalPaid) || 0), 0),
    })),
    [subscribers, months]
  );

  // Course enrollment breakdown
  const courseBreakdown = useMemo(() => {
    const map: Record<string, { name: string; count: number; revenue: number }> = {};
    subscribers.forEach(s => {
      const ids = s.enrolledCourseIds || [];
      ids.forEach((cid: string) => {
        const c = courses.find(c => c.id === cid);
        if (!map[cid]) map[cid] = { name: c?.title || cid, count: 0, revenue: 0 };
        map[cid].count++;
        map[cid].revenue += Number(s.totalPaid) || 0;
      });
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [subscribers, courses]);

  const totalRevenue = useMemo(() => filtered.reduce((acc, s) => acc + (Number(s.totalPaid) || 0), 0), [filtered]);
  const avgRevenue = filtered.length > 0 ? Math.round(totalRevenue / filtered.length) : 0;
  const activeCount = filtered.filter(s => s.clientStatus === 'active' || !s.clientStatus).length;

  const statusOptions = ['all', 'active', 'finished', 'paused', 'refunded', 'leads'];

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-blue-600 to-sky-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><BookOpen size={22} />تحليل الاشتراكات</h2>
            <p className="text-blue-100 text-sm mt-1">نظرة تفصيلية على الاشتراكات والإيرادات</p>
          </div>
          <div className="flex gap-1 bg-white/10 rounded-xl p-1">
            {([['month','الشهر'], ['3months','٣ أشهر'], ['6months','٦ أشهر'], ['all','الكل']] as [Range,string][]).map(([k,l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${range === k ? 'bg-white text-blue-700' : 'text-white hover:bg-white/20'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 flex gap-2 flex-wrap">
        {statusOptions.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === 'all' ? `الكل (${subscribers.length})` : `${STATUS_LABEL[s] || s} (${subscribers.filter(sub => sub.clientStatus === s).length})`}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'الاشتراكات', val: filtered.length, color: 'blue', icon: Users },
          { label: 'النشطون', val: activeCount, color: 'emerald', icon: Star },
          { label: 'إجمالي الإيراد', val: `${(totalRevenue / 1000).toFixed(1)}ك ج`, color: 'violet', icon: DollarSign },
          { label: 'متوسط الاشتراك', val: `${avgRevenue.toLocaleString()} ج`, color: 'amber', icon: BarChart3 },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 flex items-center gap-3`}>
              <div className={`w-10 h-10 rounded-xl bg-${k.color}-100 flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={`text-${k.color}-600`} />
              </div>
              <div>
                <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500">{k.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Monthly chart */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-4">📈 الاشتراكات الشهرية — آخر 6 أشهر</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="subs" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="rev" orientation="left" hide />
            <Tooltip />
            <Bar yAxisId="subs" dataKey="اشتراكات" fill="#3b82f6" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Course breakdown */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">🎓 توزيع الاشتراكات حسب الكورس</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الكورس</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">عدد المشتركين</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الإيراد</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">النسبة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {courseBreakdown.map(c => (
                <tr key={c.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800 truncate max-w-[200px]">{c.name}</td>
                  <td className="px-4 py-3 font-bold text-blue-700">{c.count}</td>
                  <td className="px-4 py-3 font-bold text-emerald-700">{c.revenue.toLocaleString()} ج</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                        <div className="h-1.5 rounded-full bg-blue-400"
                          style={{ width: `${(c.count / (courseBreakdown[0]?.count || 1)) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{subscribers.length > 0 ? Math.round((c.count / subscribers.length) * 100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {courseBreakdown.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">لا توجد اشتراكات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
