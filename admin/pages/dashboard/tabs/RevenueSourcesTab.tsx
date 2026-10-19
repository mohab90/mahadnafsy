import { useCallback, useMemo, useState } from 'react';
import { DollarSign, Tag, PieChart as PieIcon, BarChart3 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { numericTooltip } from '../../../lib/chartFormat';
import { cairoMonthStart } from '../../../../shared/cairoDate';
import { fxRates, toEgp } from '../../../lib/money';
import { useRevenueSources } from '../hooks/useAnalyticsHubFigures';
import { revenueSourceFigures } from '../analyticsHubFigures';

type Range = 'month' | '3months' | '6months' | 'all';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899'];

// Takes `range` instead of closing over it, matching MarketingHubTab and
// OnlineTeamTab. As a closure it was rebuilt every render, so the memos below
// could not list it as a dependency without recomputing every time.
function getRangeStart(range: Range): string {
  if (range === 'month') return cairoMonthStart(0);
  if (range === '3months') return cairoMonthStart(3);
  if (range === '6months') return cairoMonthStart(6);
  return '2000-01-01';
}

export default function RevenueSourcesTab() {
  const { courses, bundles, content } = useSiteData();
  const [range, setRange] = useState<Range>('month');

  // The orders are added up by the server (GET /api/admin/analytics-hub/revenue-sources) — every paid order and desk
  // payment, not the 500 newest the context held — and converted here at the institute's rates.
  const rates = useMemo(() => fxRates(content), [content]);
  const toEGP = useCallback((amount: number, currency: string) => toEgp(amount, currency, rates), [rates]);
  const data = useRevenueSources(getRangeStart(range));
  const {
    totalRevenue, orderCount, byLeadSource, byProductType, byCourse, topSources, monthlyBySource,
  } = useMemo(() => revenueSourceFigures(data, toEGP, ({ courseId, bundleId, type }) =>
    courses.find(c => c.id === courseId)?.title || bundles?.find((b: any) => b.id === bundleId)?.title || type || 'أخرى',
  ), [data, toEGP, courses, bundles]);

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(Math.round(n));

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
            {([['month','الشهر'], ['3months','3 أشهر'], ['6months','6 أشهر'], ['all','الكل']] as [Range,string][]).map(([k,l]) => (
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
          <div className="text-2xl font-extrabold text-blue-700">{orderCount}</div>
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
              <Tooltip formatter={numericTooltip(v => [`${fmtMoney(v)} ج`, ''])} />
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
                  <td className="px-4 py-3 font-bold text-emerald-700">{c.revenue.toLocaleString('ar-EG-u-nu-latn')} ج</td>
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
