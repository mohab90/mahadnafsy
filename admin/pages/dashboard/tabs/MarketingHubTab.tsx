import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Megaphone, Users, TrendingUp, Mail, Filter, Tag, Bell, Zap, BarChart3,
  UserPlus, CheckCircle, Percent, CreditCard, Layers, Receipt,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import {
  type NotifyFn, type TimeRange, type SubTab, type AbandonedCart,
  inRange, pct, fmtK, getLast7Days,
} from './marketing-hub-sections/shared';
import { OverviewSection } from './marketing-hub-sections/OverviewSection';
import { LeadsSection } from './marketing-hub-sections/LeadsSection';
import { DiscountsSection } from './marketing-hub-sections/DiscountsSection';
import { CampaignsSection } from './marketing-hub-sections/CampaignsSection';
import { NotificationsSection } from './marketing-hub-sections/NotificationsSection';
import { AutomationSection } from './marketing-hub-sections/AutomationSection';
import { AbandonedCartsSection } from './marketing-hub-sections/AbandonedCartsSection';
import { PerformanceSection } from './marketing-hub-sections/PerformanceSection';
import { SegmentationSection } from './marketing-hub-sections/SegmentationSection';

interface Props { notify: NotifyFn; }

// ══════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════
const MarketingHubTab: React.FC<Props> = ({ notify }) => {
  const { leads, subscribers, orders, discounts, notifications, joinUsApplications } = useSiteData();

  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [abandonedCarts, setAbandonedCarts] = useState<AbandonedCart[]>([]);
  const [abandonedLoading, setAbandonedLoading] = useState(false);
  useEffect(() => {
    if (activeSubTab !== 'abandoned') return;
    setAbandonedLoading(true);
    mysqlAdmin.listAbandonedCheckouts(2)
      .then(r => setAbandonedCarts((r as unknown as AbandonedCart[]) || []))
      .catch(() => {})
      .finally(() => setAbandonedLoading(false));
  }, [activeSubTab]);
  const [automationToggles, setAutomationToggles] = useState<Record<string, boolean>>({
    welcome_lead: true, converted_msg: true, followup_reminder: true,
    sms_drip: false, cart_recovery: false, review_request: true,
  });

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
        const relatedOrders = filteredOrders.filter(o => o.leadId === l.id || o.customerEmail === l.email);
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
    setAutomationToggles(prev => {
      const next = { ...prev, [key]: !prev[key] };
      notify('success', `${next[key] ? 'تم تفعيل' : 'تم إيقاف'} الأتوميشن`);
      return next;
    });
  }, [notify]);

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
    { key: 'abandoned', label: 'السلات المتروكة', icon: Receipt },
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
        <OverviewSection
          filteredLeadsCount={filteredLeads.length}
          convRate={convRate}
          convertedLeads={convertedLeads}
          filteredSubsCount={filteredSubs.length}
          totalRevenue={totalRevenue}
          filteredOrdersCount={filteredOrders.length}
          leadsChartData={leadsChartData}
          revenueChartData={revenueChartData}
          convChartData={convChartData}
          sourceBreakdown={sourceBreakdown}
          funnel={funnel}
          activeDiscounts={activeDiscounts}
          notifications={notifications}
        />
      )}

      {/* ════════════════════ LEADS ════════════════════ */}
      {activeSubTab === 'leads' && (
        <LeadsSection
          filteredLeads={filteredLeads}
          leadsChartData={leadsChartData}
          convChartData={convChartData}
          sourceBreakdown={sourceBreakdown}
        />
      )}

      {/* ════════════════════ DISCOUNTS ════════════════════ */}
      {activeSubTab === 'discounts' && (
        <DiscountsSection
          discounts={discounts}
          activeDiscounts={activeDiscounts}
          totalDiscountUsage={totalDiscountUsage}
          discountAnalytics={discountAnalytics}
          notify={notify}
        />
      )}

      {/* ════════════════════ CAMPAIGNS ════════════════════ */}
      {activeSubTab === 'campaigns' && (
        <CampaignsSection joinUsApplications={joinUsApplications} leads={leads} notify={notify} />
      )}

      {/* ════════════════════ NOTIFICATIONS ════════════════════ */}
      {activeSubTab === 'notifications_tab' && (
        <NotificationsSection notifications={notifications} subscribers={subscribers} />
      )}

      {/* ════════════════════ AUTOMATION ════════════════════ */}
      {activeSubTab === 'automation' && (
        <AutomationSection automationToggles={automationToggles} toggleAutomation={toggleAutomation} />
      )}

      {/* ════════════════════ ABANDONED CARTS ════════════════════ */}
      {activeSubTab === 'abandoned' && (
        <AbandonedCartsSection abandonedCarts={abandonedCarts} abandonedLoading={abandonedLoading} />
      )}

      {/* ════════════════════ PERFORMANCE ════════════════════ */}
      {activeSubTab === 'performance' && (
        <PerformanceSection
          convRate={convRate}
          convertedLeads={convertedLeads}
          filteredOrdersCount={filteredOrders.length}
          totalRevenue={totalRevenue}
          filteredSubsCount={filteredSubs.length}
          discounts={discounts}
          activeDiscounts={activeDiscounts}
          sourceBreakdown={sourceBreakdown}
          funnel={funnel}
        />
      )}

      {/* ════════════════════ SEGMENTATION ════════════════════ */}
      {activeSubTab === 'segmentation' && (
        <SegmentationSection leads={leads} subscribers={subscribers} notify={notify} />
      )}
    </div>
  );
};

export default MarketingHubTab;
