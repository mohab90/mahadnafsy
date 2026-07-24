import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, TrendingUp, TrendingDown, Users, DollarSign,
  UserPlus, AlertCircle, Award, BarChart3, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type KpiData = {
  revenue: { today: number; week: number; month: number; prevMonth: number; monthChange: number | null };
  leads: { today: number; week: number };
  subscribers: { total: number; active: number; newThis7Days: number };
  alerts: { openTickets: number; pendingRefunds: number };
  topStaff: { name: string; role: string; earned: number; deals: number }[];
  revenueByDay: { day: string; revenue: number }[];
  leadsByDay: { day: string; count: number }[];
  generatedAt: string;
};

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}م`
  : n >= 1000    ? `${(n / 1000).toFixed(1)}ك`
  : String(Math.round(n));

const dayLabel = (d: string) => {
  const date = new Date(d);
  return `${date.getDate()}/${date.getMonth() + 1}`;
};

export default function KpiDashboardTab({ notify }: { notify: NotifyFn }) {
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('');
  const notifyRef = useRef(notify);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('mahad-token');
      const res = await fetch('/api/admin/kpi/summary', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date().toLocaleTimeString('ar-EG'));
    } catch (e: any) {
      notifyRef.current('error', `خطأ في تحميل لوحة KPI: ${e.message}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data && loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400" dir="rtl">
        <RefreshCw size={28} className="animate-spin ml-3" /> جاري تحميل لوحة الأداء...
      </div>
    );
  }

  const monthUp = data ? (data.revenue.monthChange ?? 0) >= 0 : true;

  return (
    <div className="space-y-5 p-1" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
            <BarChart3 size={22} className="text-indigo-600" />
            لوحة KPI — المدير
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {lastRefresh ? `آخر تحديث: ${lastRefresh}` : 'نظرة شاملة على أداء النظام'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {/* Alert banners */}
      {data && (data.alerts.openTickets > 0 || data.alerts.pendingRefunds > 0) && (
        <div className="flex flex-wrap gap-3">
          {data.alerts.openTickets > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-700 font-semibold">
              <AlertCircle size={16} /> {data.alerts.openTickets} تذكرة دعم مفتوحة
            </div>
          )}
          {data.alerts.pendingRefunds > 0 && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 text-sm text-rose-700 font-semibold">
              <AlertCircle size={16} /> {data.alerts.pendingRefunds} طلب استرداد معلق
            </div>
          )}
        </div>
      )}

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'إيراد اليوم',
            value: data ? `${fmt(data.revenue.today)} ج` : '—',
            icon: DollarSign,
            color: 'emerald',
            sub: data?.revenue.week ? `أسبوعياً: ${fmt(data.revenue.week)} ج` : '',
          },
          {
            label: 'إيراد الشهر',
            value: data ? `${fmt(data.revenue.month)} ج` : '—',
            icon: data && monthUp ? TrendingUp : TrendingDown,
            color: data && monthUp ? 'emerald' : 'rose',
            sub: data?.revenue.monthChange != null
              ? `${data.revenue.monthChange > 0 ? '+' : ''}${data.revenue.monthChange}% من الشهر السابق`
              : '',
          },
          {
            label: 'ليدات جديدة (أسبوع)',
            value: data ? String(data.leads.week) : '—',
            icon: UserPlus,
            color: 'blue',
            sub: data ? `اليوم: ${data.leads.today}` : '',
          },
          {
            label: 'مشتركون نشطون',
            value: data ? String(data.subscribers.active) : '—',
            icon: Users,
            color: 'violet',
            sub: data ? `+${data.subscribers.newThis7Days} هذا الأسبوع` : '',
          },
        ].map(kpi => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className={`bg-${kpi.color}-50 border border-${kpi.color}-100 rounded-2xl p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-9 h-9 rounded-xl bg-${kpi.color}-100 flex items-center justify-center flex-shrink-0`}>
                  <Icon size={18} className={`text-${kpi.color}-600`} />
                </div>
                <span className="text-xs text-gray-500 font-semibold">{kpi.label}</span>
              </div>
              <div className="text-2xl font-extrabold text-gray-900">{kpi.value}</div>
              {kpi.sub && <div className="text-xs text-gray-500 mt-1">{kpi.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Revenue by day */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-700 text-sm mb-4 flex items-center gap-2">
            <TrendingUp size={15} className="text-emerald-500" /> الإيراد — آخر 7 أيام
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data?.revenueByDay.map(r => ({ ...r, day: dayLabel(r.day) })) ?? []}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              <Tooltip formatter={(v: number) => [`${v.toLocaleString()} ج`, 'إيراد']} />
              <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#revGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Leads by day */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-700 text-sm mb-4 flex items-center gap-2">
            <UserPlus size={15} className="text-blue-500" /> ليدات جديدة — آخر 7 أيام
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data?.leadsByDay.map(r => ({ ...r, day: dayLabel(r.day) })) ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [v, 'ليد']} />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="ليدات" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top staff */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Award size={16} className="text-amber-500" />
          <h3 className="font-bold text-gray-700 text-sm">أفضل الموظفين — آخر 30 يوم (حسب العمولة)</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {data?.topStaff.length ? data.topStaff.map((s, i) => {
            const maxEarned = data.topStaff[0]?.earned || 1;
            return (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <span className="text-lg">{['🥇','🥈','🥉','4️⃣','5️⃣'][i]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm text-gray-800 truncate">{s.name}</span>
                    <span className="text-xs text-amber-600 font-bold ml-2">{fmt(s.earned)} ج</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div
                      className="h-1.5 rounded-full bg-amber-400"
                      style={{ width: `${Math.round((s.earned / maxEarned) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{s.deals} صفقة</span>
              </div>
            );
          }) : (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">لا توجد بيانات عمولات هذا الشهر</div>
          )}
        </div>
      </div>

      {/* System health */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المشتركين', value: data ? String(data.subscribers.total) : '—', icon: Users, color: 'gray' },
          { label: 'مشتركون نشطون', value: data ? String(data.subscribers.active) : '—', icon: Activity, color: 'emerald' },
          { label: 'تذاكر مفتوحة', value: data ? String(data.alerts.openTickets) : '—', icon: AlertCircle, color: data?.alerts.openTickets ? 'amber' : 'gray' },
          { label: 'استردادات معلقة', value: data ? String(data.alerts.pendingRefunds) : '—', icon: AlertCircle, color: data?.alerts.pendingRefunds ? 'rose' : 'gray' },
        ].map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg bg-${item.color}-50 flex items-center justify-center flex-shrink-0`}>
                <Icon size={16} className={`text-${item.color}-500`} />
              </div>
              <div>
                <div className="text-xl font-extrabold text-gray-900">{item.value}</div>
                <div className="text-xs text-gray-400">{item.label}</div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
