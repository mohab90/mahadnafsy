import React, { useMemo, useState } from 'react';
import {
  BarChart3, Download, TrendingUp, UserCheck, BookOpen, Receipt, Star, Tag,
  Wallet, Clock, Layers, UserPlus, CalendarCheck2, MessageSquareText,
  GraduationCap, Mail, FolderKanban,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type Section   = 'all' | 'sales' | 'consultations' | 'courses' | 'bundles';
type TimeRange = 'all' | 'today' | 'yesterday' | '7d' | '30d';
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const AnalyticsTab: React.FC<Props> = () => {
  const [section,   setSection]   = useState<Section>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  const {
    orders, leads, courses, bundles, subscribers, therapists, consultations,
    communityPosts, communityVideos, communityLibraryItems, communityEvents,
    discounts, joinUsApplications, contactMessages, content,
  } = useSiteData();

  // ── Exchange rates ────────────────────────────────────────────
  const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
  const usdRate = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
  const toEGP   = (amt: number, cur: string) =>
    cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;

  // ── Date helpers ──────────────────────────────────────────────
  const now          = new Date();
  const todayStr     = now.toISOString().slice(0, 10);
  const yesterdayStr = new Date(+now - 86_400_000).toISOString().slice(0, 10);
  const days7Ago     = new Date(+now - 7  * 86_400_000).toISOString().slice(0, 10);
  const days30Ago    = new Date(+now - 30 * 86_400_000).toISOString().slice(0, 10);

  const inRange = (dateStr: string | undefined | null): boolean => {
    if (timeRange === 'all') return true;
    const d = (dateStr || '').slice(0, 10);
    if (!d) return false;
    if (timeRange === 'today')     return d === todayStr;
    if (timeRange === 'yesterday') return d === yesterdayStr;
    if (timeRange === '7d')        return d >= days7Ago;
    if (timeRange === '30d')       return d >= days30Ago;
    return true;
  };

  // ── Filtered slices ──────────────────────────────────────────
  const allPaid        = orders.filter(o => o.status === 'paid');
  const filteredOrders = allPaid.filter(o  => inRange(o.paidAt || o.createdAt));
  const filteredLeads  = leads.filter(l    => inRange(l.createdAt));
  const filteredSubs   = subscribers.filter(s => inRange(s.createdAt));
  const filteredConsts = consultations.filter(c => inRange((c as { createdAt?: string }).createdAt));
  const pendingOrders  = orders.filter(o => o.status === 'pending');

  // ── KPIs (filtered) ──────────────────────────────────────────
  const totalRevEGP = filteredOrders.reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const avgOrderAmt = filteredOrders.length > 0 ? totalRevEGP / filteredOrders.length : 0;
  const convRate    = filteredLeads.length > 0
    ? ((filteredLeads.filter(l => l.status === 'converted').length / filteredLeads.length) * 100).toFixed(1)
    : '0';
  const revByCourse  = filteredOrders.filter(o => o.type === 'course').reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const revByBundle  = filteredOrders.filter(o => o.type === 'bundle').reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const revByConsult = filteredOrders.filter(o => o.type === 'consultation').reduce((s, o) => s + toEGP(o.amount, o.currency), 0);

  // ── Monthly revenue (6 months, always full) ──────────────────
  const monthlyRevenue = useMemo(() => {
    const rows: { label: string; rev: number; orders: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ms = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const mo = allPaid.filter(o => (o.paidAt || o.createdAt || '').startsWith(ms));
      rows.push({ label: d.toLocaleString('ar-EG', { month: 'short', year: '2-digit' }), rev: mo.reduce((s, o) => s + toEGP(o.amount, o.currency), 0), orders: mo.length });
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, sarRate, usdRate]);
  const maxMonthRev = Math.max(...monthlyRevenue.map(m => m.rev), 1);

  // ── Lead funnel (filtered) ────────────────────────────────────
  const funnelStats = [
    { label: 'عملاء جدد',        count: filteredLeads.filter(l => l.status === 'new').length,       color: 'bg-blue-500',    light: 'bg-blue-50 text-blue-700' },
    { label: 'تم التواصل',       count: filteredLeads.filter(l => l.status === 'contacted').length,  color: 'bg-amber-500',   light: 'bg-amber-50 text-amber-700' },
    { label: 'تحولوا لمشتركين',  count: filteredLeads.filter(l => l.status === 'converted').length,  color: 'bg-emerald-500', light: 'bg-emerald-50 text-emerald-700' },
    { label: 'ضائعون',           count: filteredLeads.filter(l => l.status === 'lost').length,       color: 'bg-red-400',     light: 'bg-red-50 text-red-700' },
  ];
  const leadsBySource: [string, number][] = (
    Object.entries(filteredLeads.reduce((acc: Record<string, number>, l) => { const src = l.source || 'غير محدد'; acc[src] = (acc[src] || 0) + 1; return acc; }, {})) as [string, number][]
  ).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxSrc = Math.max(...leadsBySource.map(([, n]) => n), 1);

  // ── Subscriber growth ─────────────────────────────────────────
  const subsByMonth = useMemo(() => {
    const rows: { label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ms = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      rows.push({ label: d.toLocaleString('ar-EG', { month: 'short' }), count: subscribers.filter(s => (s.createdAt || '').startsWith(ms)).length });
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribers]);
  const maxSubMonth = Math.max(...subsByMonth.map(m => m.count), 1);
  const subsByBranch = subscribers.reduce((acc: Record<string, number>, s) => {
    const b = s.branch || 'غير محدد'; acc[b] = (acc[b] || 0) + 1; return acc;
  }, {});

  // ── Course stats ──────────────────────────────────────────────
  const courseStats = useMemo(() => courses.map(c => {
    const subs = subscribers.filter(s => s.enrolledCourseIds.includes(c.id));
    const rev  = allPaid.filter(o => o.type === 'course' && o.itemId === c.id).reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
    return { id: c.id, title: c.title.length > 32 ? c.title.slice(0, 32) + '…' : c.title, subs: subs.length, rev, type: c.type };
  }).sort((a, b) => b.subs - a.subs),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [courses, subscribers, orders]);
  const maxSubs = Math.max(...courseStats.map(c => c.subs), 1);

  // ── Bundle stats ──────────────────────────────────────────────
  const bundleStats = useMemo(() => bundles.map(b => {
    const enrolled = subscribers.filter(s => b.courses.some(co => s.enrolledCourseIds.includes(co.id))).length;
    const rev      = allPaid.filter(o => o.type === 'bundle' && o.itemId === b.id).reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
    return { id: b.id, title: b.title.length > 32 ? b.title.slice(0, 32) + '…' : b.title, enrolled, rev, courseCount: b.courses.length };
  }).sort((a, b) => b.enrolled - a.enrolled),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bundles, subscribers, orders]);

  // ── Therapist stats ───────────────────────────────────────────
  const therapistStats = therapists.map(t => {
    const count = consultations.filter(c => c.therapistId === t.id).length;
    const rev   = allPaid.filter(o => o.type === 'consultation' && o.itemId === t.id).reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
    return { name: t.name.length > 22 ? t.name.slice(0, 22) + '…' : t.name, count, rev, rating: t.rating || 0 };
  }).sort((a, b) => b.count - a.count).slice(0, 8);

  // ── Community, discounts, contacts ───────────────────────────
  const topTags = (Object.entries(communityPosts.reduce((acc: Record<string, number>, p) => { const tag = p.tag || 'بدون تصنيف'; acc[tag] = (acc[tag] || 0) + 1; return acc; }, {})) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const discountUsage = discounts.map(d => ({ code: d.promoCode, used: orders.filter(o => o.couponCode === d.promoCode).length, type: d.type, value: d.discountPercent })).filter(d => d.used > 0).sort((a, b) => b.used - a.used).slice(0, 6);
  const joinNew      = joinUsApplications.filter(j => j.status === 'new').length;
  const joinReviewed = joinUsApplications.filter(j => j.status === 'reviewed').length;
  const joinAccepted = joinUsApplications.filter(j => j.status === 'accepted').length;
  const contactNew   = contactMessages.filter(c => c.status === 'new').length;
  const contactRead  = contactMessages.filter(c => c.status === 'read').length;
  const contactRep   = contactMessages.filter(c => c.status === 'replied').length;

  // ── Download ──────────────────────────────────────────────────
  const esc = (v: string | number | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const timeLabel = { all: 'الكل', today: 'اليوم', yesterday: 'أمس', '7d': '7أيام', '30d': '30يوم' }[timeRange];
  const downloadReport = () => {
    let csv = ''; let filename = `تقرير-${timeLabel}-${todayStr}`;
    if (section === 'all' || section === 'sales') {
      const h = ['رقم الطلب', 'العميل', 'المبلغ', 'العملة', 'بالجنيه', 'النوع', 'البند', 'التاريخ'];
      const r = filteredOrders.map(o => [o.id?.slice(-8) || '', o.customerName || '', o.amount, o.currency, Math.round(toEGP(o.amount, o.currency)), o.type || '', o.itemTitle || '', (o.paidAt || o.createdAt || '').slice(0, 10)]);
      csv += [h, ...r].map(row => row.map(c => esc(c as string)).join(',')).join('\n');
      if (section === 'sales') filename = `مبيعات-${timeLabel}-${todayStr}`;
    }
    if (section === 'all' || section === 'consultations') {
      if (csv) csv += '\n\n';
      const h = ['العميل', 'هاتف', 'المعالج', 'الحالة', 'التاريخ'];
      const r = filteredConsts.map(c => [c.clientName || '', c.clientPhone || '', c.therapistName || '', c.status || '', ((c as { createdAt?: string }).createdAt || '').slice(0, 10)]);
      csv += [h, ...r].map(row => row.map(c => esc(c as string)).join(',')).join('\n');
      if (section === 'consultations') filename = `استشارات-${timeLabel}-${todayStr}`;
    }
    if (section === 'courses') { const h = ['الكورس', 'النوع', 'المشتركون', 'الإيراد ج.م']; const r = courseStats.map(c => [c.title, c.type, c.subs, Math.round(c.rev)]); csv = [h, ...r].map(row => row.map(c => esc(c as string)).join(',')).join('\n'); filename = `كورسات-${todayStr}`; }
    if (section === 'bundles') { const h = ['المسار', 'الكورسات', 'المشتركون', 'الإيراد ج.م']; const r = bundleStats.map(b => [b.title, b.courseCount, b.enrolled, Math.round(b.rev)]); csv = [h, ...r].map(row => row.map(c => esc(c as string)).join(',')).join('\n'); filename = `مسارات-${todayStr}`; }
    if (!csv) csv = 'لا توجد بيانات في الفترة المحددة';
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `${filename}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // ── UI config ─────────────────────────────────────────────────
  const show = (s: Section) => section === 'all' || section === s;
  const SECTIONS: { key: Section; label: string; icon: React.ElementType }[] = [
    { key: 'all',           label: 'كل شيء',    icon: BarChart3 },
    { key: 'sales',         label: 'المبيعات',   icon: Receipt },
    { key: 'consultations', label: 'الاستشارات', icon: CalendarCheck2 },
    { key: 'courses',       label: 'الكورسات',   icon: BookOpen },
    { key: 'bundles',       label: 'المسارات',   icon: FolderKanban },
  ];
  const TIME_OPTS: { key: TimeRange; label: string }[] = [
    { key: 'all', label: 'كل الوقت' }, { key: 'today', label: 'اليوم' },
    { key: 'yesterday', label: 'أمس' }, { key: '7d', label: '7 أيام' }, { key: '30d', label: '30 يوم' },
  ];

  return (
    <div className="space-y-6 animate-fade-in" dir="rtl">

      {/* HEADER: section tabs + time filter + KPIs */}
      <div className="bg-gradient-to-r from-primary-600 to-violet-600 rounded-2xl p-6 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-2xl font-extrabold flex items-center gap-2"><BarChart3 size={22} />تقارير وإحصاءات تفصيلية</h2>
          <button onClick={downloadReport} className="border border-white/30 bg-white/10 hover:bg-white/20 text-white rounded-xl px-4 py-2 text-sm font-bold flex items-center gap-2 transition">
            <Download size={15} />تحميل التقرير CSV
          </button>
        </div>
        <p className="text-white/80 text-sm mb-4">نظرة شاملة على كل جوانب المنظومة — يتم التحديث في الوقت الفعلي</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold transition ${section === s.key ? 'bg-white text-primary-700 shadow-md' : 'bg-white/15 text-white/90 hover:bg-white/25'}`}>
              <s.icon size={14} />{s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {TIME_OPTS.map(t => (
            <button key={t.key} onClick={() => setTimeRange(t.key)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition ${timeRange === t.key ? 'bg-white text-primary-700 shadow' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: `الإيراد — ${timeLabel}`,  value: Math.round(totalRevEGP).toLocaleString('ar-EG') + ' ج.م', icon: Wallet },
            { label: 'متوسط قيمة الطلب',        value: Math.round(avgOrderAmt).toLocaleString('ar-EG') + ' ج.م', icon: Receipt },
            { label: 'معدل تحويل العملاء',       value: convRate + '%',                                             icon: TrendingUp },
            { label: 'طلبات معلقة (كل الوقت)', value: pendingOrders.length,                                        icon: Clock },
          ].map(k => (
            <div key={k.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
              <k.icon size={16} className="text-white/70 mb-1" />
              <div className="text-xl font-extrabold">{k.value}</div>
              <div className="text-[11px] text-white/70 leading-tight">{k.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MONTHLY REVENUE CHART */}
      {show('sales') && (
        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><TrendingUp size={17} className="text-emerald-500" />الإيراد الشهري (آخر 6 أشهر)</h3>
          <p className="text-xs text-gray-400 mb-5">الرسم البياني يعرض دائمًا 6 أشهر كاملة بغض النظر عن فلتر الوقت</p>
          <div className="flex items-end gap-2 h-40 mb-4">
            {monthlyRevenue.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-500 font-bold">{m.rev > 0 ? Math.round(m.rev / 1000) + 'k' : '-'}</span>
                <div className="w-full rounded-t-xl bg-gradient-to-t from-primary-600 to-primary-400 transition-all duration-500"
                  style={{ height: `${(m.rev / maxMonthRev) * 120}px`, minHeight: m.rev > 0 ? '8px' : '2px' }} />
                <span className="text-[10px] text-gray-500">{m.label}</span>
                <span className="text-[9px] text-gray-400">{m.orders} طلب</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-gray-100">
            {[
              { label: 'كورسات',   amount: revByCourse,  color: 'text-cyan-600' },
              { label: 'باقات',    amount: revByBundle,  color: 'text-violet-600' },
              { label: 'استشارات', amount: revByConsult, color: 'text-blue-600' },
              { label: 'إجمالي',   amount: totalRevEGP,  color: 'text-emerald-600' },
            ].map(r => (
              <div key={r.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className={`text-lg font-extrabold ${r.color}`}>{Math.round(r.amount).toLocaleString('ar-EG')}</div>
                <div className="text-xs text-gray-500">{r.label} ({timeLabel})</div>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* LEAD FUNNEL + SOURCES */}
      {show('sales') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><Layers size={17} className="text-amber-500" />قمع المبيعات</h3>
            <p className="text-xs text-gray-400 mb-4">{timeLabel} · {filteredLeads.length} عميل</p>
            <div className="space-y-3">
              {funnelStats.map(s => (
                <div key={s.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={`px-2 py-0.5 rounded-full font-bold ${s.light}`}>{s.label}</span>
                    <span className="font-bold text-gray-700">{s.count} ({filteredLeads.length > 0 ? ((s.count / filteredLeads.length) * 100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${filteredLeads.length > 0 ? (s.count / filteredLeads.length) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t flex justify-between text-sm">
                <span className="text-gray-500">معدل التحويل</span>
                <span className="font-extrabold text-emerald-600">{convRate}%</span>
              </div>
            </div>
          </article>
          <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><UserPlus size={17} className="text-amber-500" />مصادر العملاء (Top 8)</h3>
            {leadsBySource.length === 0 ? <p className="text-gray-400 text-sm">لا توجد بيانات في الفترة المحددة.</p> : (
              <div className="space-y-2">
                {leadsBySource.map(([src, cnt]) => (
                  <div key={src}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-gray-700 font-medium truncate">{src}</span>
                      <span className="font-bold ml-2">{cnt} ({filteredLeads.length > 0 ? ((cnt / filteredLeads.length) * 100).toFixed(0) : 0}%)</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(cnt / maxSrc) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      )}

      {/* SUBSCRIBER GROWTH */}
      {show('sales') && (
        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><UserCheck size={17} className="text-emerald-500" />المشتركون الجدد شهرياً</h3>
          <p className="text-xs text-gray-400 mb-4">جديد في {timeLabel}: {filteredSubs.length} · إجمالي: {subscribers.length}</p>
          <div className="flex items-end gap-3 h-28 mb-4">
            {subsByMonth.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-500 font-bold">{m.count || '-'}</span>
                <div className="w-full rounded-t-xl bg-gradient-to-t from-emerald-500 to-emerald-300"
                  style={{ height: `${(m.count / maxSubMonth) * 80}px`, minHeight: m.count > 0 ? '6px' : '2px' }} />
                <span className="text-[10px] text-gray-500">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
            {Object.entries(subsByBranch).map(([branch, cnt]) => (
              <div key={branch} className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl px-3 py-1.5 text-xs font-bold">
                {branch}: {cnt as number}
              </div>
            ))}
          </div>
        </article>
      )}

      {/* COURSE PERFORMANCE */}
      {show('courses') && (
        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><BookOpen size={17} className="text-cyan-500" />أداء الكورسات التفصيلي</h3>
          {courseStats.length === 0 ? <p className="text-gray-400 text-sm">لا توجد كورسات.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right border-b border-gray-100 text-xs text-gray-500">
                    <th className="pb-3 font-bold">الكورس</th><th className="pb-3 font-bold text-center">النوع</th>
                    <th className="pb-3 font-bold text-center">المشتركون</th><th className="pb-3 font-bold text-left">شريط</th>
                    <th className="pb-3 font-bold text-center">الإيراد (ج.م)</th>
                  </tr>
                </thead>
                <tbody>
                  {courseStats.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-2.5 font-medium text-gray-800">{c.title}</td>
                      <td className="py-2.5 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-bold ${c.type === 'Recorded' ? 'bg-blue-50 text-blue-700' : c.type === 'Live' ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-700'}`}>{c.type === 'Recorded' ? 'مسجل' : c.type === 'Live' ? 'بث مباشر' : 'مختلط'}</span></td>
                      <td className="py-2.5 text-center font-bold text-gray-900">{c.subs}</td>
                      <td className="py-2.5 w-36"><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full" style={{ width: `${(c.subs / maxSubs) * 100}%` }} /></div></td>
                      <td className="py-2.5 text-center text-emerald-600 font-bold">{c.rev > 0 ? Math.round(c.rev).toLocaleString('ar-EG') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* BUNDLE PERFORMANCE */}
      {show('bundles') && (
        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><FolderKanban size={17} className="text-violet-500" />أداء المسارات والباقات</h3>
          {bundleStats.length === 0 ? <p className="text-gray-400 text-sm">لا توجد مسارات.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right border-b border-gray-100 text-xs text-gray-500">
                    <th className="pb-3 font-bold">المسار</th><th className="pb-3 font-bold text-center">عدد الكورسات</th>
                    <th className="pb-3 font-bold text-center">مشتركون كاملون</th><th className="pb-3 font-bold text-center">الإيراد (ج.م)</th>
                  </tr>
                </thead>
                <tbody>
                  {bundleStats.map(b => (
                    <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-2.5 font-medium text-gray-800">{b.title}</td>
                      <td className="py-2.5 text-center text-gray-500">{b.courseCount}</td>
                      <td className="py-2.5 text-center font-bold text-gray-900">{b.enrolled}</td>
                      <td className="py-2.5 text-center text-emerald-600 font-bold">{b.rev > 0 ? Math.round(b.rev).toLocaleString('ar-EG') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* CONSULTATIONS */}
      {show('consultations') && (
        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><CalendarCheck2 size={17} className="text-blue-500" />أداء المعالجين والمستشارين</h3>
          <p className="text-xs text-gray-400 mb-4">في {timeLabel}: {filteredConsts.length} · إجمالي: {consultations.length}</p>
          {therapistStats.length === 0 ? <p className="text-gray-400 text-sm">لا توجد استشارات.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right border-b border-gray-100 text-xs text-gray-500">
                    <th className="pb-3">المعالج</th><th className="pb-3 text-center">الاستشارات</th>
                    <th className="pb-3 text-center">التقييم</th><th className="pb-3 text-center">الإيراد (ج.م)</th>
                  </tr>
                </thead>
                <tbody>
                  {therapistStats.map(t => (
                    <tr key={t.name} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-2.5 font-medium text-gray-800">{t.name}</td>
                      <td className="py-2.5 text-center font-bold">{t.count}</td>
                      <td className="py-2.5 text-center">{t.rating > 0 ? <span className="flex items-center justify-center gap-1 text-amber-500 font-bold text-xs"><Star size={12} fill="currentColor" />{t.rating.toFixed(1)}</span> : '—'}</td>
                      <td className="py-2.5 text-center text-emerald-600 font-bold">{t.rev > 0 ? Math.round(t.rev).toLocaleString('ar-EG') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* COMMUNITY + JOINS + CONTACTS */}
      {show('all') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-sm"><MessageSquareText size={15} className="text-pink-500" />المجتمع النفسي</h3>
            <div className="space-y-2 text-sm">
              {[['إجمالي المنشورات', communityPosts.length], ['مقاطع الفيديو', communityVideos.length], ['مكتبة الموارد', communityLibraryItems.length], ['الفعاليات', communityEvents.length]].map(([l, v]) => (
                <div key={l as string} className="flex justify-between"><span className="text-gray-600">{l}</span><span className="font-bold">{v}</span></div>
              ))}
              {topTags.length > 0 && <div className="pt-2 border-t mt-2"><p className="text-xs text-gray-500 font-bold mb-2">التاجات:</p>{topTags.map(([tag, cnt]) => (<div key={tag} className="flex justify-between text-xs text-gray-600 mb-0.5"><span>{tag}</span><span className="font-bold">{cnt}</span></div>))}</div>}
            </div>
          </article>
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-sm"><GraduationCap size={15} className="text-violet-500" />طلبات الانضمام</h3>
            <div className="space-y-3">
              {[{l:'جديدة',c:joinNew,cl:'bg-blue-50 text-blue-700'},{l:'قيد المراجعة',c:joinReviewed,cl:'bg-amber-50 text-amber-700'},{l:'مقبولة',c:joinAccepted,cl:'bg-emerald-50 text-emerald-700'},{l:'إجمالي',c:joinUsApplications.length,cl:'bg-gray-100 text-gray-700'}].map(s => (
                <div key={s.l} className="flex justify-between items-center"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.cl}`}>{s.l}</span><span className="font-extrabold text-gray-900">{s.c}</span></div>
              ))}
            </div>
          </article>
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-sm"><Mail size={15} className="text-rose-500" />رسائل التواصل</h3>
            <div className="space-y-3">
              {[{l:'غير مقروءة',c:contactNew,cl:'bg-red-50 text-red-700'},{l:'مقروءة',c:contactRead,cl:'bg-amber-50 text-amber-700'},{l:'تم الرد',c:contactRep,cl:'bg-emerald-50 text-emerald-700'},{l:'إجمالي',c:contactMessages.length,cl:'bg-gray-100 text-gray-700'}].map(s => (
                <div key={s.l} className="flex justify-between items-center"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.cl}`}>{s.l}</span><span className="font-extrabold text-gray-900">{s.c}</span></div>
              ))}
            </div>
          </article>
        </div>
      )}

      {/* DISCOUNT USAGE */}
      {show('sales') && discountUsage.length > 0 && (
        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><Tag size={17} className="text-green-500" />استخدام كوبونات الخصم</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-right border-b border-gray-100 text-xs text-gray-500"><th className="pb-3">الكوبون</th><th className="pb-3 text-center">النوع</th><th className="pb-3 text-center">الخصم</th><th className="pb-3 text-center">مرات الاستخدام</th></tr></thead>
            <tbody>{discountUsage.map(d => (<tr key={d.code} className="border-b border-gray-50"><td className="py-2 font-bold text-primary-700">{d.code}</td><td className="py-2 text-center text-xs text-gray-500">{d.type}</td><td className="py-2 text-center font-bold">{d.value}%</td><td className="py-2 text-center font-extrabold text-emerald-600">{d.used}</td></tr>))}</tbody>
          </table>
        </article>
      )}
    </div>
  );
};

export default AnalyticsTab;
