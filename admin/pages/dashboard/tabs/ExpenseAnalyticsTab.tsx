import { useMemo, useState } from 'react';
import { DollarSign, TrendingDown, TrendingUp, PieChart as PieIcon, BarChart3 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

type Range = 'month' | '3months' | '6months' | 'all';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];

function getLast6Months() {
  const ms: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    ms.push(d.toISOString().slice(0, 7));
  }
  return ms;
}

export default function ExpenseAnalyticsTab() {
  const { expenses, orders } = useSiteData();
  const [range, setRange] = useState<Range>('month');
  const months = getLast6Months();

  function getRangeStart() {
    const d = new Date(); d.setDate(1);
    if (range === 'month') return d.toISOString().slice(0, 7) + '-01';
    if (range === '3months') { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); }
    if (range === '6months') { d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); }
    return '2000-01-01';
  }

  const filtered = useMemo(() => {
    const start = getRangeStart();
    return expenses.filter(e => (e.date || e.createdAt || '') >= start);
  }, [expenses, range]);

  const totalExpenses = useMemo(() => filtered.reduce((acc, e) => acc + (Number(e.amount) || 0), 0), [filtered]);
  const totalRevenue = useMemo(() => {
    const start = getRangeStart();
    return orders.filter(o => o.status === 'paid' && (o.createdAt || '') >= start)
                 .reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
  }, [orders, range]);
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

  // By category
  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(e => { const cat = e.category || 'أخرى'; map[cat] = (map[cat] || 0) + (Number(e.amount) || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Monthly trend
  const monthlyData = useMemo(() =>
    months.map(m => ({
      month: m.slice(5),
      مصروفات: expenses.filter(e => (e.date || e.createdAt || '').slice(0, 7) === m)
                       .reduce((acc, e) => acc + (Number(e.amount) || 0), 0),
      إيراد: orders.filter(o => o.status === 'paid' && (o.createdAt || '').slice(0, 7) === m)
                   .reduce((acc, o) => acc + (Number(o.amount) || 0), 0),
    })),
    [expenses, orders, months]
  );

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : n.toLocaleString();

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-red-600 to-rose-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><TrendingDown size={22} />تحليل المصروفات</h2>
            <p className="text-red-100 text-sm mt-1">تتبع المصروفات، الإيرادات، وصافي الربح</p>
          </div>
          <div className="flex gap-1 bg-white/10 rounded-xl p-1">
            {([['month','الشهر'], ['3months','٣ أشهر'], ['6months','٦ أشهر'], ['all','الكل']] as [Range,string][]).map(([k,l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${range === k ? 'bg-white text-red-700' : 'text-white hover:bg-white/20'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المصروفات', val: `${fmtMoney(totalExpenses)} ج`, color: 'red', icon: TrendingDown },
          { label: 'إجمالي الإيرادات', val: `${fmtMoney(totalRevenue)} ج`, color: 'emerald', icon: TrendingUp },
          { label: 'صافي الربح', val: `${netProfit >= 0 ? '+' : ''}${fmtMoney(netProfit)} ج`, color: netProfit >= 0 ? 'blue' : 'red', icon: DollarSign },
          { label: 'هامش الربح', val: `${profitMargin}%`, color: profitMargin >= 30 ? 'emerald' : profitMargin >= 0 ? 'amber' : 'red', icon: BarChart3 },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 flex items-center gap-3`}>
              <div className={`w-10 h-10 rounded-xl bg-${k.color}-100 flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={`text-${k.color}-600`} />
              </div>
              <div>
                <div className="text-lg font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500">{k.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Category pie */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><PieIcon size={16} className="text-red-500" />المصروفات حسب الفئة</h3>
          {byCategory.length === 0 ? (
            <div className="py-8 text-center text-gray-400">لا توجد مصروفات في هذه الفترة</div>
          ) : (
            <div className="flex gap-4 items-center">
              <PieChart width={150} height={150}>
                <Pie data={byCategory} cx={70} cy={70} outerRadius={60} dataKey="value" nameKey="name">
                  {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
              </PieChart>
              <div className="flex-1 space-y-2">
                {byCategory.slice(0, 6).map((c, i) => (
                  <div key={c.name} className="flex items-center gap-2 text-sm">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-gray-700 flex-1 truncate">{c.name}</span>
                    <span className="font-bold text-gray-900">{fmtMoney(c.value)} ج</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Monthly chart */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-rose-500" />الإيراد مقابل المصروفات</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtMoney(v)} />
              <Tooltip formatter={(v: number) => [`${fmtMoney(v)} ج`, '']} />
              <Legend />
              <Bar dataKey="إيراد" fill="#10b981" radius={[4,4,0,0]} />
              <Bar dataKey="مصروفات" fill="#f87171" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Expenses table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">سجل المصروفات</h3>
          <span className="text-xs text-gray-400">{filtered.length} عنصر</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الوصف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الفئة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">المبلغ</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.slice(0, 30).map((e, i) => (
                <tr key={e.id || i} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-semibold text-gray-800">{e.description || e.title || '—'}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-lg text-xs">{e.category || 'أخرى'}</span></td>
                  <td className="px-4 py-3 font-bold text-red-600">{Number(e.amount).toLocaleString()} ج</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{(e.date || e.createdAt || '').slice(0, 10)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">لا توجد مصروفات في هذه الفترة</td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > 30 && (
            <div className="p-3 text-center text-xs text-gray-400">عرض أول 30 سجل من {filtered.length}</div>
          )}
        </div>
      </div>
    </div>
  );
}
