import { useMemo, useState } from 'react';
import { Users, UserCheck, BarChart3, RefreshCw, Star } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';


const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

function getLast12Months() {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

export default function RetentionTab() {
  const { subscribers, courses } = useSiteData();
  const [courseFilter, setCourseFilter] = useState('all');
  const months = getLast12Months();

  const activeSubs = useMemo(() =>
    subscribers.filter(s => !['finished','paused','refunded','leads'].includes(s.clientStatus || '')),
    [subscribers]
  );

  // Monthly new subscribers
  const monthlyNew = useMemo(() =>
    months.map(m => ({
      month: m.slice(5),
      'جديد': subscribers.filter(s => (s.createdAt || '').slice(0, 7) === m).length,
      'منتهي': subscribers.filter(s => s.clientStatus === 'finished' && (s.updatedAt || s.createdAt || '').slice(0, 7) === m).length,
    })),
    [subscribers, months]
  );

  // Course popularity
  const courseStats = useMemo(() => {
    const map: Record<string, { name: string; count: number; revenue: number }> = {};
    subscribers.forEach(s => {
      const ids = s.enrolledCourseIds || (s.enrolledCourseId ? [s.enrolledCourseId] : []);
      ids.forEach((cid: string) => {
        if (!map[cid]) {
          const course = courses.find(c => c.id === cid);
          map[cid] = { name: course?.title || cid, count: 0, revenue: 0 };
        }
        map[cid].count++;
        map[cid].revenue += Number(s.totalPaid) || 0;
      });
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [subscribers, courses]);

  // Status breakdown
  const statusBreakdown = useMemo(() => {
    const labels: Record<string, string> = {
      active: 'نشط', finished: 'منتهي', paused: 'متوقف', refunded: 'مسترد', leads: 'محول لليدات'
    };
    const map: Record<string, number> = {};
    subscribers.forEach(s => { const st = s.clientStatus || 'active'; map[st] = (map[st] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] || k, value: v }));
  }, [subscribers]);

  // Retention rate (active / total who ever enrolled)
  const retentionRate = useMemo(() => {
    const total = subscribers.length;
    const active = activeSubs.length;
    return total > 0 ? Math.round((active / total) * 100) : 0;
  }, [subscribers, activeSubs]);

  // Avg revenue per subscriber
  const avgRevenue = useMemo(() => {
    const total = subscribers.reduce((acc, s) => acc + (Number(s.totalPaid) || 0), 0);
    return subscribers.length > 0 ? Math.round(total / subscribers.length) : 0;
  }, [subscribers]);

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
          { label: 'إجمالي المشتركين', val: subscribers.length, icon: Users, color: 'blue' },
          { label: 'النشطون', val: activeSubs.length, icon: UserCheck, color: 'emerald' },
          { label: 'معدل الاحتفاظ', val: `${retentionRate}%`, icon: Star, color: 'violet' },
          { label: 'متوسط الإيراد/عميل', val: `${avgRevenue.toLocaleString()} ج`, icon: BarChart3, color: 'amber' },
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
