import { useMemo } from 'react';
import { Users, UserCheck, BarChart3, RefreshCw, Star } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';
import { useRetention } from '../hooks/useAnalyticsHubFigures';
import { retentionView } from '../analyticsHubFigures';


const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

export default function RetentionTab() {
  const { courses } = useSiteData();
  // The clients are counted by the server (GET /api/admin/analytics-hub/retention) — all of the person's clients, not the
  // list the context held — and what they paid in all, in EGP, comes with it.
  const data = useRetention();
  const { total, active, retentionRate, avgRevenue, monthlyNew, statusBreakdown, courseStats } = useMemo(
    () => retentionView(data, id => courses.find(c => c.id === id)?.title || id),
    [data, courses],
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-teal-600 to-emerald-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><RefreshCw size={22} /> تحليل الاحتفاظ بالعملاء</h2>
        <p className="text-teal-100 text-sm mt-1">معدل الاحتفاظ، الاشتراكات الجديدة، والمنتهية على مدار العام</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المشتركين', val: total, icon: Users, color: 'blue' },
          { label: 'النشطون', val: active, icon: UserCheck, color: 'emerald' },
          { label: 'معدل الاحتفاظ', val: `${retentionRate}%`, icon: Star, color: 'violet' },
          { label: 'متوسط الإيراد/عميل', val: `${avgRevenue.toLocaleString('ar-EG-u-nu-latn')} ج`, icon: BarChart3, color: 'amber' },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
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

      {/* Monthly trend */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-4">📈 الاشتراكات الجديدة مقابل المنتهية — آخر 12 شهر</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyNew}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="جديد" fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="منتهي" fill="#f87171" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Status pie */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4">🥧 توزيع حالات العملاء</h3>
          <div className="flex items-center gap-4">
            <PieChart width={160} height={160}>
              <Pie data={statusBreakdown} cx={75} cy={75} outerRadius={65} dataKey="value" nameKey="name">
                {statusBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
            </PieChart>
            <div className="flex-1 space-y-2">
              {statusBreakdown.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-gray-700 flex-1">{s.name}</span>
                  <span className="font-bold text-gray-900">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top courses */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4">🎓 أكثر الكورسات اشتراكًا</h3>
          <div className="space-y-3">
            {courseStats.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{c.name}</div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                    <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${Math.min(100, (c.count / (courseStats[0]?.count || 1)) * 100)}%` }} />
                  </div>
                </div>
                <span className="text-sm font-bold text-indigo-700 flex-shrink-0">{c.count} عميل</span>
              </div>
            ))}
            {courseStats.length === 0 && <p className="text-gray-400 text-sm text-center py-6">لا توجد بيانات</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
