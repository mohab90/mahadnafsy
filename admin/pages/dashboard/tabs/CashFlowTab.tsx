import React, { useMemo, useState } from 'react';
import { Droplets, TrendingUp, ArrowDownRight, BarChart3 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const CashFlowTab: React.FC<Props> = () => {
  const { orders, expenses } = useSiteData();
  const [monthsCount, setMonthsCount] = useState(6);
  const [viewType, setViewType] = useState<'chart' | 'table'>('chart');

  const { months, cumulative, ytd } = useMemo(() => {
    const now = new Date();
    const data = Array.from({ length: monthsCount }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1 - i), 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const inflow = orders
        .filter(o => o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) <= end)
        .reduce((s, o) => s + o.amount, 0);

      const outflow = expenses
        .filter(e => e.date >= start && e.date <= end)
        .reduce((s, e) => s + e.amount, 0);

      const netCash = inflow - outflow;
      return { label: `${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`, shortLabel: MONTHS_AR[d.getMonth()].slice(0, 3), inflow, outflow, netCash, month: d.getMonth(), year: d.getFullYear() };
    });

    // Cumulative
    let cum = 0;
    const withCum = data.map(d => {
      cum += d.netCash;
      return { ...d, cumulative: cum };
    });

    // YTD
    const ytdData = {
      inflow: data.filter(d => d.year === now.getFullYear()).reduce((s, d) => s + d.inflow, 0),
      outflow: data.filter(d => d.year === now.getFullYear()).reduce((s, d) => s + d.outflow, 0),
      net: 0,
    };
    ytdData.net = ytdData.inflow - ytdData.outflow;

    return { months: withCum, cumulative: cum, ytd: ytdData };
  }, [orders, expenses, monthsCount]);

  const maxValue = Math.max(...months.map(m => Math.max(m.inflow, m.outflow)), 1);
  const format = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

  // Expense breakdown for the period
  const expenseBreakdown = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsCount);
    const filtered = expenses.filter(e => e.date >= cutoff.toISOString());
    const cats: Record<string, number> = {};
    filtered.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]);
  }, [expenses, monthsCount]);

  const totalInflow = months.reduce((s, m) => s + m.inflow, 0);
  const totalOutflow = months.reduce((s, m) => s + m.outflow, 0);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-blue-700 to-cyan-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Droplets size={22} /> قائمة التدفق النقدي</h2>
            <p className="text-blue-200 text-sm mt-0.5">التدفقات النقدية الداخلة والخارجة</p>
          </div>
          <select value={monthsCount} onChange={e => setMonthsCount(+e.target.value)}
            className="bg-white/15 border border-white/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none hover:bg-white/25">
            <option value={3}>3 أشهر</option>
            <option value={6}>6 أشهر</option>
            <option value={12}>12 شهر</option>
          </select>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'إجمالي الداخل', value: totalInflow, icon: '📥', bg: 'bg-green-500/25' },
            { label: 'إجمالي الخارج', value: totalOutflow, icon: '📤', bg: 'bg-red-500/25' },
            { label: 'صافي التدفق', value: totalInflow - totalOutflow, icon: '💰', bg: (totalInflow - totalOutflow) >= 0 ? 'bg-green-500/25' : 'bg-red-500/25' },
            { label: 'رصيد تراكمي', value: cumulative, icon: '📊', bg: 'bg-white/15' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-base font-black leading-tight">{format(s.value)} ج.م</div>
              <div className="text-xs text-blue-200 mt-0.5">{s.icon} {s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        {([['chart', '📊 مخطط بياني'], ['table', '📋 جدول تفصيلي']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setViewType(k)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${viewType === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {viewType === 'chart' && (
        <div className="space-y-5">
          {/* Inflow vs Outflow Chart */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-blue-500" /> الداخل مقابل الخارج</h3>
            <div className="flex items-end gap-2" style={{ height: 180 }}>
              {months.map((m, i) => {
                const inflowH = (m.inflow / maxValue) * 100;
                const outflowH = (m.outflow / maxValue) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                    <div className="absolute bottom-8 opacity-0 group-hover:opacity-100 bg-gray-800 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap z-10 transition-opacity pointer-events-none">
                      داخل: {format(m.inflow)}<br />خارج: {format(m.outflow)}<br />صافي: {format(m.netCash)}
                    </div>
                    <div className="flex gap-0.5 w-full items-end" style={{ height: 160 }}>
                      <div className="flex-1 rounded-t bg-green-400 transition-all" style={{ height: `${Math.max(inflowH, 1)}%` }} />
                      <div className="flex-1 rounded-t bg-red-400 transition-all" style={{ height: `${Math.max(outflowH, 1)}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{m.shortLabel}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-2 justify-center text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded" /> تدفق داخل</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded" /> تدفق خارج</span>
            </div>
          </div>

          {/* Net Cash Flow Chart */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> صافي التدفق النقدي الشهري</h3>
            <div className="flex items-center gap-2 mb-2">
              {months.map((m, i) => {
                const positive = m.netCash >= 0;
                const maxNet = Math.max(...months.map(n => Math.abs(n.netCash)), 1);
                const h = Math.abs(m.netCash) / maxNet * 60;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    {!positive && <div className="w-full rounded-b" style={{ height: h, background: '#ef4444', minHeight: 2 }} />}
                    <div className="text-[10px] font-bold" style={{ color: positive ? '#22c55e' : '#ef4444' }}>
                      {format(m.netCash)}
                    </div>
                    {positive && <div className="w-full rounded-t" style={{ height: h, background: '#22c55e', minHeight: 2 }} />}
                    <span className="text-[10px] text-gray-400">{m.shortLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Expense Breakdown */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><ArrowDownRight size={16} className="text-red-500" /> توزيع المصروفات</h3>
            {expenseBreakdown.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">لا مصروفات</p>
            ) : expenseBreakdown.map(([cat, amt]) => {
              const maxExp = expenseBreakdown[0][1];
              return (
                <div key={cat} className="flex items-center gap-3 mb-3">
                  <span className="text-sm text-gray-600 w-20 shrink-0">{cat}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.round(amt / maxExp * 100)}%` }} />
                  </div>
                  <span className="text-sm font-bold text-gray-700 w-20 text-right">{format(amt)} ج.م</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewType === 'table' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-right px-4 py-3 font-bold text-gray-700">الشهر</th>
                <th className="text-right px-4 py-3 font-bold text-green-700">📥 داخل</th>
                <th className="text-right px-4 py-3 font-bold text-red-700">📤 خارج</th>
                <th className="text-right px-4 py-3 font-bold text-gray-700">صافي</th>
                <th className="text-right px-4 py-3 font-bold text-gray-700">تراكمي</th>
                <th className="text-right px-4 py-3 font-bold text-gray-700">هامش</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {months.map((m, i) => {
                const net = m.netCash;
                const margin = m.inflow > 0 ? Math.round(net / m.inflow * 100) : 0;
                return (
                  <tr key={i} className={`hover:bg-gray-50 ${net < 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{m.label}</td>
                    <td className="px-4 py-3 text-green-700 font-bold">{format(m.inflow)}</td>
                    <td className="px-4 py-3 text-red-600 font-bold">{format(m.outflow)}</td>
                    <td className={`px-4 py-3 font-black ${net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {net >= 0 ? '+' : ''}{format(net)}
                    </td>
                    <td className={`px-4 py-3 font-bold ${m.cumulative >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{format(m.cumulative)}</td>
                    <td className={`px-4 py-3 font-bold ${margin >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{margin}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-black">
                <td className="px-4 py-3 text-gray-800">الإجمالي</td>
                <td className="px-4 py-3 text-green-700">{format(totalInflow)}</td>
                <td className="px-4 py-3 text-red-600">{format(totalOutflow)}</td>
                <td className={`px-4 py-3 ${(totalInflow - totalOutflow) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{format(totalInflow - totalOutflow)}</td>
                <td className="px-4 py-3 text-blue-700">{format(cumulative)}</td>
                <td className="px-4 py-3">{totalInflow > 0 ? Math.round((totalInflow - totalOutflow) / totalInflow * 100) : 0}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* YTD Summary */}
      <div className="bg-gradient-to-l from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-4">
        <h3 className="font-bold text-indigo-800 mb-3">📅 ملخص العام الحالي (YTD)</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <div className="text-green-700 font-black text-lg">{format(ytd.inflow)}</div>
            <div className="text-xs text-gray-500">إجمالي الداخل</div>
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <div className="text-red-600 font-black text-lg">{format(ytd.outflow)}</div>
            <div className="text-xs text-gray-500">إجمالي الخارج</div>
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <div className={`font-black text-lg ${ytd.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{format(ytd.net)}</div>
            <div className="text-xs text-gray-500">صافي التدفق</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashFlowTab;
