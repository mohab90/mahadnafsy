import { useMemo, useState } from 'react';
import { DollarSign, Tag, PieChart as PieIcon, BarChart3 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

type Range = 'month' | '3months' | '6months' | 'all';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899'];

function getLast6Months() {
  const ms: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    ms.push(d.toISOString().slice(0, 7));
  }
  return ms;
}

// Takes `range` instead of closing over it, matching MarketingHubTab and
// OnlineTeamTab. As a closure it was rebuilt every render, so the memos below
// could not list it as a dependency without recomputing every time.
function getRangeStart(range: Range): string {
  const d = new Date(); d.setDate(1);
  if (range === 'month') return d.toISOString().slice(0, 7) + '-01';
  if (range === '3months') { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); }
  if (range === '6months') { d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); }
  return '2000-01-01';
}

export default function RevenueSourcesTab() {
  const { orders, leads, courses, bundles } = useSiteData();
  const [range, setRange] = useState<Range>('month');
  const months = getLast6Months();

  const filteredOrders = useMemo(() => {
    const start = getRangeStart(range);
    return orders.filter(o => o.status === 'paid' && (o.createdAt || '') >= start);
  }, [orders, range]);

  const totalRevenue = useMemo(() => filteredOrders.reduce((acc, o) => acc + (Number(o.amount) || 0), 0), [filteredOrders]);

  // By lead source
  const byLeadSource = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach(o => {
      const lead = leads.find(l => l.id === o.leadId);
      const source = lead?.source || o.source || 'مباشر';
      map[source] = (map[source] || 0) + (Number(o.amount) || 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredOrders, leads]);

  // By product type (course vs bundle vs consultation)
  const byProductType = useMemo(() => {
    const map: Record<string, number> = { 'كورس': 0, 'باندل': 0, 'استشارة': 0, 'أخرى': 0 };
    filteredOrders.forEach(o => {
      if (o.bundleId) map['باندل'] += Number(o.amount) || 0;
      else if (o.courseId) map['كورس'] += Number(o.amount) || 0;
      else if (o.type === 'consultation') map['استشارة'] += Number(o.amount) || 0;
      else map['أخرى'] += Number(o.amount) || 0;
    });
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [filteredOrders]);

  // By course
  const byCourse = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; count: number }> = {};
    filteredOrders.forEach(o => {
      const key = o.courseId || o.bundleId || o.type || 'other';
      const c = courses.find(c => c.id === o.courseId);
      const b = bundles?.find((b: any) => b.id === o.bundleId);
      const name = c?.title || b?.title || o.courseName || o.type || 'أخرى';
      if (!map[key]) map[key] = { name, revenue: 0, count: 0 };
      map[key].revenue += Number(o.amount) || 0;
      map[key].count++;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [filteredOrders, courses, bundles]);

  // Monthly trend by source
  const monthlyBySource = useMemo(() => {
    const topSources = byLeadSource.slice(0, 3).map(s => s.name);
    return months.map(m => {
      const mo = orders.filter(o => o.status === 'paid' && (o.createdAt || '').slice(0, 7) === m);
      const entry: Record<string, any> = { month: m.slice(5) };
      topSources.forEach(src => {
        entry[src] = mo.filter(o => {
          const lead = leads.find(l => l.id === o.leadId);
          return (lead?.source || o.source || 'مباشر') === src;
        }).reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
      });
      return entry;
    });
  }, [orders, leads, months, byLeadSource]);

  const topSources = byLeadSource.slice(0, 3).map(s => s.name);
  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-emerald-600 to-teal-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><DollarSign size={22} />مصادر الإيراد</h2>
            <p className="text-emerald-100 text-sm mt-1">تحليل مصادر الدخل حسب القناة والمنتج</p>
          </div>
          <div className="flex gap-1 bg-white/10 rounded-xl p-1">
            {([['month','الشهر'], ['3months','٣ أشهر'], ['6months','٦ أشهر'], ['all','الكل']] as [Range,string][]).map(([k,l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${range === k ? 'bg-white text-emerald-700' : 'text-white hover:bg-white/20'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-emerald-700">{fmtMoney(totalRevenue)} ج</div>
          <div className="text-xs text-gray-500 mt-1">إجمالي الإيراد</div>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-blue-700">{filteredOrders.length}</div>
          <div className="text-xs text-gray-500 mt-1">إجمالي الطلبات</div>
        </div>
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-violet-700">{byLeadSource.length}</div>
          <div className="text-xs text-gray-500 mt-1">مصادر مختلفة</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* By source pie */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><PieIcon size={16} className="text-emerald-500" />الإيراد حسب المصدر</h3>
          {byLeadSource.length === 0 ? (
            <div className="py-8 text-center text-gray-400">لا توجد بيانات</div>
          ) : (
            <div className="flex gap-4 items-center">
              <PieChart width={150} height={150}>
                <Pie data={byLeadSource} cx={70} cy={70} outerRadius={60} dataKey="value" nameKey="name">
                  {byLeadSource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
              </PieChart>
              <div className="flex-1 space-y-2">
                {byLeadSource.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-gray-700 flex-1 truncate">{s.name}</span>
                    <span className="font-bold text-gray-900">{fmtMoney(s.value)} ج</span>
                    <span className="text-xs text-gray-400">{totalRevenue > 0 ? Math.round((s.value / totalRevenue) * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* By product type */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Tag size={16} className="text-teal-500" />الإيراد حسب نوع المنتج</h3>
          <div className="space-y-3">
            {byProductType.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                  style={{ background: `${COLORS[i % COLORS.length]}20`, color: COLORS[i % COLORS.length] }}>
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-800">{p.name}</span>
                    <span className="text-sm font-bold text-gray-900">{fmtMoney(p.value)} ج</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div className="h-1.5 rounded-full" style={{ width: `${(p.value / totalRevenue) * 100}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              </div>
            ))}
            {byProductType.length === 0 && <p className="text-center text-gray-400 text-sm py-4">لا توجد بيانات</p>}
          </div>
        </div>
      </div>

      {/* Monthly by source */}
      {topSources.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-emerald-500" />الإيراد الشهري حسب المصدر — آخر 6 أشهر</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyBySource}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtMoney(v)} />
              <Tooltip formatter={(v: unknown) => [`${fmtMoney(Number(v))} ج`, '']} />
              <Legend />
              {topSources.map((src, i) => (
                <Bar key={src} dataKey={src} fill={COLORS[i % COLORS.length]} radius={[4,4,0,0]} stackId="a" />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* By course table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">🎓 الإيراد حسب المنتج</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">المنتج</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الطلبات</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الإيراد</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">النسبة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {byCourse.map(c => (
                <tr key={c.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800 truncate max-w-[200px]">{c.name}</td>
                  <td className="px-4 py-3 font-bold text-blue-700">{c.count}</td>
                  <td className="px-4 py-3 font-bold text-emerald-700">{c.revenue.toLocaleString()} ج</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                        <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${totalRevenue > 0 ? (c.revenue / totalRevenue) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {byCourse.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">لا توجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
