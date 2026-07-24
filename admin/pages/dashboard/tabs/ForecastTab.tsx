import { useMemo, useState } from 'react';
import { TrendingUp, Target, ArrowUpRight } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts';


function getLast6Months() {
  const ms: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    ms.push(d.toISOString().slice(0, 7));
  }
  return ms;
}

function getNext3Months() {
  const ms: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i);
    ms.push(d.toISOString().slice(0, 7));
  }
  return ms;
}

const MONTH_LABELS: Record<string, string> = {
  '01':'يناير','02':'فبراير','03':'مارس','04':'أبريل','05':'مايو','06':'يونيو',
  '07':'يوليو','08':'أغسطس','09':'سبتمبر','10':'أكتوبر','11':'نوفمبر','12':'ديسمبر'
};

export default function ForecastTab() {
  const { orders, subscribers, leads } = useSiteData();
  const [growthRate, setGrowthRate] = useState(10);

  const pastMonths = getLast6Months();
  const nextMonths = getNext3Months();

  // Actual monthly revenue
  const monthlyRevenue = useMemo(() =>
    pastMonths.map(m => ({
      month: MONTH_LABELS[m.slice(5)] || m.slice(5),
      fullMonth: m,
      actual: orders.filter(o => (o.createdAt || '').slice(0, 7) === m && o.status === 'paid')
                     .reduce((acc, o) => acc + (Number(o.amount) || 0), 0),
      newSubs: subscribers.filter(s => (s.createdAt || '').slice(0, 7) === m).length,
      newLeads: leads.filter(l => (l.createdAt || '').slice(0, 7) === m).length,
    })),
    [orders, subscribers, leads, pastMonths]
  );

  // Average last 3 months
  const last3Avg = useMemo(() => {
    const last3 = monthlyRevenue.slice(-3);
    return last3.reduce((acc, m) => acc + m.actual, 0) / 3;
  }, [monthlyRevenue]);

  // Forecast next 3 months
  const forecastData = useMemo(() =>
    nextMonths.map((m, i) => ({
      month: MONTH_LABELS[m.slice(5)] || m.slice(5),
      fullMonth: m,
      forecast: Math.round(last3Avg * Math.pow(1 + growthRate / 100, i + 1)),
      optimistic: Math.round(last3Avg * Math.pow(1 + (growthRate + 5) / 100, i + 1)),
      pessimistic: Math.round(last3Avg * Math.pow(1 + Math.max(0, growthRate - 5) / 100, i + 1)),
    })),
    [last3Avg, growthRate, nextMonths]
  );

  const chartData = [
    ...monthlyRevenue.map(m => ({ month: m.month, actual: m.actual, forecast: null, type: 'actual' })),
    ...forecastData.map(m => ({ month: m.month, actual: null, forecast: m.forecast, optimistic: m.optimistic, pessimistic: m.pessimistic, type: 'forecast' })),
  ];

  const fmtMoney = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}ك` : String(n);

  const totalForecast3M = forecastData.reduce((a, m) => a + m.forecast, 0);
  const currentMonthActual = monthlyRevenue[monthlyRevenue.length - 1]?.actual || 0;
  const prevMonthActual = monthlyRevenue[monthlyRevenue.length - 2]?.actual || 0;
  const monthGrowth = prevMonthActual > 0 ? Math.round(((currentMonthActual - prevMonthActual) / prevMonthActual) * 100) : 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-blue-600 to-cyan-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><TrendingUp size={22} /> توقعات الإيراد</h2>
        <p className="text-blue-100 text-sm mt-1">تحليل الإيرادات الماضية وتوقع الأشهر القادمة</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="text-xs text-gray-500 mb-1">إيراد الشهر الحالي</div>
          <div className="text-xl font-extrabold text-gray-900">{fmtMoney(currentMonthActual)} ج</div>
          <div className={`text-xs font-bold mt-1 flex items-center gap-1 ${monthGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            <ArrowUpRight size={12} className={monthGrowth < 0 ? 'rotate-180' : ''} />{monthGrowth >= 0 ? '+' : ''}{monthGrowth}% عن الشهر الماضي
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="text-xs text-gray-500 mb-1">متوسط آخر 3 أشهر</div>
          <div className="text-xl font-extrabold text-gray-900">{fmtMoney(last3Avg)} ج</div>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
          <div className="text-xs text-indigo-500 mb-1">توقع الشهر القادم</div>
          <div className="text-xl font-extrabold text-indigo-700">{fmtMoney(forecastData[0]?.forecast || 0)} ج</div>
        </div>
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
          <div className="text-xs text-violet-500 mb-1">توقع إجمالي 3 أشهر</div>
          <div className="text-xl font-extrabold text-violet-700">{fmtMoney(totalForecast3M)} ج</div>
        </div>
      </div>

      {/* Growth rate control */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Target size={16} className="text-blue-500" />معدل النمو المتوقع</h3>
          <div className="flex items-center gap-3">
            <input type="range" min={-10} max={30} value={growthRate} onChange={e => setGrowthRate(Number(e.target.value))}
              className="w-32 accent-blue-500" />
            <span className={`font-bold text-lg ${growthRate >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{growthRate >= 0 ? '+' : ''}{growthRate}%</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtMoney(v)} />
            <Tooltip formatter={(v: number) => [`${v?.toLocaleString()} ج`, '']} />
            <Area type="monotone" dataKey="actual" stroke="#6366f1" fill="url(#actualGrad)" strokeWidth={2} name="فعلي" dot={{ r: 3 }} connectNulls={false} />
            <Area type="monotone" dataKey="forecast" stroke="#06b6d4" fill="url(#forecastGrad)" strokeWidth={2} strokeDasharray="6 3" name="متوقع" dot={{ r: 3 }} connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly breakdown table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">📊 تفصيل شهري</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الشهر</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الإيراد الفعلي</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">مشتركين جدد</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">ليدات جديدة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {monthlyRevenue.map(m => (
                <tr key={m.fullMonth} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">{m.month} {m.fullMonth.slice(0,4)}</td>
                  <td className="px-4 py-3 font-bold text-emerald-700">{m.actual.toLocaleString()} ج</td>
                  <td className="px-4 py-3 text-blue-700 font-semibold">{m.newSubs}</td>
                  <td className="px-4 py-3 text-violet-700 font-semibold">{m.newLeads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
