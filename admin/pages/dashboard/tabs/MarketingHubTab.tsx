import React, { useMemo, useState, useCallback } from 'react';
import {
  Megaphone, Users, TrendingUp, Mail, MessageSquare, Zap, BarChart3,
  UserPlus, Target, Globe, Bell, Tag, Star, ArrowUpRight, ArrowDownRight,
  Filter, Calendar, Clock, ChevronRight, RefreshCw,
  Smartphone, Send, CheckCircle, 
  Percent, CreditCard, 
  Trophy, X, 
  Hash, Copy, 
  MessageCircle, Inbox, Layers, Award,
} from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type TimeRange = 'today' | '7d' | '30d' | 'month' | 'all';
type SubTab = 'overview' | 'leads' | 'discounts' | 'campaigns' | 'notifications_tab' | 'automation' | 'performance' | 'segmentation';

interface Props { notify: NotifyFn; }

// ── Helpers ────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = new Date().toISOString().slice(0, 7);

function getRangeStart(range: TimeRange): string {
  const d = new Date();
  if (range === 'today') return TODAY;
  if (range === '7d') return new Date(+d - 7 * 86400000).toISOString().slice(0, 10);
  if (range === '30d') return new Date(+d - 30 * 86400000).toISOString().slice(0, 10);
  if (range === 'month') return `${MONTH}-01`;
  return '2000-01-01';
}
function inRange(dateStr: string | undefined, range: TimeRange): boolean {
  if (range === 'all') return true;
  return (dateStr || '').slice(0, 10) >= getRangeStart(range);
}
function pct(val: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((val / total) * 100));
}
function fmtK(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}م` : n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);
}
function getLast7Days() {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const SOURCE_ICONS: Record<string, string> = {
  Facebook: '📘', Instagram: '📸', WhatsApp: '💬', TikTok: '🎵',
  YouTube: '▶️', Google: '🔍', Manual: '✍️', Referral: '🤝',
  Website: '🌐', Email: '📧', Other: '❓',
};
const SOURCE_COLORS: Record<string, string> = {
  Facebook: 'bg-blue-100 text-blue-700 border-blue-200',
  Instagram: 'bg-pink-100 text-pink-700 border-pink-200',
  WhatsApp: 'bg-green-100 text-green-700 border-green-200',
  TikTok: 'bg-gray-100 text-gray-800 border-gray-200',
  YouTube: 'bg-red-100 text-red-700 border-red-200',
  Google: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Manual: 'bg-purple-100 text-purple-700 border-purple-200',
  Referral: 'bg-teal-100 text-teal-700 border-teal-200',
  Website: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  Email: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  Other: 'bg-gray-100 text-gray-600 border-gray-200',
};

// ── ProgressBar Component ──────────────────────────────────────────────────
const ProgressBar: React.FC<{ value: number; max: number; color?: string; height?: string }> = ({
  value, max, color = 'bg-rose-400', height = 'h-2',
}) => {
  const p = pct(value, max);
  const c = p >= 100 ? 'bg-green-500' : p >= 60 ? color : p >= 30 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className={`w-full ${height} bg-gray-100 rounded-full overflow-hidden`}>
      <div className={`${c} h-full rounded-full transition-all duration-500`} style={{ width: `${p}%` }} />
    </div>
  );
};

// ── MiniBarChart Component ─────────────────────────────────────────────────
const MiniBarChart: React.FC<{
  data: { label: string; value: number }[];
  color?: string; height?: number; showLabels?: boolean;
}> = ({ data, color = 'bg-rose-400', height = 50, showLabels = false }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="w-full">
      <div className="flex items-end gap-1 w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((d.value / max) * height));
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative" title={`${d.label}: ${d.value}`}>
              <div className={`w-full rounded-t-sm ${color} opacity-80 hover:opacity-100 transition-all cursor-default`} style={{ height: h }} />
              {d.value > 0 && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                  {d.value}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="flex gap-1 mt-1">
          {data.map((d, i) => (
            <div key={i} className="flex-1 text-center text-xs text-gray-400">{d.label.slice(-2)}</div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── StatCard Component ─────────────────────────────────────────────────────
const StatCard: React.FC<{
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; bg: string;
  trend?: number;
}> = ({ label, value, sub, icon: Icon, color, bg, trend }) => (
  <div className={`${bg} rounded-2xl p-4`}>
    <div className="flex items-start justify-between mb-2">
      <Icon size={18} className={`${color} opacity-70`} />
      {trend !== undefined && (
        <span className={`text-xs font-bold flex items-center gap-0.5 ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {trend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {Math.abs(trend)}%
        </span>
      )}
    </div>
    <div className={`text-2xl font-black ${color}`}>{value}</div>
    <div className="text-xs font-medium text-gray-700 mt-0.5">{label}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════
const DEFAULT_AUTOMATION_TOGGLES: Record<string, boolean> = {
  welcome_lead: true, converted_msg: true, followup_reminder: true,
  sms_drip: false, cart_recovery: false, review_request: true,
};

const MarketingHubTab: React.FC<Props> = ({ notify }) => {
  const { leads, subscribers, orders, discounts, notifications, joinUsApplications, content, setContentValue } = useSiteData();

  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  // Persisted as a tenant content setting (MKT-01) — these switches were pure
  // local state before, resetting to the hardcoded defaults on every refresh
  // even though the panel below is explicit that flipping them doesn't wire
  // up a real send yet ("الأتوميشن حالياً في وضع العرض"). Persisting at least
  // means an admin's preview configuration survives a reload.
  const automationToggles = useMemo<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(content['marketing.automation_toggles'] || '{}');
      return { ...DEFAULT_AUTOMATION_TOGGLES, ...saved };
    } catch { return DEFAULT_AUTOMATION_TOGGLES; }
  }, [content]);

  // ── Filtered data ──────────────────────────────────────────────────────
  const filteredLeads = useMemo(() =>
    leads.filter(l => !l.hidden && inRange(l.createdAt, timeRange)), [leads, timeRange]);
  const filteredOrders = useMemo(() =>
    orders.filter(o => o.status === 'paid' && inRange(o.paidAt || o.createdAt, timeRange)), [orders, timeRange]);
  const filteredSubs = useMemo(() =>
    subscribers.filter(s => inRange(s.subscribedAt || s.createdAt, timeRange)), [subscribers, timeRange]);

  // ── KPIs ───────────────────────────────────────────────────────────────
  const totalRevenue = filteredOrders.reduce((s, o) => s + (o.amount || 0), 0);
  const convertedLeads = filteredLeads.filter(l => l.status === 'converted').length;
  const convRate = pct(convertedLeads, filteredLeads.length);
  const activeDiscounts = useMemo(() => discounts.filter(d => d.isActive), [discounts]);
  const totalDiscountUsage = discounts.reduce((s, d) => s + (d.usageCount || 0), 0);

  // ── Source breakdown ───────────────────────────────────────────────────
  const sourceBreakdown = useMemo(() => {
    const m: Record<string, { total: number; converted: number; revenue: number }> = {};
    filteredLeads.forEach(l => {
      const src = l.source || 'Other';
      if (!m[src]) m[src] = { total: 0, converted: 0, revenue: 0 };
      m[src].total++;
      if (l.status === 'converted') {
        m[src].converted++;
        // Approximate revenue from converted leads
        const relatedOrders = filteredOrders.filter(o => o.leadId === l.id || o.clientEmail === l.email);
        m[src].revenue += relatedOrders.reduce((s, o) => s + (o.amount || 0), 0);
      }
    });
    return Object.entries(m)
      .map(([source, d]) => ({ source, ...d, convRate: pct(d.converted, d.total) }))
      .sort((a, b) => b.total - a.total);
  }, [filteredLeads, filteredOrders]);

  // ── Funnel ─────────────────────────────────────────────────────────────
  const funnel = useMemo(() => {
    const total = filteredLeads.length;
    const contacted = filteredLeads.filter(l => ['contacted','interested','converted','lost'].includes(l.status||'')).length;
    const interested = filteredLeads.filter(l => ['interested','converted'].includes(l.status||'')).length;
    const converted = filteredLeads.filter(l => l.status === 'converted').length;
    return [
      { label: 'الليدات الواردة', value: total, color: 'bg-rose-500', w: 100 },
      { label: 'تم التواصل', value: contacted, color: 'bg-orange-500', w: pct(contacted, total) },
      { label: 'مهتم', value: interested, color: 'bg-amber-500', w: pct(interested, total) },
      { label: 'تحويل ناجح', value: converted, color: 'bg-green-500', w: pct(converted, total) },
    ];
  }, [filteredLeads]);

  // ── 7-day charts ────────────────────────────────────────────────────────
  const last7Days = useMemo(() => getLast7Days(), []);
  const leadsChartData = useMemo(() =>
    last7Days.map(day => ({
      label: day, value: leads.filter(l => !l.hidden && (l.createdAt || '').slice(0, 10) === day).length,
    })), [leads, last7Days]);
  const revenueChartData = useMemo(() =>
    last7Days.map(day => ({
      label: day, value: orders.filter(o => o.status === 'paid' && (o.paidAt || o.createdAt || '').slice(0, 10) === day)
        .reduce((s, o) => s + (o.amount || 0), 0),
    })), [orders, last7Days]);
  const convChartData = useMemo(() =>
    last7Days.map(day => ({
      label: day, value: leads.filter(l => l.status === 'converted' && (l.updatedAt || l.createdAt || '').slice(0, 10) === day).length,
    })), [leads, last7Days]);

  // ── Discount analytics ─────────────────────────────────────────────────
  const discountAnalytics = useMemo(() => {
    const topUsed = [...discounts].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 5);
    const totalSaved = discounts.reduce((s, d) => {
      if (d.type === 'fixed') return s + ((d.usageCount || 0) * (d.value || 0));
      return s; // percent is harder to calc without order data
    }, 0);
    return { topUsed, totalSaved };
  }, [discounts]);

  const toggleAutomation = useCallback((key: string) => {
    const next = { ...automationToggles, [key]: !automationToggles[key] };
    setContentValue('marketing.automation_toggles', JSON.stringify(next));
    notify('success', `${next[key] ? 'تم تفعيل' : 'تم إيقاف'} الأتوميشن`);
  }, [automationToggles, setContentValue, notify]);

  const RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
    { key: 'today', label: 'اليوم' },
    { key: '7d', label: '٧ أيام' },
    { key: 'month', label: 'الشهر' },
    { key: '30d', label: '٣٠ يوم' },
    { key: 'all', label: 'الكل' },
  ];

  const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: BarChart3 },
    { key: 'leads', label: 'الليدات', icon: Filter },
    { key: 'discounts', label: 'الخصومات', icon: Tag },
    { key: 'campaigns', label: 'الحملات', icon: Mail },
    { key: 'notifications_tab', label: 'الإشعارات', icon: Bell },
    { key: 'automation', label: 'الأتوميشن', icon: Zap },
    { key: 'segmentation', label: 'الشرائح', icon: Layers },
    { key: 'performance', label: 'الأداء', icon: TrendingUp },
  ];

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="bg-gradient-to-l from-rose-700 to-pink-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Megaphone size={22} /> مركز التسويق الشامل
            </h2>
            <p className="text-rose-200 text-sm mt-0.5">
              الليدات · الحملات · الخصومات · الإشعارات · الأتوميشن · الأداء
            </p>
          </div>
          <div className="flex bg-white/10 rounded-xl overflow-hidden">
            {RANGE_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setTimeRange(opt.key)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${timeRange === opt.key ? 'bg-white text-rose-700' : 'text-rose-100 hover:bg-white/10'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'ليدات جديدة', value: filteredLeads.length, icon: UserPlus, bg: 'bg-white/15' },
            { label: 'تحويلات', value: convertedLeads, icon: CheckCircle, bg: convertedLeads > 0 ? 'bg-green-600/30' : 'bg-white/15' },
            { label: 'معدل التحويل', value: `${convRate}%`, icon: Percent, bg: 'bg-white/15' },
            { label: 'إيراد', value: `${fmtK(totalRevenue)} ج`, icon: CreditCard, bg: 'bg-white/15' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 flex items-center gap-2.5`}>
              <s.icon size={18} className="opacity-80 shrink-0" />
              <div>
                <div className="text-lg font-bold leading-none">{s.value}</div>
                <div className="text-xs text-rose-200 mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sub-tabs nav ──────────────────────────────────────────── */}
      <div className="flex gap-2 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveSubTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeSubTab === key ? 'bg-white shadow-sm text-rose-700 font-bold' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ════════════════════ OVERVIEW ════════════════════ */}
      {activeSubTab === 'overview' && (
        <div className="space-y-5">

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="ليدات جديدة" value={filteredLeads.length} sub="هذه الفترة" icon={UserPlus} color="text-rose-600" bg="bg-rose-50" />
            <StatCard label="معدل التحويل" value={`${convRate}%`} sub={`${convertedLeads} تحويل`} icon={Percent} color="text-green-600" bg="bg-green-50" />
            <StatCard label="مشتركين جدد" value={filteredSubs.length} sub="في الفترة" icon={Users} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="إجمالي إيراد" value={`${fmtK(totalRevenue)} ج`} sub={`${filteredOrders.length} طلب`} icon={CreditCard} color="text-teal-600" bg="bg-teal-50" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Leads chart */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
                  <UserPlus size={15} className="text-rose-500" /> ليدات آخر ٧ أيام
                </h3>
                <span className="text-xs text-gray-400 font-bold">{leadsChartData.reduce((s,d)=>s+d.value,0)}</span>
              </div>
              <MiniBarChart data={leadsChartData} color="bg-rose-400" height={55} showLabels />
            </div>

            {/* Revenue chart */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
                  <CreditCard size={15} className="text-teal-500" /> إيراد آخر ٧ أيام
                </h3>
                <span className="text-xs text-gray-400 font-bold">{fmtK(revenueChartData.reduce((s,d)=>s+d.value,0))} ج</span>
              </div>
              <MiniBarChart data={revenueChartData} color="bg-teal-400" height={55} showLabels />
            </div>

            {/* Conversion chart */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
                  <CheckCircle size={15} className="text-green-500" /> تحويلات آخر ٧ أيام
                </h3>
                <span className="text-xs text-gray-400 font-bold">{convChartData.reduce((s,d)=>s+d.value,0)}</span>
              </div>
              <MiniBarChart data={convChartData} color="bg-green-400" height={55} showLabels />
            </div>
          </div>

          {/* Sources + Funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source breakdown */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Globe size={16} className="text-rose-500" />
                <h3 className="font-bold text-gray-800">أفضل مصادر الليدات</h3>
              </div>
              <div className="p-4 space-y-3">
                {sourceBreakdown.length === 0
                  ? <p className="text-center text-gray-400 py-6 text-sm">لا بيانات في هذه الفترة</p>
                  : sourceBreakdown.slice(0, 6).map(src => (
                    <div key={src.source}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{SOURCE_ICONS[src.source] || '❓'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SOURCE_COLORS[src.source] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                            {src.source}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-2">
                          <span className="font-bold text-gray-700">{src.total}</span>
                          <span className={`font-semibold ${src.convRate >= 30 ? 'text-green-600' : src.convRate >= 15 ? 'text-yellow-600' : 'text-gray-400'}`}>
                            {src.convRate}% ✓
                          </span>
                        </div>
                      </div>
                      <ProgressBar value={src.total} max={sourceBreakdown[0]?.total || 1} color="bg-rose-400" />
                    </div>
                  ))}
              </div>
            </div>

            {/* Conversion funnel */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Filter size={16} className="text-rose-500" />
                <h3 className="font-bold text-gray-800">مسار التحويل</h3>
              </div>
              <div className="p-4 space-y-3">
                {funnel.map((step, idx) => (
                  <div key={step.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-600 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 text-xs flex items-center justify-center font-bold">{idx+1}</span>
                        {step.label}
                      </span>
                      <span className="text-sm font-bold text-gray-800">{step.value}</span>
                    </div>
                    <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`${step.color} h-full rounded-full flex items-center justify-end pr-2 text-white text-xs font-medium transition-all duration-700`}
                        style={{ width: `${step.w}%` }}>
                        {step.w > 15 ? `${step.w}%` : ''}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="mt-2 p-3 bg-green-50 rounded-xl border border-green-100 flex items-center justify-between">
                  <span className="text-sm text-green-700 font-semibold">معدل التحويل الإجمالي</span>
                  <span className="text-xl font-black text-green-700">{funnel[3]?.w || 0}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Active discounts + recent notifications */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag size={16} className="text-rose-500" />
                  <h3 className="font-bold text-gray-800">الكوبونات النشطة</h3>
                </div>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{activeDiscounts.length} نشط</span>
              </div>
              <div className="divide-y divide-gray-50">
                {activeDiscounts.length === 0
                  ? <p className="p-6 text-center text-gray-400 text-sm">لا كوبونات نشطة</p>
                  : activeDiscounts.slice(0, 5).map(d => (
                    <div key={d.id} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="font-mono font-bold text-indigo-600 text-sm">{d.code}</span>
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                        {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                      </span>
                      <span className="mr-auto text-xs text-gray-400">{d.usageCount || 0} استخدام{d.usageLimit ? ` / ${d.usageLimit}` : ''}</span>
                      <div className="w-16">
                        <ProgressBar value={d.usageCount || 0} max={d.usageLimit || Math.max(d.usageCount || 1, 1)} color="bg-indigo-400" height="h-1.5" />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Bell size={16} className="text-rose-500" />
                <h3 className="font-bold text-gray-800">آخر الإشعارات المرسلة</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {notifications.length === 0
                  ? <p className="p-6 text-center text-gray-400 text-sm">لم يُرسل أي إشعار</p>
                  : notifications.slice(0, 5).map(n => (
                    <div key={n.id} className="px-4 py-2.5 flex items-start gap-3">
                      <Bell size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                        <p className="text-xs text-gray-400 truncate">{n.body}</p>
                      </div>
                      <span className="text-xs text-gray-300 shrink-0">{(n.sentAt || n.createdAt || '').slice(5, 10)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ LEADS ════════════════════ */}
      {activeSubTab === 'leads' && (
        <div className="space-y-5">

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                  <TrendingUp size={15} className="text-rose-500" /> منحنى الليدات (٧ أيام)
                </h3>
                <span className="text-xs font-bold text-rose-500">{leadsChartData.reduce((s,d)=>s+d.value,0)} ليد</span>
              </div>
              <MiniBarChart data={leadsChartData} color="bg-rose-400" height={60} showLabels />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 mb-3">
                <CheckCircle size={15} className="text-green-500" /> تحويلات آخر ٧ أيام
              </h3>
              <MiniBarChart data={convChartData} color="bg-green-400" height={60} showLabels />
            </div>
          </div>

          {/* Status breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { status: 'new', label: 'جديد', color: 'bg-blue-50 border-blue-200', textColor: 'text-blue-700', icon: '🆕' },
              { status: 'contacted', label: 'تم التواصل', color: 'bg-indigo-50 border-indigo-200', textColor: 'text-indigo-700', icon: '📞' },
              { status: 'interested', label: 'مهتم', color: 'bg-yellow-50 border-yellow-200', textColor: 'text-yellow-700', icon: '💡' },
              { status: 'converted', label: 'محوّل ✓', color: 'bg-green-50 border-green-200', textColor: 'text-green-700', icon: '✅' },
            ].map(s => (
              <div key={s.status} className={`border rounded-2xl p-4 text-center ${s.color}`}>
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className={`text-3xl font-black ${s.textColor}`}>
                  {filteredLeads.filter(l => l.status === s.status).length}
                </div>
                <div className={`text-xs font-medium mt-1 ${s.textColor}`}>{s.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {pct(filteredLeads.filter(l => l.status === s.status).length, filteredLeads.length)}%
                </div>
              </div>
            ))}
          </div>

          {/* Sources detailed table */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Globe size={16} className="text-rose-500" /> تحليل المصادر التفصيلي
              </h3>
              <span className="text-xs text-gray-400">{filteredLeads.length} ليد إجمالي</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-right p-3 font-medium">المصدر</th>
                    <th className="text-center p-3 font-medium">إجمالي</th>
                    <th className="text-center p-3 font-medium">تواصل</th>
                    <th className="text-center p-3 font-medium">مهتم</th>
                    <th className="text-center p-3 font-medium">محوّل</th>
                    <th className="text-center p-3 font-medium">% تحويل</th>
                    <th className="text-center p-3 font-medium">إيراد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sourceBreakdown.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا ليدات في هذه الفترة</td></tr>
                  ) : sourceBreakdown.map(src => {
                    const myLeads = filteredLeads.filter(l => (l.source || 'Other') === src.source);
                    const contacted = myLeads.filter(l => ['contacted','interested','converted','lost'].includes(l.status||'')).length;
                    const interested = myLeads.filter(l => ['interested','converted'].includes(l.status||'')).length;
                    return (
                      <tr key={src.source} className="hover:bg-gray-50 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{SOURCE_ICONS[src.source] || '❓'}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SOURCE_COLORS[src.source] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                              {src.source}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-center font-bold text-gray-800">{src.total}</td>
                        <td className="p-3 text-center text-indigo-600">{contacted}</td>
                        <td className="p-3 text-center text-amber-600">{interested}</td>
                        <td className="p-3 text-center text-green-600 font-semibold">{src.converted}</td>
                        <td className="p-3 text-center">
                          <span className={`font-bold ${src.convRate >= 30 ? 'text-green-600' : src.convRate >= 15 ? 'text-yellow-600' : 'text-red-500'}`}>
                            {src.convRate}%
                          </span>
                        </td>
                        <td className="p-3 text-center text-teal-600 font-semibold">
                          {src.revenue > 0 ? `${fmtK(src.revenue)} ج` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ DISCOUNTS ════════════════════ */}
      {activeSubTab === 'discounts' && (
        <div className="space-y-5">

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="إجمالي الكوبونات" value={discounts.length} icon={Tag} color="text-rose-600" bg="bg-rose-50" />
            <StatCard label="كوبونات نشطة" value={activeDiscounts.length} icon={CheckCircle} color="text-green-600" bg="bg-green-50" />
            <StatCard label="إجمالي الاستخدامات" value={totalDiscountUsage} icon={Hash} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="متوقف" value={discounts.filter(d => !d.isActive).length} icon={X} color="text-gray-500" bg="bg-gray-50" />
          </div>

          {/* Top used discounts chart */}
          {discountAnalytics.topUsed.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-1.5">
                <Award size={16} className="text-amber-500" /> أكثر الكوبونات استخداماً
              </h3>
              <div className="space-y-3">
                {discountAnalytics.topUsed.map((d, idx) => (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-400 w-4">{idx + 1}.</span>
                    <span className="font-mono font-bold text-indigo-600 w-28">{d.code}</span>
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded w-16 text-center">
                      {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                    </span>
                    <div className="flex-1">
                      <ProgressBar value={d.usageCount || 0} max={discountAnalytics.topUsed[0]?.usageCount || 1} color="bg-rose-400" height="h-2.5" />
                    </div>
                    <span className="text-sm font-bold text-gray-700 w-12 text-left">{d.usageCount || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full discounts table */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Tag size={16} className="text-rose-500" /> جميع الخصومات والكوبونات
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-semibold">{activeDiscounts.length} نشط</span>
                <span className="text-xs text-gray-400">/ {discounts.length} إجمالي</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-right p-3 font-medium">الكود</th>
                    <th className="text-center p-3 font-medium">النوع</th>
                    <th className="text-center p-3 font-medium">القيمة</th>
                    <th className="text-center p-3 font-medium">الاستخدامات</th>
                    <th className="text-center p-3 font-medium">الحد الأقصى</th>
                    <th className="text-center p-3 font-medium">الاستخدام</th>
                    <th className="text-center p-3 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {discounts.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا كوبونات مضافة بعد</td></tr>
                  ) : discounts.map(d => {
                    const usagePct = d.usageLimit ? pct(d.usageCount || 0, d.usageLimit) : 0;
                    return (
                      <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${!d.isActive ? 'opacity-60' : ''}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-indigo-600">{d.code}</span>
                            <button onClick={() => { navigator.clipboard?.writeText(d.code || ''); notify('success', 'تم نسخ الكود'); }}
                              className="text-gray-400 hover:text-gray-600">
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${d.type === 'percent' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                            {d.type === 'percent' ? 'نسبة' : 'مبلغ'}
                          </span>
                        </td>
                        <td className="p-3 text-center font-semibold">
                          {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                        </td>
                        <td className="p-3 text-center font-bold">{d.usageCount ?? 0}</td>
                        <td className="p-3 text-center text-gray-500">{d.usageLimit ?? '∞'}</td>
                        <td className="p-3 text-center w-24">
                          {d.usageLimit ? (
                            <div className="space-y-0.5">
                              <ProgressBar value={d.usageCount || 0} max={d.usageLimit} color="bg-indigo-400" height="h-1.5" />
                              <span className="text-xs text-gray-400">{usagePct}%</span>
                            </div>
                          ) : <span className="text-xs text-gray-300">غير محدود</span>}
                        </td>
                        <td className="p-3 text-center">
                          {d.isActive
                            ? <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">نشط</span>
                            : <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">متوقف</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ CAMPAIGNS ════════════════════ */}
      {activeSubTab === 'campaigns' && (
        <div className="space-y-5">

          {/* Campaign type cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: Mail, title: 'حملات البريد الإلكتروني', color: 'from-blue-600 to-indigo-600',
                stats: [
                  { label: 'حملات منشأة', value: '0' },
                  { label: 'إيميلات مرسلة', value: '—' },
                  { label: 'معدل الفتح', value: '—' },
                ],
                badge: 'قريباً',
              },
              {
                icon: Smartphone, title: 'حملات SMS والدريب', color: 'from-green-600 to-teal-600',
                stats: [
                  { label: 'تسلسلات نشطة', value: '0' },
                  { label: 'رسائل مرسلة', value: '—' },
                  { label: 'معدل الرد', value: '—' },
                ],
                badge: 'قريباً',
              },
              {
                icon: MessageCircle, title: 'حملات WhatsApp', color: 'from-emerald-600 to-green-600',
                stats: [
                  { label: 'قوائم نشطة', value: '0' },
                  { label: 'رسائل مرسلة', value: '—' },
                  { label: 'معدل الوصول', value: '—' },
                ],
                badge: 'قريباً',
              },
            ].map(c => (
              <div key={c.title} className={`bg-gradient-to-br ${c.color} rounded-2xl p-5 text-white relative overflow-hidden`}>
                <div className="absolute top-2 left-2 text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">{c.badge}</div>
                <c.icon size={28} className="mb-3 opacity-90" />
                <h3 className="font-bold text-base mb-3">{c.title}</h3>
                <div className="grid grid-cols-3 gap-2">
                  {c.stats.map(s => (
                    <div key={s.label} className="bg-white/15 rounded-xl p-2 text-center">
                      <div className="font-bold text-sm">{s.value}</div>
                      <div className="text-xs opacity-80 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Join us as marketing signal */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <UserPlus size={16} className="text-rose-500" /> طلبات الانضمام — مؤشر تسويقي
              </h3>
              <span className="text-xs text-gray-400">{joinUsApplications.length} طلب</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'إجمالي الطلبات', value: joinUsApplications.length, color: 'text-gray-700', bg: 'bg-gray-50' },
                  { label: 'قيد المراجعة', value: joinUsApplications.filter(a => a.status === 'pending').length, color: 'text-yellow-600', bg: 'bg-yellow-50' },
                  { label: 'مقبول', value: joinUsApplications.filter(a => a.status === 'accepted').length, color: 'text-green-600', bg: 'bg-green-50' },
                  { label: 'مرفوض', value: joinUsApplications.filter(a => a.status === 'rejected').length, color: 'text-red-500', bg: 'bg-red-50' },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-3`}>
                    <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── A/B Test WhatsApp Campaign ── */}
          <AbTestSection leads={leads} notify={notify} />
        </div>
      )}

      {/* ════════════════════ NOTIFICATIONS ════════════════════ */}
      {activeSubTab === 'notifications_tab' && (
        <div className="space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="إجمالي الإشعارات" value={notifications.length} icon={Bell} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="مرسل اليوم" value={notifications.filter(n => (n.sentAt || n.createdAt || '').slice(0, 10) === TODAY).length} icon={Send} color="text-green-600" bg="bg-green-50" />
            <StatCard label="مرسل هذا الشهر" value={notifications.filter(n => (n.sentAt || n.createdAt || '').slice(0, 7) === MONTH).length} icon={Calendar} color="text-rose-600" bg="bg-rose-50" />
            <StatCard label="المستقبلون" value={subscribers.filter(s => s.status === 'active').length} icon={Users} color="text-teal-600" bg="bg-teal-50" />
          </div>

          {/* Notifications list */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Inbox size={16} className="text-indigo-500" /> سجل الإشعارات المرسلة
              </h3>
              <span className="text-xs text-gray-400">{notifications.length} إشعار</span>
            </div>
            <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  <Bell size={40} className="mx-auto mb-3 opacity-30" />
                  <p>لم يُرسل أي إشعار بعد</p>
                </div>
              ) : notifications.map((n, idx) => (
                <div key={n.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${idx % 3 === 0 ? 'bg-indigo-100' : idx % 3 === 1 ? 'bg-rose-100' : 'bg-green-100'}`}>
                      <Bell size={14} className={idx % 3 === 0 ? 'text-indigo-500' : idx % 3 === 1 ? 'text-rose-500' : 'text-green-500'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 mb-0.5">
                        <span className="font-semibold text-sm text-gray-800 flex-1">{n.title}</span>
                        <span className="text-xs text-gray-400 shrink-0">{(n.sentAt || n.createdAt || '').slice(0, 10)}</span>
                      </div>
                      <p className="text-sm text-gray-500 line-clamp-2">{n.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick action hint */}
          <div className="bg-gradient-to-l from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-4 flex items-center gap-3">
            <Bell size={22} className="text-indigo-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">لإرسال إشعار جديد</p>
              <p className="text-xs text-gray-400 mt-0.5">اذهب إلى: الاتصالات والتواصل ← إشعارات المشتركين</p>
            </div>
            <ChevronRight size={16} className="text-gray-400 mr-auto" />
          </div>
        </div>
      )}

      {/* ════════════════════ AUTOMATION ════════════════════ */}
      {activeSubTab === 'automation' && (
        <div className="space-y-5">

          {/* Header */}
          <div className="bg-gradient-to-l from-purple-700 to-indigo-600 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Zap size={24} />
              </div>
              <div>
                <h3 className="font-bold text-lg">مركز الأتوميشن التسويقي</h3>
                <p className="text-purple-200 text-sm mt-0.5">
                  {Object.values(automationToggles).filter(Boolean).length} مهمة نشطة من {Object.keys(automationToggles).length}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              <div className="bg-white/15 rounded-xl p-3 text-center">
                <div className="text-2xl font-black">{Object.values(automationToggles).filter(Boolean).length}</div>
                <div className="text-xs text-purple-200">نشط</div>
              </div>
              <div className="bg-white/15 rounded-xl p-3 text-center">
                <div className="text-2xl font-black">{Object.values(automationToggles).filter(v => !v).length}</div>
                <div className="text-xs text-purple-200">متوقف</div>
              </div>
              <div className="bg-white/15 rounded-xl p-3 text-center">
                <div className="text-2xl font-black">{Object.keys(automationToggles).length}</div>
                <div className="text-xs text-purple-200">إجمالي</div>
              </div>
            </div>
          </div>

          {/* Automation workflows */}
          <div className="space-y-3">
            {[
              {
                key: 'welcome_lead',
                icon: UserPlus,
                title: 'ترحيب بالليد الجديد',
                desc: 'رسالة ترحيب تلقائية عند إضافة ليد جديد للنظام',
                trigger: 'عند إضافة ليد',
                action: 'إرسال رسالة واتساب / بريد',
                color: 'bg-blue-100 text-blue-700',
              },
              {
                key: 'converted_msg',
                icon: CheckCircle,
                title: 'رسالة التحويل الناجح',
                desc: 'تأكيد التسجيل + ترحيب عند تحويل الليد لمشترك',
                trigger: 'عند تغيير الحالة إلى محوّل',
                action: 'رسالة شكر + تفاصيل الاشتراك',
                color: 'bg-green-100 text-green-700',
              },
              {
                key: 'followup_reminder',
                icon: Clock,
                title: 'تذكيرات المتابعة للسيلز',
                desc: 'تذكير تلقائي للمبيعات بالليدات التي لم تُتابَع',
                trigger: 'بعد 24 ساعة من آخر تواصل',
                action: 'تنبيه للموظف المعيّن',
                color: 'bg-orange-100 text-orange-700',
              },
              {
                key: 'sms_drip',
                icon: Smartphone,
                title: 'تسلسل SMS التذكيري',
                desc: 'سلسلة رسائل SMS مجدولة للليدات غير المتحولة',
                trigger: 'بعد 3 أيام من الإضافة',
                action: 'إرسال 3 رسائل SMS خلال أسبوع',
                color: 'bg-teal-100 text-teal-700',
              },
              {
                key: 'cart_recovery',
                icon: RefreshCw,
                title: 'استرداد الطلبات المتروكة',
                desc: 'تذكير العملاء الذين بدأوا الدفع ولم يكملوا',
                trigger: 'بعد ساعة من توقف الدفع',
                action: 'رسالة استرداد + كوبون خصم',
                color: 'bg-amber-100 text-amber-700',
              },
              {
                key: 'review_request',
                icon: Star,
                title: 'طلب التقييم التلقائي',
                desc: 'طلب تقييم من العملاء بعد انتهاء الكورس',
                trigger: 'بعد 7 أيام من انتهاء الكورس',
                action: 'إرسال رابط التقييم',
                color: 'bg-yellow-100 text-yellow-700',
              },
            ].map(wf => {
              const isActive = automationToggles[wf.key];
              return (
                <div key={wf.key} className={`bg-white border rounded-2xl shadow-sm p-4 transition-all ${isActive ? 'border-gray-200' : 'border-gray-100 opacity-75'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl ${wf.color} flex items-center justify-center shrink-0`}>
                      <wf.icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-gray-800">{wf.title}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {isActive ? '● نشط' : '○ متوقف'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mb-2">{wf.desc}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Zap size={10} className="text-amber-500" /> <strong>تشغيل:</strong> {wf.trigger}</span>
                        <span className="flex items-center gap-1"><ChevronRight size={10} /> <strong>إجراء:</strong> {wf.action}</span>
                      </div>
                    </div>
                    <button onClick={() => toggleAutomation(wf.key)}
                      className={`shrink-0 w-12 h-6 rounded-full transition-all relative ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${isActive ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-gray-400 text-center p-3 bg-gray-50 rounded-xl">
            ⚠️ الأتوميشن حالياً في وضع العرض — التفعيل الفعلي يتطلب ربط خدمات الرسائل
          </div>
        </div>
      )}

      {/* ════════════════════ PERFORMANCE ════════════════════ */}
      {activeSubTab === 'performance' && (
        <div className="space-y-5">

          {/* Main KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard label="معدل تحويل الليدات" value={`${convRate}%`} sub={`${convertedLeads} تحويل`} icon={TrendingUp} color="text-green-600" bg="bg-green-50" />
            <StatCard label="متوسط إيراد/طلب" value={filteredOrders.length > 0 ? `${Math.round(totalRevenue / filteredOrders.length).toLocaleString()} ج` : '—'} sub={`${filteredOrders.length} طلب`} icon={CreditCard} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="إجمالي الإيراد" value={`${fmtK(totalRevenue)} ج`} sub="هذه الفترة" icon={BarChart3} color="text-rose-600" bg="bg-rose-50" />
            <StatCard label="مشتركين جدد" value={filteredSubs.length} sub="هذه الفترة" icon={Users} color="text-teal-600" bg="bg-teal-50" />
            <StatCard label="كوبونات نشطة" value={activeDiscounts.length} sub={`من ${discounts.length} إجمالي`} icon={Tag} color="text-purple-600" bg="bg-purple-50" />
            <StatCard label="قنوات تسويقية" value={sourceBreakdown.length} sub="مصدر مختلف" icon={Globe} color="text-amber-600" bg="bg-amber-50" />
          </div>

          {/* Source performance ranking */}
          {sourceBreakdown.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Trophy size={16} className="text-amber-500" />
                <h3 className="font-bold text-gray-800">ترتيب المصادر بالأداء</h3>
              </div>
              <div className="p-4 space-y-3">
                {sourceBreakdown.map((src, idx) => (
                  <div key={src.source} className="flex items-center gap-3">
                    <span className="text-sm w-5 text-center font-mono text-gray-400">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}.`}
                    </span>
                    <span className="text-lg">{SOURCE_ICONS[src.source] || '❓'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${SOURCE_COLORS[src.source] || 'bg-gray-100 text-gray-600 border-gray-200'} w-20 text-center`}>
                      {src.source}
                    </span>
                    <div className="flex-1">
                      <ProgressBar value={src.total} max={sourceBreakdown[0]?.total || 1} color="bg-rose-400" height="h-2.5" />
                    </div>
                    <div className="text-right text-xs w-28">
                      <span className="font-bold text-gray-700">{src.total} ليد</span>
                      <span className={`mr-2 font-semibold ${src.convRate >= 30 ? 'text-green-600' : src.convRate >= 15 ? 'text-yellow-600' : 'text-red-400'}`}>
                        {src.convRate}% ✓
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Funnel performance */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Layers size={16} className="text-rose-500" /> أداء مسار التحويل الكامل
            </h3>
            <div className="space-y-4">
              {funnel.map((step, idx) => (
                <div key={step.label} className="flex items-center gap-4">
                  <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 text-xs flex items-center justify-center font-bold shrink-0">{idx+1}</span>
                  <span className="text-sm text-gray-600 w-28">{step.label}</span>
                  <div className="flex-1">
                    <ProgressBar value={step.value} max={funnel[0].value || 1} color={step.color} height="h-4" />
                  </div>
                  <span className="text-sm font-bold text-gray-700 w-12 text-left">{step.value}</span>
                  <span className={`text-xs font-bold w-10 text-left ${step.w >= 50 ? 'text-green-600' : step.w >= 25 ? 'text-yellow-600' : 'text-red-400'}`}>
                    {step.w}%
                  </span>
                </div>
              ))}
            </div>
            {/* Drop-off analysis */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">تحليل الانسحاب</h4>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                {funnel.slice(1).map((step, idx) => {
                  const prev = funnel[idx];
                  const drop = prev.value - step.value;
                  const dropPct = pct(drop, prev.value);
                  return (
                    <div key={step.label} className="bg-red-50 rounded-xl p-2">
                      <div className="font-bold text-red-600">{drop} ({dropPct}%)</div>
                      <div className="text-gray-400 mt-0.5">انسحاب بعد {prev.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ SEGMENTATION ════════════════════ */}
      {activeSubTab === 'segmentation' && (
        <SegmentationTab leads={leads} subscribers={subscribers} notify={notify} />
      )}
    </div>
  );
};

// ── Segmentation Sub-component ────────────────────────────────────────────
const STATUS_LABEL_SEG: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_booking: 'مهتم (حجز)',
  converted: 'تم التحويل', not_interested: 'غير مهتم', no_answer: 'لا يرد', follow_up: 'متابعة',
};

const PRESET_SEGMENTS = [
  { id: 'hot', label: '🔥 ليدات ساخنة', desc: 'درجة >70 + مهتمون', filters: { minScore: 70, status: 'interested' } },
  { id: 'noAnswer', label: '📵 لا يردون', desc: 'تم التواصل بدون رد', filters: { status: 'no_answer' } },
  { id: 'new7d', label: '🆕 جدد (7 أيام)', desc: 'أضيفوا خلال أسبوع', filters: { daysNew: 7 } },
  { id: 'converted', label: '✅ تحويلات', desc: 'تم تحويلهم لعملاء', filters: { status: 'converted' } },
  { id: 'referral', label: '👥 إحالات', desc: 'مصدرهم إحالة شخصية', filters: { source: 'referral' } },
  { id: 'facebook', label: '📘 فيسبوك', desc: 'جميع ليدات فيسبوك', filters: { source: 'facebook' } },
];

function calcSegScore(lead: any): number {
  const STATUS_W: Record<string, number> = { converted: 100, interested_booking: 85, interested: 70, follow_up: 55, contacted: 40, new: 25, no_answer: 10, not_interested: 0 };
  const SOURCE_W: Record<string, number> = { facebook: 20, google: 22, referral: 25, whatsapp: 18, instagram: 17, organic: 12, tiktok: 15 };
  const createdAt = lead.createdAt || lead.created_at || '';
  const daysSince = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 999;
  const recency = daysSince <= 3 ? 15 : daysSince <= 7 ? 10 : daysSince <= 14 ? 5 : 0;
  return Math.min(100, (STATUS_W[lead.status] ?? 20) + (SOURCE_W[(lead.source || '').toLowerCase()] ?? 10) + (lead.followUpDate ? 10 : 0) + (lead.notes ? 5 : 0) + recency);
}

function SegmentationTab({ leads, notify }: { leads: any[]; subscribers: any[]; notify: NotifyFn }) {
  const [srcFilter, setSrcFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [minScore, setMinScore] = useState(0);
  const [maxDaysOld, setMaxDaysOld] = useState(0); // 0 = all
  const [searchQ, setSearchQ] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showBlast, setShowBlast] = useState(false);
  const [blastMsg, setBlastMsg] = useState('');
  const [blasting, setBlasting] = useState(false);
  const [blastResult, setBlastResult] = useState<{ sent: number; failed: number } | null>(null);

  const sources = useMemo(() => [...new Set(leads.map(l => (l.source || '').toLowerCase()))].filter(Boolean), [leads]);
  const statuses = useMemo(() => [...new Set(leads.map(l => l.status))].filter(Boolean), [leads]);

  const applyPreset = (preset: typeof PRESET_SEGMENTS[0]) => {
    setActivePreset(preset.id);
    setSrcFilter(preset.filters.source || 'all');
    setStatusFilter(preset.filters.status || 'all');
    setMinScore(preset.filters.minScore || 0);
    setMaxDaysOld(preset.filters.daysNew || 0);
    setSearchQ('');
  };

  const filtered = useMemo(() => {
    return leads
      .map(l => ({ ...l, _score: calcSegScore(l) }))
      .filter(l => {
        if (l._score < minScore) return false;
        if (statusFilter !== 'all' && l.status !== statusFilter) return false;
        if (srcFilter !== 'all' && (l.source || '').toLowerCase() !== srcFilter) return false;
        if (searchQ && !l.name?.toLowerCase().includes(searchQ.toLowerCase()) && !l.phone?.includes(searchQ)) return false;
        if (maxDaysOld > 0) {
          const ca = l.createdAt || l.created_at || '';
          const days = ca ? Math.floor((Date.now() - new Date(ca).getTime()) / 86400000) : 999;
          if (days > maxDaysOld) return false;
        }
        return true;
      });
  }, [leads, minScore, statusFilter, srcFilter, searchQ, maxDaysOld]);

  async function sendBlast() {
    if (!blastMsg.trim()) { notify('error', 'اكتب رسالة أولاً'); return; }
    setBlasting(true);
    setBlastResult(null);
    try {
      const r = await fetch('/api/admin/leads/bulk-whatsapp', {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ lead_ids: filtered.slice(0, 200).map((l: any) => l.id), message: blastMsg }),
      });
      const data = await r.json();
      if (data.ok) { setBlastResult({ sent: data.sent, failed: data.failed }); notify('success', `تم الإرسال: ${data.sent}`); }
      else notify('error', data.error || 'خطأ');
    } catch { notify('error', 'خطأ في الاتصال'); }
    finally { setBlasting(false); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-l from-teal-700 to-cyan-600 rounded-2xl p-5 text-white">
        <h3 className="font-bold text-lg flex items-center gap-2"><Layers size={20} />تقسيم الجمهور (Segmentation)</h3>
        <p className="text-teal-100 text-sm mt-1">قسّم ليداتك بمعايير متعددة وأرسل حملات مخصصة</p>
        <div className="flex gap-4 mt-3 text-sm">
          <span className="bg-white/20 rounded-xl px-3 py-1">📋 {leads.length} ليد إجمالي</span>
          <span className="bg-white/20 rounded-xl px-3 py-1">🎯 {filtered.length} في الشريحة الحالية</span>
        </div>
      </div>

      {/* Preset segments */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <h4 className="text-sm font-bold text-gray-700 mb-3">⚡ شرائح جاهزة:</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PRESET_SEGMENTS.map(ps => (
            <button key={ps.id} onClick={() => applyPreset(ps)}
              className={`text-right p-3 rounded-xl border text-sm transition hover:shadow-sm ${activePreset === ps.id ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="font-bold text-gray-800">{ps.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{ps.desc}</div>
            </button>
          ))}
          <button onClick={() => { setActivePreset(null); setSrcFilter('all'); setStatusFilter('all'); setMinScore(0); setMaxDaysOld(0); setSearchQ(''); }}
            className="text-right p-3 rounded-xl border border-dashed border-gray-300 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600">
            <div className="font-bold">🔄 إعادة تعيين</div>
            <div className="text-xs mt-0.5">عرض الكل</div>
          </button>
        </div>
      </div>

      {/* Custom filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-bold text-gray-700">🔧 فلاتر مخصصة:</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setActivePreset(null); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="all">كل الحالات</option>
            {statuses.map(s => <option key={s} value={s}>{STATUS_LABEL_SEG[s] || s}</option>)}
          </select>
          <select value={srcFilter} onChange={e => { setSrcFilter(e.target.value); setActivePreset(null); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="all">كل المصادر</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-2 col-span-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">أضيفوا خلال:</span>
            <select value={maxDaysOld} onChange={e => { setMaxDaysOld(Number(e.target.value)); setActivePreset(null); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white flex-1">
              <option value={0}>أي وقت</option>
              <option value={7}>7 أيام</option>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="🔍 بحث بالاسم أو الهاتف..."
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-teal-300" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">حد أدنى للدرجة:</span>
            <input type="range" min={0} max={100} step={10} value={minScore}
              onChange={e => { setMinScore(Number(e.target.value)); setActivePreset(null); }}
              className="w-20 accent-teal-500" />
            <span className="text-sm font-bold text-teal-600 w-8">{minScore}+</span>
          </div>
        </div>
      </div>

      {/* Segment result + action */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-gray-800">نتيجة الشريحة</h4>
            <p className="text-xs text-gray-500">{filtered.length} ليد يطابق المعايير</p>
          </div>
          <div className="flex gap-2">
            {filtered.length > 0 && (
              <button onClick={() => { setShowBlast(true); setBlastResult(null); }}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-4 py-2 rounded-xl">
                <MessageSquare size={15} />إرسال واتساب للشريحة
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الاسم</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الهاتف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الحالة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">المصدر</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500">الدرجة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.slice(0, 100).map((l: any) => (
                <tr key={l.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-semibold text-gray-800">{l.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{l.phone || '—'}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-lg text-xs">{STATUS_LABEL_SEG[l.status] || l.status}</span></td>
                  <td className="px-4 py-3 text-gray-500 text-xs capitalize">{l.source || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-bold text-sm ${l._score >= 70 ? 'text-red-600' : l._score >= 50 ? 'text-orange-600' : 'text-blue-600'}`}>{l._score}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{(l.createdAt || l.created_at || '').slice(0, 10) || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">لا توجد ليدات بهذه المعايير</td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div className="p-3 text-center text-xs text-gray-400">عرض أول 100 ليد من {filtered.length}</div>
          )}
        </div>
      </div>

      {/* WA Blast panel */}
      {showBlast && (
        <div className="bg-white border border-green-300 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-gray-800 flex items-center gap-2"><MessageSquare size={16} className="text-green-600" />إرسال واتساب للشريحة ({Math.min(filtered.length, 200)} ليد)</h4>
            <button onClick={() => setShowBlast(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <textarea rows={4} value={blastMsg} onChange={e => setBlastMsg(e.target.value)}
            placeholder="اكتب رسالتك... يمكنك استخدام {{name}} لإدراج اسم الليد"
            className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300" />
          <p className="text-xs text-gray-400">متغيرات: <code className="bg-gray-100 px-1 rounded">{'{'}{'{'} name {'}'}{'}'}</code></p>
          {blastResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm">
              ✅ تم الإرسال: <b>{blastResult.sent}</b> | فشل: <b>{blastResult.failed}</b>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setShowBlast(false)} className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            <button onClick={sendBlast} disabled={blasting || !blastMsg.trim()}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {blasting ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />جارٍ الإرسال...</> : <><Send size={14} />إرسال الآن</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarketingHubTab;

// ─── A/B Test Section Component ────────────────────────────────────────────
function AbTestSection({ leads, notify }: { leads: any[]; notify: NotifyFn }) {
  const [variantA, setVariantA] = useState('');
  const [variantB, setVariantB] = useState('');
  const [splitPct, setSplitPct] = useState(50);
  const [minScore, setMinScore] = useState(50);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sentA: number; sentB: number; total: number } | null>(null);

  const STATUS_W: Record<string, number> = { converted: 100, interested_booking: 85, interested: 70, follow_up: 55, contacted: 40, new: 25, no_answer: 10, not_interested: 0 };
  const SOURCE_W: Record<string, number> = { facebook: 20, google: 22, referral: 25, whatsapp: 18, instagram: 17, organic: 12, tiktok: 15 };
  const scoreOf = (l: any) => Math.min(100, (STATUS_W[l.status] ?? 20) + (SOURCE_W[(l.source || '').toLowerCase()] ?? 10) + (l.followUpDate ? 10 : 0) + (l.notes ? 5 : 0));

  const eligible = useMemo(() =>
    leads.filter(l => l.phone && scoreOf(l) >= minScore),
    [leads, minScore]
  );

  const groupA = eligible.slice(0, Math.floor(eligible.length * splitPct / 100));
  const groupB = eligible.slice(groupA.length);

  async function runTest() {
    if (!variantA.trim() || !variantB.trim()) { notify('error', 'أدخل النصين أولاً'); return; }
    if (eligible.length < 2) { notify('error', 'لا يوجد ليدات كافية لهذا الاختبار'); return; }
    setSending(true);
    setResult(null);
    try {
      const [rA, rB] = await Promise.all([
        fetch('/api/admin/leads/bulk-whatsapp', {
          method: 'POST', credentials: 'include',
          headers: adminAuthHeaders(true),
          body: JSON.stringify({ lead_ids: groupA.map((l: any) => l.id), message: variantA }),
        }).then(r => r.json()),
        fetch('/api/admin/leads/bulk-whatsapp', {
          method: 'POST', credentials: 'include',
          headers: adminAuthHeaders(true),
          body: JSON.stringify({ lead_ids: groupB.map((l: any) => l.id), message: variantB }),
        }).then(r => r.json()),
      ]);
      if (rA.ok && rB.ok) {
        setResult({ sentA: rA.sent, sentB: rB.sent, total: rA.sent + rB.sent });
        notify('success', `تم إرسال الاختبار: A=${rA.sent} | B=${rB.sent}`);
      } else {
        notify('error', 'خطأ في الإرسال');
      }
    } catch { notify('error', 'خطأ في الاتصال'); }
    finally { setSending(false); }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
          <Target size={20} className="text-purple-600" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800">اختبار A/B للحملات (WhatsApp)</h3>
          <p className="text-xs text-gray-500 mt-0.5">أرسل نسختين مختلفتين وقارن التفاعل</p>
        </div>
      </div>

      {/* Settings row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">حد أدنى للدرجة:</label>
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={100} step={10} value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="flex-1 accent-purple-500" />
            <span className="text-sm font-bold text-purple-600 w-8">{minScore}+</span>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">نسبة المجموعة A:</label>
          <div className="flex items-center gap-2">
            <input type="range" min={10} max={90} step={10} value={splitPct} onChange={e => setSplitPct(Number(e.target.value))} className="flex-1 accent-purple-500" />
            <span className="text-sm font-bold text-purple-600 w-10">{splitPct}%</span>
          </div>
        </div>
      </div>

      {/* Audience preview */}
      <div className="bg-purple-50 rounded-xl p-3 text-sm text-purple-800 flex flex-wrap gap-3">
        <span>📊 مؤهل: <b>{eligible.length}</b> ليد</span>
        <span>🅰️ المجموعة A: <b>{groupA.length}</b></span>
        <span>🅱️ المجموعة B: <b>{groupB.length}</b></span>
      </div>

      {/* Message variants */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-blue-600 mb-1 block">🅰️ النسخة A ({splitPct}% من الليدات)</label>
          <textarea rows={4} value={variantA} onChange={e => setVariantA(e.target.value)}
            placeholder="اكتب نص الرسالة A... (يمكن استخدام {{name}})"
            className="w-full border border-blue-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <p className="text-xs text-gray-400 mt-1">{variantA.length} حرف</p>
        </div>
        <div>
          <label className="text-xs font-bold text-green-600 mb-1 block">🅱️ النسخة B ({100 - splitPct}% من الليدات)</label>
          <textarea rows={4} value={variantB} onChange={e => setVariantB(e.target.value)}
            placeholder="اكتب نص الرسالة B... (يمكن استخدام {{name}})"
            className="w-full border border-green-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300" />
          <p className="text-xs text-gray-400 mt-1">{variantB.length} حرف</p>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4">
          <p className="font-bold text-green-800 mb-1">✅ تم إرسال الاختبار بنجاح!</p>
          <div className="grid grid-cols-3 gap-3 text-center text-sm mt-2">
            <div className="bg-blue-50 rounded-xl p-2"><div className="font-bold text-blue-700">{result.sentA}</div><div className="text-xs text-gray-500">النسخة A</div></div>
            <div className="bg-green-50 rounded-xl p-2"><div className="font-bold text-green-700">{result.sentB}</div><div className="text-xs text-gray-500">النسخة B</div></div>
            <div className="bg-gray-50 rounded-xl p-2"><div className="font-bold text-gray-700">{result.total}</div><div className="text-xs text-gray-500">إجمالي</div></div>
          </div>
          <p className="text-xs text-gray-500 mt-2">💡 تابع الردود والتحويلات خلال 24-48 ساعة لمعرفة الأفضل أداءً</p>
        </div>
      )}

      <button onClick={runTest} disabled={sending || !variantA.trim() || !variantB.trim() || eligible.length < 2}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
        {sending ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />جارٍ الإرسال...</> : <><Send size={16} />تشغيل اختبار A/B الآن</>}
      </button>
    </div>
  );
}
