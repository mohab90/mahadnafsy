import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertCircle, Award, BarChart3, CalendarClock, CheckCircle2, DollarSign, RefreshCw, TrendingDown, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { numericTooltip } from '../../../lib/chartFormat';
import { CAIRO_TIME_ZONE } from '../../../../shared/cairoDate';

// «لوحة KPI للمدير»: the numbers a manager opens the panel for, from ONE server answer (GET /api/admin/kpi/summary, api/routes/analytics/dashboard.js):
// the money against the SAME days of last month, the leads and what became of them, the clients, who is at work today, what waits for a decision (each a link
// to where it is decided) and who collected most. Rebuilt on 5 Nov 2026 with the analytics page it used to sit beside.

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Kpi = {
  generatedAt: string;
  money: { today: number; week: number; month: number; prevMonth: number; prevSameDays: number; changeVsSameDays: number | null; payments: number; average: number; certificates: number; expenses: number; net: number };
  leads: { today: number; week: number; month: number; prevSameDays: number; changeVsSameDays: number | null; converted: number; conversionRate: number };
  clients: { total: number; active: number; new7: number; new30: number; expiringIn30Days: number };
  // null for a viewer without view_hr: who is at work, and the leaves and bonuses waiting, are HR's.
  team: { staff: number; present: number; late: number; absent: number; onLeave: number; recorded: number } | null;
  waiting: { tickets: number; refunds: number; leaves: number | null; bonuses: number | null };
  topCollectors: { id: string; name: string; role: string; revenue: number; payments: number }[];
  revenueByDay: { day: string; revenue: number }[];
  leadsByDay: { day: string; count: number }[];
};

// Written out: Tailwind only keeps the classes it can read in the source, never ones assembled from a variable.
const WAIT_TONES = {
  amber: 'border-amber-200 text-amber-700 hover:bg-amber-50', rose: 'border-rose-200 text-rose-700 hover:bg-rose-50',
  sky: 'border-sky-200 text-sky-700 hover:bg-sky-50', violet: 'border-violet-200 text-violet-700 hover:bg-violet-50',
} as const;

const n = (value: number) => Math.round(value).toLocaleString('ar-EG-u-nu-latn');
const short = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}م` : value >= 1000 ? `${(value / 1000).toFixed(1)}ك` : String(Math.round(value)));
// The server's days are Cairo days («YYYY-MM-DD»): cut, never run through Date (it reads them as UTC midnight).
const dayLabel = (day: string) => { const [, month, date] = day.slice(0, 10).split('-').map(Number); return month && date ? `${date}/${month}` : day; };

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-gray-400">لا مقارنة</span>;
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${up ? 'text-emerald-600' : 'text-rose-600'}`}><Icon size={12} />{up ? '+' : ''}{n(value)}٪ عن نفس الأيام الشهر اللي فات</span>;
}

function Card({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: React.ReactNode; icon: typeof Users; tone: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <div className="text-2xl font-extrabold leading-tight text-gray-900">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
        {sub && <div className="mt-1">{sub}</div>}
      </div>
    </div>
  );
}

export default function KpiDashboardTab({ notify }: { notify: NotifyFn }) {
  const [data, setData] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const navigate = useNavigate();
  const notifyRef = useRef(notify);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await mysqlAdmin.adminGet<Kpi>('/admin/kpi/summary'));
      setFailed(false);
    } catch (error) {
      // What is on screen stays (a failed refresh is not an empty company); the page says so and offers the retry.
      setFailed(true);
      notifyRef.current('error', error instanceof Error ? error.message : 'تعذر تحميل لوحة الأداء');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-gray-400" dir="rtl">
        {failed ? <><AlertCircle size={22} /> تعذر تحميل اللوحة <button type="button" onClick={() => void load()} className="font-bold text-indigo-600 underline">إعادة المحاولة</button></>
          : <><RefreshCw size={24} className="animate-spin" /> جاري تحميل لوحة الأداء…</>}
      </div>
    );
  }

  const waiting: { label: string; count: number; to: string; tone: keyof typeof WAIT_TONES }[] = [
    { label: 'تذكرة دعم مفتوحة', count: data.waiting.tickets, to: '/dashboard/customer_inbox', tone: 'amber' as const },
    { label: 'طلب استرداد مستني قرار', count: data.waiting.refunds, to: '/dashboard/refund_requests', tone: 'rose' as const },
    { label: 'إجازة أو إذن مستني اعتماد', count: data.waiting.leaves ?? 0, to: '/dashboard/hr', tone: 'sky' as const },
    { label: 'مكافأة أو خصم مستني اعتماد', count: data.waiting.bonuses ?? 0, to: '/dashboard/hr', tone: 'violet' as const },
  ].filter(item => item.count > 0);
  const top = data.topCollectors[0]?.revenue || 1;
  const team = data.team;
  const attended = Boolean(team && team.recorded > 0);
  const updated = new Date(data.generatedAt).toLocaleTimeString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE, hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-5 p-1" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-gray-800"><BarChart3 size={22} className="text-indigo-600" /> لوحة KPI — المدير</h2>
          <p className="mt-0.5 text-sm text-gray-400">آخر تحديث {updated}{failed ? ' — التحديث الأخير فشل، دي آخر أرقام وصلت' : ''}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {waiting.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-800"><AlertCircle size={16} /> مستني قرارك</h3>
          <div className="flex flex-wrap gap-2">
            {waiting.map(item => (
              <button key={item.label} type="button" onClick={() => navigate(item.to)}
                className={`rounded-xl border bg-white px-3 py-2 text-sm font-semibold ${WAIT_TONES[item.tone]}`}>
                <span className="ml-1 font-extrabold">{n(item.count)}</span>{item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-gray-600">الفلوس — الشهر</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="إيراد الشهر (ج)" value={short(data.money.month)} icon={DollarSign} tone="bg-emerald-50 text-emerald-600" sub={<Change value={data.money.changeVsSameDays} />} />
          <Card label="إيراد النهارده (ج)" value={short(data.money.today)} icon={Wallet} tone="bg-sky-50 text-sky-600" sub={<span className="text-[11px] text-gray-400">آخر 7 أيام {short(data.money.week)}</span>} />
          <Card label="مصروفات الشهر (ج)" value={short(data.money.expenses)} icon={TrendingDown} tone="bg-rose-50 text-rose-600"
            sub={<span className={`text-[11px] font-bold ${data.money.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>الصافي {data.money.net >= 0 ? '' : '−'}{short(Math.abs(data.money.net))} ج</span>} />
          <Card label="متوسط الدفعة (ج)" value={short(data.money.average)} icon={Activity} tone="bg-violet-50 text-violet-600"
            sub={<span className="text-[11px] text-gray-400">{n(data.money.payments)} دفعة{data.money.certificates > 0 ? ` · شهادات ${short(data.money.certificates)} ج بره الإيراد` : ''}</span>} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-gray-600">الليدات والعملاء</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="ليدات الشهر" value={n(data.leads.month)} icon={UserPlus} tone="bg-blue-50 text-blue-600" sub={<Change value={data.leads.changeVsSameDays} />} />
          <Card label="اتحولوا لعملاء الشهر" value={n(data.leads.converted)} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" sub={<span className="text-[11px] text-gray-400">معدل التحويل {n(data.leads.conversionRate)}٪ · النهارده {n(data.leads.today)} ليد</span>} />
          <Card label="عملاء نشطين" value={n(data.clients.active)} icon={Users} tone="bg-teal-50 text-teal-600" sub={<span className="text-[11px] text-gray-400">من {n(data.clients.total)} · جداد 7 أيام {n(data.clients.new7)} · 30 يوم {n(data.clients.new30)}</span>} />
          <Card label="اشتراكات بتخلص خلال 30 يوم" value={n(data.clients.expiringIn30Days)} icon={CalendarClock} tone="bg-amber-50 text-amber-600" sub={<span className="text-[11px] text-gray-400">فرصة تجديد</span>} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-gray-700">الإيراد — آخر 30 يوم</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.revenueByDay.map(row => ({ ...row, day: dayLabel(row.day) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={short} />
              <Tooltip formatter={numericTooltip(value => [`${value.toLocaleString('ar-EG-u-nu-latn')} ج`, 'الإيراد'])} />
              <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="#d1fae5" name="الإيراد" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-gray-700">الليدات — آخر 30 يوم</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.leadsByDay.map(row => ({ ...row, day: dayLabel(row.day) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip formatter={numericTooltip(value => [value, 'ليد'])} />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="ليدات" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <h3 className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 text-sm font-bold text-gray-700"><Award size={16} className="text-amber-500" /> أكتر ناس حصّلوا فلوس — الشهر ده</h3>
          <div className="divide-y divide-gray-50">
            {data.topCollectors.length ? data.topCollectors.map((row, index) => (
              <div key={row.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-6 text-center text-sm font-black text-gray-400">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-gray-800">{row.name}</span><span className="shrink-0 text-xs font-bold text-amber-600">{short(row.revenue)} ج</span></div>
                  <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${Math.max(3, Math.round((row.revenue / top) * 100))}%` }} /></div>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{n(row.payments)} دفعة</span>
              </div>
            )) : <div className="px-5 py-8 text-center text-sm text-gray-400">مفيش دفعات متسجلة بإسم موظف الشهر ده</div>}
          </div>
        </div>

        {team && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700"><Users size={16} className="text-teal-500" /> الفريق النهارده</h3>
          {attended ? (
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              {[['حاضرين', team.present, 'text-emerald-600'], ['متأخرين', team.late, 'text-amber-600'], ['غايبين', team.absent, 'text-rose-600'], ['إجازة', team.onLeave, 'text-sky-600']].map(([label, value, tone]) => (
                <div key={label as string} className="rounded-xl bg-gray-50 p-3"><div className={`text-2xl font-extrabold ${tone}`}>{n(value as number)}</div><div className="text-xs text-gray-500">{label}</div></div>
              ))}
            </div>
          ) : <p className="py-4 text-sm text-gray-400">مفيش حضور متسجل النهارده لسه — البصمة بتترفع من «الموارد البشرية».</p>}
          <p className="mt-3 text-xs text-gray-400">{n(team.staff)} موظف نشط في النظام.</p>
        </div>
        )}
      </div>
    </div>
  );
}
