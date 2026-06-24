import React, { useMemo, useState } from 'react';
import { TrendingUp, BarChart3, Calendar, DollarSign, Star, Target, ArrowUpRight, Info, AlertTriangle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const RevenueForecastTab: React.FC<Props> = ({ notify }) => {
  const { orders, leads, subscribers } = useSiteData();
  const [forecastMonths, setForecastMonths] = useState(3);
  const [growthRate, setGrowthRate] = useState(5); // % per month

  const now = new Date();

  const historicalMonths = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const rev = orders.filter(o => o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) <= end)
        .reduce((s, o) => s + o.amount, 0);
      return { label: MONTHS_AR[d.getMonth()], shortLabel: MONTHS_AR[d.getMonth()].slice(0, 3), month: d.getMonth(), year: d.getFullYear(), revenue: rev, isForecast: false };
    });
  }, [orders]);

  const { forecastData, avgRevenue, trendRate, pipeline } = useMemo(() => {
    // Average of last 3 months
    const last3 = historicalMonths.slice(-3).map(m => m.revenue);
    const avg = last3.reduce((s, v) => s + v, 0) / 3;

    // Trend: growth rate from first 3 to last 3
    const first3Avg = historicalMonths.slice(0, 3).reduce((s, m) => s + m.revenue, 0) / 3;
    const last3Avg = historicalMonths.slice(-3).reduce((s, m) => s + m.revenue, 0) / 3;
    const trend = first3Avg > 0 ? ((last3Avg - first3Avg) / first3Avg) / 3 * 100 : 0; // monthly %

    // Pipeline value from leads
    const hotLeads = leads.filter(l => l.status === 'interested' || l.status === 'interested_booking' || l.status === 'interested_followup');
    const pipelineValue = hotLeads.reduce((s, l) => s + (l.dealValue || 2000), 0);

    // Forecast months
    const forecast = Array.from({ length: forecastMonths }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1);
      const projectedBase = avg * Math.pow(1 + growthRate / 100, i + 1);
      const optimistic = projectedBase * 1.2;
      const pessimistic = projectedBase * 0.8;
      return {
        label: MONTHS_AR[d.getMonth()],
        shortLabel: MONTHS_AR[d.getMonth()].slice(0, 3),
        revenue: projectedBase,
        optimistic,
        pessimistic,
        isForecast: true,
        month: d.getMonth(),
        year: d.getFullYear(),
      };
    });

    return { forecastData: forecast, avgRevenue: avg, trendRate: trend, pipeline: pipelineValue };
  }, [historicalMonths, leads, forecastMonths, growthRate]);

  const allData = [...historicalMonths, ...forecastData];
  const maxValue = Math.max(...allData.map(d => d.isForecast ? (d as any).optimistic : d.revenue), 1);

  const format = (n: number) => Math.round(n).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });

  const totalForecast = forecastData.reduce((s, d) => s + d.revenue, 0);
  const totalHistorical = historicalMonths.reduce((s, d) => s + d.revenue, 0);
  const ytdRevenue = orders.filter(o => o.status === 'paid' && (o.paidAt || o.createdAt) >= `${now.getFullYear()}-01-01`).reduce((s, o) => s + o.amount, 0);

  // Revenue by source (from leads → orders)
  const sourceBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    orders.filter(o => o.status === 'paid').slice(-100).forEach(o => {
      const lead = leads.find(l => l.email === o.customerEmail);
      const src = lead?.source || 'مباشر';
      map[src] = (map[src] || 0) + o.amount;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [orders, leads]);

  const maxSource = sourceBreakdown[0]?.[1] || 1;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-indigo-700 to-blue-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><TrendingUp size={22} /> توقعات الإيرادات</h2>
            <p className="text-blue-200 text-sm mt-0.5">تحليل الاتجاهات وتوقعات الأشهر القادمة</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'متوسط الإيرادات الشهرية', value: `${format(avgRevenue)} ج.م`, bg: 'bg-white/15' },
            { label: 'إيرادات العام الحالي', value: `${format(ytdRevenue)} ج.م`, bg: 'bg-green-500/25' },
            { label: 'توقع الأشهر القادمة', value: `${format(totalForecast)} ج.م`, bg: 'bg-white/15' },
            { label: 'قيمة خط الأنابيب', value: `${format(pipeline)} ج.م`, bg: 'bg-amber-500/25' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-base font-black leading-tight">{s.value}</div>
              <div className="text-xs text-blue-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-center bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">أشهر التوقع:</label>
          {[1, 3, 6].map(m => (
            <button key={m} onClick={() => setForecastMonths(m)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${forecastMonths === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
              {m} شهر
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">معدل النمو المتوقع:</label>
          <div className="flex items-center gap-2">
            <input type="range" min={-10} max={30} step={1} value={growthRate} onChange={e => setGrowthRate(+e.target.value)}
              className="w-32 accent-indigo-600" />
            <span className={`text-sm font-black w-12 text-center ${growthRate >= 0 ? 'text-green-600' : 'text-red-600'}`}>{growthRate >= 0 ? '+' : ''}{growthRate}%</span>
          </div>
        </div>
        {trendRate !== 0 && (
          <div className="mr-auto text-sm flex items-center gap-1.5">
            <span className="text-gray-500">الاتجاه الفعلي:</span>
            <span className={`font-bold flex items-center gap-1 ${trendRate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trendRate >= 0 ? <ArrowUpRight size={14} /> : null}
              {trendRate >= 0 ? '+' : ''}{trendRate.toFixed(1)}% شهرياً
            </span>
          </div>
        )}
      </div>

      {/* Main Chart */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <BarChart3 size={16} className="text-indigo-500" /> الإيرادات التاريخية والتوقعات
        </h3>
        <div className="flex items-end gap-2 mb-4" style={{ height: 200 }}>
          {allData.map((d, i) => {
            const isForecast = d.isForecast;
            const h = (d.revenue / maxValue) * 100;
            const optH = isForecast ? ((d as any).optimistic / maxValue) * 100 : null;
            const pesH = isForecast ? ((d as any).pessimistic / maxValue) * 100 : null;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                {/* Tooltip */}
                <div className="absolute bottom-10 opacity-0 group-hover:opacity-100 bg-gray-800 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap z-10 transition-opacity pointer-events-none text-center">
                  {isForecast ? (
                    <>توقع: {format(d.revenue)}<br />محتمل: {format((d as any).optimistic)}<br />محافظ: {format((d as any).pessimistic)}</>
                  ) : format(d.revenue)}
                </div>
                {/* Optimistic range */}
                {isForecast && optH !== null && pesH !== null && (
                  <div className="w-full relative" style={{ height: `${optH}%`, minHeight: 2 }}>
                    <div className="absolute inset-0 rounded-t bg-indigo-100/60 border border-dashed border-indigo-300" />
                    <div className="absolute bottom-0 w-full rounded-t bg-indigo-400/70" style={{ height: `${(h / optH) * 100}%` }} />
                  </div>
                )}
                {!isForecast && (
                  <div className="w-full rounded-t bg-indigo-600 transition-all" style={{ height: `${Math.max(h, 1)}%`, minHeight: 2 }} />
                )}
                <span className={`text-[10px] whitespace-nowrap ${isForecast ? 'text-indigo-500 font-bold' : 'text-gray-400'}`}>{d.shortLabel}</span>
                {isForecast && <span className="text-[9px] text-indigo-300">توقع</span>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 justify-center text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-600 rounded" /> إيرادات فعلية</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-300 rounded border border-dashed border-indigo-400" /> توقعات</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Forecast table */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="font-bold text-gray-800">توقعات الأشهر القادمة</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-right px-4 py-2 text-gray-600 font-medium">الشهر</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">محافظ</th>
                <th className="text-right px-4 py-2 text-indigo-600 font-bold">المتوقع</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">متفائل</th>
              </tr>
            </thead>
            <tbody>
              {forecastData.map((d, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-indigo-50/30">
                  <td className="px-4 py-2 font-medium text-gray-700">{d.label} {d.year}</td>
                  <td className="px-4 py-2 text-gray-500">{format(d.pessimistic)}</td>
                  <td className="px-4 py-2 text-indigo-700 font-black">{format(d.revenue)}</td>
                  <td className="px-4 py-2 text-green-700 font-bold">{format(d.optimistic)}</td>
                </tr>
              ))}
              <tr className="bg-indigo-50 border-t-2 border-indigo-200 font-black">
                <td className="px-4 py-2 text-indigo-800">الإجمالي</td>
                <td className="px-4 py-2 text-gray-600">{format(forecastData.reduce((s, d) => s + d.pessimistic, 0))}</td>
                <td className="px-4 py-2 text-indigo-700">{format(totalForecast)}</td>
                <td className="px-4 py-2 text-green-700">{format(forecastData.reduce((s, d) => s + d.optimistic, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Revenue by source */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">الإيرادات حسب المصدر</h3>
          {sourceBreakdown.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">لا بيانات</p>
          ) : sourceBreakdown.map(([src, amt], i) => {
            const medals = ['🥇', '🥈', '🥉'];
            return (
              <div key={src} className="flex items-center gap-3 mb-3">
                <span className="text-sm w-5 text-center">{medals[i] || `${i + 1}`}</span>
                <div className="flex-1">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-sm font-medium text-gray-700">{src}</span>
                    <span className="text-xs font-bold text-green-700">{format(amt)} ج.م</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-400 to-blue-500 rounded-full" style={{ width: `${Math.round(amt / maxSource * 100)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Pipeline breakdown */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="font-bold text-gray-700 mb-2 text-sm flex items-center gap-1.5"><Target size={13} className="text-amber-500" /> خط الأنابيب (Pipeline)</h4>
            {[
              { label: 'مهتمون (حجز)', count: leads.filter(l => l.status === 'interested_booking').length, value: leads.filter(l => l.status === 'interested_booking').reduce((s, l) => s + (l.dealValue || 2000), 0) },
              { label: 'مهتمون (متابعة)', count: leads.filter(l => l.status === 'interested_followup').length, value: leads.filter(l => l.status === 'interested_followup').reduce((s, l) => s + (l.dealValue || 2000), 0) },
              { label: 'مهتمون (عام)', count: leads.filter(l => l.status === 'interested').length, value: leads.filter(l => l.status === 'interested').reduce((s, l) => s + (l.dealValue || 2000), 0) },
            ].map(row => (
              <div key={row.label} className="flex justify-between text-xs text-gray-600 py-1 border-b border-gray-50">
                <span>{row.label} <span className="text-gray-400">({row.count} ليد)</span></span>
                <span className="font-bold text-amber-700">{format(row.value)} ج.م</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700">
        <p className="font-bold mb-1 flex items-center gap-1.5"><Info size={14} /> منهجية التوقع</p>
        <p>التوقعات محسوبة بناءً على متوسط آخر 3 أشهر مع تطبيق معدل النمو المحدد يدوياً. السيناريو التفاؤلي +20%، والمحافظ -20% من التوقع الأساسي.</p>
      </div>
    </div>
  );
};

export default RevenueForecastTab;
