import React, { Suspense, useEffect, useRef, useState } from 'react';
import { cairoDateOnly, cairoMonthOnly, cairoDateTime, cairoDay, cairoDaysAgo, cairoWeekStart, cairoDaysAhead, cairoMonthProgress } from '../../../../shared/cairoDate';
import {
  Activity, AlertCircle, BarChart3, BookOpen, Briefcase,
  CalendarCheck2, Clock, CreditCard, MessageSquareText, Percent,
  Settings2, TrendingUp, UserCheck, UserPlus, Users, Wallet, X,
} from 'lucide-react';
import type { ConsultationItem, Course, LeadItem, OrderItem, StaffMember, SubscriberItem, Therapist } from '../../../types';
import { Navigate } from 'react-router-dom';
import { AnalyticsTab } from '../lazyTabs';
import { useStaffOverview } from '../useStaffOverview';
import { formatWaPhone } from '../dashboardShared';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSubscriberStats } from '../hooks/useSubscriberStats';
import { useCrmData, useStaticData } from '../../../context/siteDataSlices';
import { clientItems } from '../../../lib/agreedPrice';
import type { TabKey } from '../navigation';
import { isCollected, toEgp } from '../../../lib/money';
import { CAIRO_TIME_ZONE } from '../../../../shared/cairoDate';
import { isOpenLeadStatus } from '../../../../shared/leadStatuses';
import { cardRows, enrollmentsFromStats, salesFromStats, sourcesFromStats, statusCounts, useNewestLeads, type ModalRow } from './overview/overviewFigures';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type OverviewStats = {
  totalRevenue: number;
  leadsBySource: [string, number][];
  courseEnrollments: { id: string; title: string; count: number }[];
  consultsByStatus: Record<string, number>;
  salesStats: { name: string; total: number; converted: number; rate: number }[];
  recentLeads: LeadItem[];
  paidOrders: OrderItem[];
  todayRevenue: number;
  todayNewSubscribers: number;
  todayNewLeads: number;
  monthRevenue: number;
  /** Paid payments in the books; null until they answer. */
  paidCount: number | null;
};

type KpiModal = { title: string; rows: { label: string; sub?: string }[] } | null;
type OnlineUser = { uid: string; email?: string; displayName?: string; lastActiveAt: string };
type CommunityPostSummary = { id: string; authorName?: string; author_name?: string; content?: string };
type OverviewOrder = OrderItem & { subscriberName?: string; subscriber_name?: string; name?: string; date?: string };

interface Props {
  overviewStats: OverviewStats;
  isSalesOnly: boolean;
  currentStaff: StaffMember | null;
  subscribers: SubscriberItem[];
  courses: Course[];
  staffMembers: StaffMember[];
  leads: LeadItem[];
  consultations: ConsultationItem[];
  therapists: Therapist[];
  communityPosts: { id: string }[];
  content: Record<string, string>;
  isAdmin: boolean;
  isOnlineManager: boolean;
  isCollectionRole: boolean;
  isReceptionDaqqi: boolean;
  onlineTeamMembers: StaffMember[];
  onlineUsers: OnlineUser[];
  kpiModal: KpiModal;
  setKpiModal: (m: KpiModal) => void;
  notify: NotifyFn;
  setActiveTab: (tab: TabKey) => void;
  navigate: (path: string) => void;
}

export default function OverviewTab({
  overviewStats, isSalesOnly, currentStaff,
  subscribers, courses, staffMembers, leads, consultations, therapists, communityPosts, 
  isAdmin, isOnlineManager, isCollectionRole, isReceptionDaqqi,
  onlineTeamMembers, onlineUsers, kpiModal, setKpiModal,
  notify, setActiveTab, navigate,
}: Props) {
  const { bundles } = useStaticData();
  // The collection officer's, the online manager's and the Dokki reception's own figures come from the server.
  const staffOverview = useStaffOverview(
    isOnlineManager ? 'online_manager' : 'own',
    Boolean(currentStaff) && (isCollectionRole || isOnlineManager || isReceptionDaqqi),
  );
              // The headline lead figure and the percentages under it describe
              // the whole table, so they come from the database aggregate rather
              // than from however much of the array is loaded. Falls back to the
              // array while the aggregate is in flight — see LeadStats.
              const { leadStats } = useCrmData();
              const leadTotal = leadStats?.total ?? leads.length;
              // Same reasoning for the client tiles, and the same fix: this
              // dashboard is not one of the screens that loads the subscriber
              // table, so subscribers.length is the size of the first page —
              // 500 — not the number of clients. It read 500 against a real
              // 1,361.
              //
              // It used to correct itself: the two-minute background poll
              // re-fetched every subscriber unconditionally, so the tile was
              // wrong for two minutes and right afterwards. That poll now only
              // refreshes a table the session actually loaded, which is what
              // stopped the CRM re-downloading 26,878 leads on a timer — and it
              // left this tile permanently on 500.
              const subscriberStats = useSubscriberStats(true);
              const subscriberTotal = subscriberStats?.total ?? subscribers.length;
              const targetPeriod = cairoMonthOnly();
              // The collection target is read for the «تقدمك نحو هدف التحصيل
              // الشهري» section, which only renders for a collection role (see
              // the isCollectionRole branch below). The fetch was not scoped to
              // it: it ran for everyone who opened الرئيسية, and
              // GET /api/admin/sales-targets needs view_leads — which HR, the
              // accountant, trainers, experts, instructors and «موظف» do not
              // hold. Six roles got a red «تعذر تحميل هدف التحصيل الشهري» every
              // single time they opened the dashboard, about a number their
              // screen never shows.
              const needsCollectionTarget = isCollectionRole || isAdmin || isOnlineManager;
              const [collectionMonthlyTarget, setCollectionMonthlyTarget] = useState(160000);
              useEffect(() => {
                if (!needsCollectionTarget) return;
                mysqlAdmin.listSalesTargets(targetPeriod).then((rows) => {
                  const target = rows.find((row) => row.staffId === '__collection__');
                  if (target) setCollectionMonthlyTarget(Math.max(1, Number(target.revenueTarget) || 160000));
                }).catch(() => {
                  // The default of 160,000 stands. Nothing here is actionable by
                  // the person reading it, so it does not become a toast.
                });
              }, [needsCollectionTarget, targetPeriod]);

              const { totalRevenue, leadsBySource, courseEnrollments, consultsByStatus, salesStats, recentLeads, paidOrders, todayRevenue, todayNewSubscribers, todayNewLeads, monthRevenue } = overviewStats;

              // The 500 newest leads, clients and orders are not loaded for this
              // screen any more (admin siteLists.ts, 11 Oct 2026). Its figures come
              // from the aggregates — whole-table, where the arrays were the first
              // page — and each card's list is fetched when the card is opened.
              const generalView = !isSalesOnly && !isCollectionRole;
              const newestLeads = useNewestLeads(leads, generalView);
              const [showDetailedReports, setShowDetailedReports] = useState(false);
              const openModalTitle = useRef<string | null>(null);
              useEffect(() => { openModalTitle.current = kpiModal?.title ?? null; }, [kpiModal]);
              const openFetched = (title: string, load: () => Promise<ModalRow[]>) => {
                setKpiModal({ title, rows: [{ label: 'جاري التحميل…' }] });
                load()
                  .then(rows => { if (openModalTitle.current === title) setKpiModal({ title, rows: rows.length ? rows : [{ label: 'مفيش بيانات' }] }); })
                  .catch(() => { if (openModalTitle.current === title) setKpiModal({ title, rows: [{ label: 'تعذر التحميل — جرّب تاني' }] }); });
              };

              // ── A sales rep's own figures are his landing page (StaffHomeTab) ──
              if (isSalesOnly && currentStaff) return <Navigate to="/dashboard/staff_home" replace />;

              // ── Collection personal overview ────────────────────────────
              if (isCollectionRole && currentStaff) {
                const now2 = new Date();
                const ov = staffOverview;
                const onlineSubs = { length: ov?.clients ?? 0 };
                // What was collected and what is owed, added up by the server (GET /api/staff/overview-summary).
                const collTodayRevOv  = ov?.money.today ?? 0;
                const collWeekRevOv   = ov?.money.week ?? 0;
                const collMonthRevOv  = ov?.money.month ?? 0;
                const collTotalRemOv  = ov?.money.remaining ?? 0;
                // Organization collection target loaded from the tenant sales-target record.
                const collMonthlyTarget = collectionMonthlyTarget;
                const collPct = Math.min(100, Math.round((collMonthRevOv / collMonthlyTarget) * 100));
                const { daysInMonth: daysInMonthOv, dayOfMonth: dayOfMonthOv } = cairoMonthProgress(now2);
                const daysLeftOv = daysInMonthOv - dayOfMonthOv;
                const dailyPaceOv = collMonthRevOv / Math.max(1, dayOfMonthOv);
                const projectedOv = Math.round(dailyPaceOv * daysInMonthOv);
                // Overdue & due today
                const overdueInstSubs = { length: ov?.installments.overdue.count ?? 0, rows: ov?.installments.overdue.rows ?? [] };
                const dueTodaySubs = { length: ov?.installments.dueToday.count ?? 0, rows: ov?.installments.dueToday.rows ?? [] };
                const dueThisWeekSubs = { length: ov?.installments.dueWeek ?? 0 };
                // Estimate uses the employee's configured commission rate; no browser-local assumption.
                const commissionRate = Math.max(0, Number(currentStaff.commissionRate || 0)) / 100;
                const estCommission = Math.round(collMonthRevOv * commissionRate);
                const commissionTarget = Math.round(collMonthlyTarget * commissionRate);
                const fmtM = (n:number) => n>=1000000 ? `${(n/1000000).toFixed(1)}M` : n>=1000 ? `${(n/1000).toFixed(0)}K` : String(Math.round(n));
                // Monthly collection by day (last 30 days)
                const last30 = (ov?.last30 ?? []).map(d => ({ day: d.day.slice(8), rev: d.rev }));
                const maxDay = Math.max(...last30.map(d=>d.rev),1);
                const motivOv =
                  collPct>=100 ? { text:'🏆 حققت الهدف الشهري! أداء استثنائي!', cls:'from-yellow-400 to-amber-500' } :
                  collPct>=75  ? { text:'🔥 أنت على بُعد خطوة من الهدف!', cls:'from-emerald-500 to-green-600' } :
                  collPct>=50  ? { text:'💪 أكثر من النصف! واصل الضغط!', cls:'from-blue-500 to-indigo-600' } :
                  collPct>=25  ? { text:'⚡ بداية قوية — حافظ على الزخم!', cls:'from-violet-500 to-purple-600' } :
                               { text:'🚀 كل تحصيل يقربك من الـ 160 ألف!', cls:'from-teal-500 to-cyan-600' };
                const circR = 54; const circC = 2*Math.PI*circR;
                const circDash = circC - (collPct/100)*circC;
                return (
                  <div className="space-y-4 w-full" dir="rtl">
                    {/* Hero banner */}
                    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${motivOv.cls} p-5 text-white shadow-xl`}>
                      <div className="absolute inset-0 opacity-10" style={{backgroundImage:'radial-gradient(circle at 20% 80%, white 1px, transparent 1px)',backgroundSize:'25px 25px'}} />
                      <div className="relative flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full border-4 border-white/30 bg-white/20 flex items-center justify-center flex-shrink-0 text-2xl font-extrabold">
                          {(currentStaff.name||'?').charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white/70">مرحباً يا</div>
                          <div className="text-xl font-extrabold truncate">{currentStaff.name}</div>
                          <div className="text-xs text-white/70 mt-0.5">مسؤول التحصيل · {onlineSubs.length} عميل أونلاين</div>
                        </div>
                        <div className="text-left flex-shrink-0">
                          <div className="text-xs text-white/70">تحصيل اليوم</div>
                          <div className="text-2xl font-black">{fmtM(collTodayRevOv)} ج</div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm font-bold">{motivOv.text}</div>
                    </div>
                    {/* 8 KPI tiles */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label:'تحصيل اليوم',     value:`${fmtM(collTodayRevOv)} ج`,   sub:'مدفوعات اليوم',         icon:'📅', cls:'border-emerald-200 bg-emerald-50 text-emerald-800' },
                        { label:'تحصيل الأسبوع',  value:`${fmtM(collWeekRevOv)} ج`,   sub:'هذا الأسبوع',            icon:'📆', cls:'border-blue-200 bg-blue-50 text-blue-800' },
                        { label:'تحصيل الشهر',    value:`${fmtM(collMonthRevOv)} ج`,  sub:`من هدف ${fmtM(collMonthlyTarget)} ج`, icon:'💰', cls:'border-violet-200 bg-violet-50 text-violet-800' },
                        { label:'متبقي في الشيت', value:`${fmtM(collTotalRemOv)} ج`,  sub:'إجمالي مديونيات',        icon:'⏳', cls:'border-red-200 bg-red-50 text-red-800' },
                        { label:'عمولة تقديرية', value:`${fmtM(estCommission)} ج`, sub: commissionRate ? `هدف العمولة ${fmtM(commissionTarget)} ج` : 'لا توجد نسبة عمولة معتمدة', icon:'💎', cls:'border-amber-200 bg-amber-50 text-amber-800' },
                        { label:'أقساط متأخرة',   value:overdueInstSubs.length,        sub:'عميل متأخر',             icon:'🔴', cls:'border-red-200 bg-red-50 text-red-800' },
                        { label:'مستحق اليوم',    value:dueTodaySubs.length,           sub:'عميل مستحق',             icon:'🟡', cls:'border-amber-200 bg-amber-50 text-amber-800' },
                        { label:'مستحق هذا الأسبوع', value:dueThisWeekSubs.length,     sub:'خلال 7 أيام',            icon:'📋', cls:'border-cyan-200 bg-cyan-50 text-cyan-800' },
                      ].map(m=>(
                        <div key={m.label} className={`border rounded-xl p-3 ${m.cls}`}>
                          <div className="text-lg mb-0.5">{m.icon}</div>
                          <div className="text-xl font-extrabold leading-tight">{m.value}</div>
                          <div className="text-[10px] font-medium opacity-60">{m.sub}</div>
                          <div className="text-xs font-bold mt-1">{m.label}</div>
                        </div>
                      ))}
                    </div>
                    {/* Target progress */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={18} className="text-teal-600" />
                        <h3 className="font-extrabold text-gray-900">تقدمك نحو هدف التحصيل الشهري</h3>
                        <span className="mr-auto text-xs text-gray-400">{now2.toLocaleDateString('ar-EG-u-nu-latn',{month:'long',year:'numeric', timeZone: CAIRO_TIME_ZONE })}</span>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="relative flex-shrink-0 w-28 h-28">
                          <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                            <circle cx="64" cy="64" r={circR} fill="none" stroke="#e5e7eb" strokeWidth="10" />
                            <circle cx="64" cy="64" r={circR} fill="none"
                              stroke={collPct>=100?'#f59e0b':collPct>=75?'#10b981':collPct>=50?'#3b82f6':'#8b5cf6'}
                              strokeWidth="10" strokeLinecap="round"
                              strokeDasharray={circC} strokeDashoffset={circDash}
                              style={{transition:'stroke-dashoffset 1s ease'}} />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-black text-gray-900">{collPct}%</span>
                            <span className="text-[10px] text-gray-400">من الهدف</span>
                          </div>
                        </div>
                        <div className="flex-1 space-y-3">
                          <div>
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                              <span>المحصَّل: <strong className="text-gray-800">{fmtM(collMonthRevOv)} ج</strong></span>
                              <span>الهدف: <strong className="text-gray-800">{fmtM(collMonthlyTarget)} ج</strong></span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                              <div className="h-3 rounded-full transition-all duration-1000" style={{
                                width:`${collPct}%`,
                                background: collPct>=100?'linear-gradient(90deg,#f59e0b,#d97706)':collPct>=75?'linear-gradient(90deg,#10b981,#059669)':collPct>=50?'linear-gradient(90deg,#3b82f6,#2563eb)':'linear-gradient(90deg,#8b5cf6,#7c3aed)'
                              }} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                              <div className="text-gray-400">معدل التحصيل اليومي</div>
                              <div className="font-bold text-gray-800">{fmtM(dailyPaceOv)} ج / يوم</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                              <div className="text-gray-400">التوقع بنهاية الشهر</div>
                              <div className={`font-bold ${projectedOv>=collMonthlyTarget?'text-emerald-600':'text-amber-600'}`}>{fmtM(projectedOv)} ج</div>
                            </div>
                          </div>
                          {collPct < 100 && (
                            <div className="text-xs text-gray-500 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                              💡 تحتاج <strong className="text-teal-700">{fmtM(collMonthlyTarget-collMonthRevOv)} ج</strong> إضافي خلال {daysLeftOv} يوم
                              {daysLeftOv>0 && ` — أي ${fmtM((collMonthlyTarget-collMonthRevOv)/daysLeftOv)} ج / يوم`}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Daily chart (last 30 days) */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                      <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4"><span className="text-lg">📊</span>التحصيلات اليومية (آخر 30 يوم)</h3>
                      <div className="flex items-end gap-0.5 h-24">
                        {last30.map((d,i)=>(
                          <div key={i} className="flex-1 flex flex-col items-center" title={`${d.day}: ${d.rev.toLocaleString('ar-EG-u-nu-latn')} ج`}>
                            <div className="w-full rounded-t-sm transition-all duration-500"
                              style={{height:`${Math.max(2,(d.rev/maxDay)*88)}px`, background: d.rev>0 ? (i===last30.length-1?'#10b981':'#6366f1') : '#e5e7eb', opacity: d.rev===0?0.3:1}} />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                        <span>{last30[0]?.day}</span><span>{last30[14]?.day}</span><span>{last30[29]?.day}</span>
                      </div>
                    </div>
                    {/* Overdue installments */}
                    {overdueInstSubs.length > 0 && (
                      <article className="bg-red-50 border border-red-200 rounded-2xl p-4 shadow-sm">
                        <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
                          <Clock size={16} className="text-red-600" />🔴 أقساط متأخرة ({overdueInstSubs.length} عميل)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {overdueInstSubs.rows.map(s=>{
                            const nd={date:s.date,amount:s.amount,cur:s.currency};
                            const cf=(c:string)=>c==='SAR'?'ر.س':c==='USD'?'$':'ج';
                            return (
                              <button key={s.id} onClick={()=>navigate(`/client/${s.clientCode||s.id}`)}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-red-100 text-red-700 border-red-300 hover:opacity-80">
                                {s.name}{nd&&<span className="opacity-70 mr-1">({nd.amount.toLocaleString('ar-EG-u-nu-latn')} {cf(nd.cur)} — {nd.date})</span>}
                              </button>
                            );
                          })}
                          {overdueInstSubs.length>20&&<span className="text-xs text-red-600 font-bold">+ {overdueInstSubs.length-20} أخرى</span>}
                        </div>
                      </article>
                    )}
                    {dueTodaySubs.length > 0 && (
                      <article className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm">
                        <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
                          <Clock size={16} className="text-amber-600" />🟡 أقساط مستحقة اليوم ({dueTodaySubs.length} عميل)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {dueTodaySubs.rows.map(s=>{
                            const nd={date:s.date,amount:s.amount,cur:s.currency};
                            const cf=(c:string)=>c==='SAR'?'ر.س':c==='USD'?'$':'ج';
                            return (
                              <button key={s.id} onClick={()=>navigate(`/client/${s.clientCode||s.id}`)}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-amber-100 text-amber-700 border-amber-300 hover:opacity-80">
                                {s.name}{nd&&<span className="opacity-70 mr-1">({nd.amount.toLocaleString('ar-EG-u-nu-latn')} {cf(nd.cur)})</span>}
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    )}
                    {/* Monthly target setting */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Settings2 size={15} className="text-gray-400" />إعداد هدف التحصيل الشهري</h3>
                      <div className="flex items-center gap-3">
                        <input type="number" defaultValue={collMonthlyTarget} readOnly={!isAdmin && !isOnlineManager}
                          onBlur={async e => {
                            if (!isAdmin && !isOnlineManager) return;
                            const value = Math.max(1, Number(e.target.value) || 160000);
                            try {
                              await mysqlAdmin.saveSalesTarget({ staffId: '__collection__', period: targetPeriod, revenueTarget: value });
                              setCollectionMonthlyTarget(value);
                              notify('success', 'تم حفظ هدف التحصيل في قاعدة البيانات');
                            } catch {
                              notify('error', 'تعذر حفظ هدف التحصيل');
                            }
                          }}
                          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-teal-300 read-only:bg-gray-50 read-only:text-gray-500" placeholder="160000" dir="ltr" />
                        <span className="text-xs text-gray-500">ج.م / شهر</span>
                        <span className="text-xs text-gray-400">{isAdmin || isOnlineManager ? '(يُحفظ في قاعدة البيانات عند المغادرة)' : '(يحدده المدير)'}</span>
                      </div>
                    </div>
                  </div>
                );
              }
              // ── End collection overview ─────────────────────────────────

              // ── Online Manager: collection team stats overview ──────────
              if (isOnlineManager && currentStaff) {
                // The server adds it all up (GET /api/staff/overview-summary?kind=online_manager): the money, the instalments,
                // the clients and each collection officer's calls, collections, clients, balance and overdue instalments.
                const ovm = staffOverview;
                const totalMonthRevOm = ovm?.money.month ?? 0;
                const totalTodayRevOm = ovm?.money.today ?? 0;
                const totalAllRevOm   = ovm?.money.total ?? 0;
                const totalRemOm      = ovm?.money.remaining ?? 0;
                const overdueCountOm  = ovm?.installments.overdue.count ?? 0;
                const fmtMOm = (n:number) => n>=1000000 ? `${(n/1000000).toFixed(1)}M` : n>=1000 ? `${(n/1000).toFixed(0)}K` : String(Math.round(n));
                const memberStatsOm = (ovm?.team ?? []).map(m => ({
                  member: { id: m.id, name: m.name, role: m.role }, subs: m.subs, monthRev: m.monthRev, weekRev: m.weekRev, todayRev: m.todayRev,
                  remaining: m.remaining, overdue: m.overdue, callsToday: m.callsToday, callsWeek: m.callsWeek, callsMonth: m.callsMonth,
                }));
                const collTeamOm = memberStatsOm.map(entry => entry.member);
                return (
                  <div className="space-y-5 w-full" dir="rtl">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'إيراد اليوم', value: `${fmtMOm(totalTodayRevOm)} ج`, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: TrendingUp },
                        { label: 'إيراد الشهر', value: `${fmtMOm(totalMonthRevOm)} ج`, bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: BarChart3 },
                        { label: 'إجمالي الإيراد', value: `${fmtMOm(totalAllRevOm)} ج`, bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', icon: Wallet },
                        { label: 'متأخر السداد', value: overdueCountOm, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: Clock },
                        { label: 'عملاء الأونلاين', value: ovm?.clients ?? 0, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: UserCheck },
                        { label: 'المتبقي من الأقساط', value: `${fmtMOm(totalRemOm)} ج`, bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: CreditCard },
                        { label: 'عدد الكورسات', value: courses.length, bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', icon: BookOpen },
                        { label: 'فريق التحصيل', value: collTeamOm.length, bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: Users },
                      ].map((kpi, i) => {
                        const Icon = kpi.icon;
                        return (
                          <div key={i} className={`${kpi.bg} border ${kpi.border} rounded-2xl p-4 flex items-center gap-3`}>
                            <div className={`w-10 h-10 rounded-xl ${kpi.bg} ${kpi.text} grid place-items-center border ${kpi.border}`}><Icon size={18} /></div>
                            <div><p className="text-xs text-gray-500">{kpi.label}</p><p className={`text-lg font-extrabold ${kpi.text}`}>{kpi.value}</p></div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
                        <Users size={18} className="text-violet-600" />
                        <h3 className="font-bold text-gray-900">أداء فريق التحصيل</h3>
                        <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-bold">{collTeamOm.length} موظف</span>
                      </div>
                      {collTeamOm.length === 0 ? (
                        <div className="text-center py-10 text-gray-400 text-sm">لا يوجد موظفو تحصيل</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs min-w-[900px]" dir="rtl">
                            <thead className="bg-gray-50 border-b border-gray-100">
                              <tr>
                                <th className="text-right px-4 py-3 font-bold text-gray-600" rowSpan={2}>الموظف</th>
                                <th className="text-center px-3 py-2 font-bold text-gray-600 border-l border-gray-200" colSpan={3}>📞 المكالمات</th>
                                <th className="text-center px-3 py-2 font-bold text-gray-600 border-l border-gray-200" colSpan={3}>💰 التحصيل</th>
                                <th className="text-center px-3 py-2 font-bold text-gray-600 border-l border-gray-200">عملاء</th>
                                <th className="text-center px-3 py-2 font-bold text-gray-600 border-l border-gray-200">المتبقي</th>
                                <th className="text-center px-3 py-2 font-bold text-gray-600">متأخر</th>
                              </tr>
                              <tr>
                                <th className="text-center px-2 py-1.5 text-[10px] text-blue-600 font-bold border-l border-gray-100">اليوم</th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-blue-600 font-bold border-l border-gray-100">الأسبوع</th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-blue-600 font-bold border-l border-gray-200">الشهر</th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-emerald-600 font-bold border-l border-gray-100">اليوم</th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-emerald-600 font-bold border-l border-gray-100">الأسبوع</th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-emerald-600 font-bold border-l border-gray-200">الشهر</th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-gray-500 font-bold border-l border-gray-200"></th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-orange-500 font-bold border-l border-gray-200"></th>
                                <th className="text-center px-2 py-1.5 text-[10px] text-red-500 font-bold"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {memberStatsOm.sort((a,b) => b.monthRev - a.monthRev).map(({ member, subs, monthRev, weekRev, todayRev, remaining, overdue, callsToday, callsWeek, callsMonth }) => (
                                <tr key={member.id} className="hover:bg-gray-50 transition">
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 grid place-items-center text-sm font-bold flex-shrink-0">{member.name.charAt(0)}</div>
                                      <div>
                                        <p className="font-semibold text-gray-900 text-xs">{member.name}</p>
                                        <p className="text-[10px] text-gray-400">{member.role}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-center border-l border-gray-100"><span className={`font-extrabold text-sm ${callsToday > 0 ? 'text-blue-700' : 'text-gray-300'}`}>{callsToday}</span></td>
                                  <td className="px-3 py-3 text-center border-l border-gray-100"><span className="font-bold text-blue-600">{callsWeek}</span></td>
                                  <td className="px-3 py-3 text-center border-l border-gray-200"><span className="font-bold text-blue-500">{callsMonth}</span></td>
                                  <td className="px-3 py-3 text-center border-l border-gray-100"><span className={`font-extrabold text-sm ${todayRev > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>{todayRev > 0 ? `${fmtMOm(todayRev)} ج` : '—'}</span></td>
                                  <td className="px-3 py-3 text-center border-l border-gray-100"><span className="font-bold text-emerald-600">{weekRev > 0 ? `${fmtMOm(weekRev)} ج` : '—'}</span></td>
                                  <td className="px-3 py-3 text-center border-l border-gray-200"><span className="font-bold text-emerald-500">{monthRev > 0 ? `${fmtMOm(monthRev)} ج` : '—'}</span></td>
                                  <td className="px-3 py-3 text-center border-l border-gray-200 font-bold text-blue-700">{subs}</td>
                                  <td className="px-3 py-3 text-center border-l border-gray-200 font-bold text-orange-600">{fmtMOm(remaining)} ج</td>
                                  <td className="px-3 py-3 text-center">{overdue > 0 ? <span className="bg-red-100 text-red-700 font-bold text-xs px-2 py-0.5 rounded-full">{overdue}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                              <tr>
                                <td className="px-4 py-3 font-extrabold text-gray-700 text-xs">الإجمالي</td>
                                <td className="px-3 py-3 text-center font-extrabold text-blue-800 border-l border-gray-100">{memberStatsOm.reduce((s,m)=>s+m.callsToday,0)}</td>
                                <td className="px-3 py-3 text-center font-bold text-blue-700 border-l border-gray-100">{memberStatsOm.reduce((s,m)=>s+m.callsWeek,0)}</td>
                                <td className="px-3 py-3 text-center font-bold text-blue-600 border-l border-gray-200">{memberStatsOm.reduce((s,m)=>s+m.callsMonth,0)}</td>
                                <td className="px-3 py-3 text-center font-extrabold text-emerald-800 border-l border-gray-100">{fmtMOm(memberStatsOm.reduce((s,m)=>s+m.todayRev,0))} ج</td>
                                <td className="px-3 py-3 text-center font-bold text-emerald-700 border-l border-gray-100">{fmtMOm(memberStatsOm.reduce((s,m)=>s+m.weekRev,0))} ج</td>
                                <td className="px-3 py-3 text-center font-bold text-emerald-600 border-l border-gray-200">{fmtMOm(memberStatsOm.reduce((s,m)=>s+m.monthRev,0))} ج</td>
                                <td className="px-3 py-3 text-center font-bold text-blue-700 border-l border-gray-200">{memberStatsOm.reduce((s,m)=>s+m.subs,0)}</td>
                                <td className="px-3 py-3 text-center font-bold text-orange-600 border-l border-gray-200">{fmtMOm(memberStatsOm.reduce((s,m)=>s+m.remaining,0))} ج</td>
                                <td className="px-3 py-3 text-center font-bold text-red-600">{memberStatsOm.reduce((s,m)=>s+m.overdue,0)||'—'}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* ── Revenue trend: last 30 days ── */}
                    {(() => {
                      const last30Om = (ovm?.last30 ?? []).map(d => ({ day: d.day.slice(5), rev: d.rev }));
                      const maxDayOm = Math.max(...last30Om.map(d=>d.rev),1);
                      return (
                        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
                          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <BarChart3 size={16} className="text-teal-600" />
                            إيراد آخر 30 يوم
                            <span className="text-xs text-gray-400 font-normal mr-auto">إجمالي: {fmtMOm(totalAllRevOm)} ج.م</span>
                          </h3>
                          <div className="flex items-end gap-0.5 h-24 w-full">
                            {last30Om.map((d,i) => (
                              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative" title={`${d.day}: ${d.rev.toLocaleString('ar-EG-u-nu-latn')} ج.م`}>
                                <div className="w-full rounded-t-sm bg-teal-400 group-hover:bg-teal-600 transition-colors"
                                  style={{height: `${Math.round((d.rev/maxDayOm)*96)}%`, minHeight: d.rev>0?'2px':'0'}} />
                                {i%5===0 && <span className="text-[8px] text-gray-400 absolute -bottom-4 whitespace-nowrap">{d.day}</span>}
                              </div>
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-5">
                            <span>منذ 30 يوم</span><span>اليوم</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Course enrollment distribution ── */}
                    {(() => {
                      const courseCountMap: Record<string, {title:string; count:number}> = {};
                      Object.entries(ovm?.courseCounts ?? {}).forEach(([cid, count]) => {
                        courseCountMap[cid] = { title: courses.find(c=>c.id===cid)?.title || cid, count };
                      });
                      const topCourses = Object.values(courseCountMap).sort((a,b)=>b.count-a.count).slice(0,8);
                      if (topCourses.length === 0) return null;
                      const maxC = Math.max(...topCourses.map(x=>x.count),1);
                      return (
                        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
                          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <BookOpen size={16} className="text-indigo-600" />
                            توزيع الاشتراكات على الكورسات
                          </h3>
                          <div className="space-y-2">
                            {topCourses.map((c,i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 truncate w-36 shrink-0 text-right">{c.title}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-3">
                                  <div className="bg-indigo-400 h-3 rounded-full" style={{width:`${Math.round((c.count/maxC)*100)}%`}} />
                                </div>
                                <span className="text-xs font-bold text-indigo-700 w-6 text-left shrink-0">{c.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              }
              // ── End online manager overview ────────────────────────────

              // ── Reception Daqqi personal overview ───────────────────────
              if (isReceptionDaqqi && currentStaff) {
                const ovr = staffOverview;
                const allSubs = { length: ovr?.clients ?? 0 };
                const todayRev3 = ovr?.money.today ?? 0;
                const weekRev3 = ovr?.money.week ?? 0;
                const monthRev3 = ovr?.money.month ?? 0;
                const totalRem3 = ovr?.money.remaining ?? 0;
                const fmtR = (n: number) => n>=1000 ? `${(n/1000).toFixed(1)}K` : String(Math.round(n));
                return (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-orange-600 to-orange-400 rounded-2xl p-5 text-white">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-white/20 rounded-xl grid place-items-center flex-shrink-0">
                          <UserCheck size={24} />
                        </div>
                        <div>
                          <div className="text-sm text-white/80">مرحباً،</div>
                          <div className="text-xl font-extrabold">{currentStaff.name}</div>
                          <div className="text-xs text-white/70">ريسبشن الدقي</div>
                        </div>
                        <div className="mr-auto text-left">
                          <div className="text-xs text-white/70">إجمالي عملاء الدقي</div>
                          <div className="text-3xl font-black">{allSubs.length}</div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label:'تحصيل اليوم',   value:`${fmtR(todayRev3)} ج`,  icon:'📅', cls:'border-emerald-200 bg-emerald-50 text-emerald-800' },
                        { label:'تحصيل الأسبوع', value:`${fmtR(weekRev3)} ج`,   icon:'📆', cls:'border-blue-200 bg-blue-50 text-blue-800' },
                        { label:'تحصيل الشهر',   value:`${fmtR(monthRev3)} ج`,  icon:'💰', cls:'border-violet-200 bg-violet-50 text-violet-800' },
                        { label:'المتبقي',        value:`${fmtR(totalRem3)} ج`,  icon:'⏳', cls:'border-red-200 bg-red-50 text-red-800' },
                      ].map(m=>(
                        <div key={m.label} className={`border rounded-xl p-4 ${m.cls}`}>
                          <div className="text-2xl mb-1">{m.icon}</div>
                          <div className="text-xl font-extrabold">{m.value}</div>
                          <div className="text-xs font-bold mt-1 opacity-70">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              // ── End reception_daqqi overview ────────────────────────────

              const { newLeads, contactedLeads, convertedLeads } = statusCounts(leadStats, leads);
              const sourceRows = leadStats?.bySource ? sourcesFromStats(leadStats.bySource) : leadsBySource;
              const salesRows = leadStats?.byOwner ? salesFromStats(staffMembers, leadStats.byOwner) : salesStats;
              const enrollmentRows = subscriberStats?.byCourse ? enrollmentsFromStats(courses, subscriberStats.byCourse) : courseEnrollments;
              const newestRows = newestLeads ?? recentLeads;
              const todayClients = subscriberStats?.createdToday ?? todayNewSubscribers;
              const paidCount = overviewStats.paidCount ?? paidOrders.length;
              const maxSource = Math.max(...sourceRows.map(([,n]) => n), 1);
              const maxEnroll = Math.max(...enrollmentRows.map(c => c.count), 1);
              // branch is stored upper case — 'DAQQI' — so this comparison
              // never matched and the tile has always read 0. There are 11.
              // The count comes from the aggregate for the same reason as the
              // total above; the array is still what the detail list shows,
              // since that only ever displayed what was loaded.
              const daqqiClients = subscribers.filter(s => String(s.branch || '').toUpperCase() === 'DAQQI');
              const daqqiTotal = subscriberStats?.byBranch?.DAQQI ?? daqqiClients.length;
              const kpiCards: { title: string; value: string | number; icon: React.ElementType; bg: string; text: string; border: string; onDetail: () => void }[] = [
                {
                  title: 'العملاء', value: subscriberTotal, icon: UserCheck, bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200',
                  onDetail: () => openFetched('العملاء (آخر 50)', () => cardRows.subscribers()),
                },
                {
                  title: 'عملاء الدقي', value: daqqiTotal, icon: UserCheck, bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200',
                  onDetail: () => openFetched('عملاء فرع الدقي (آخر 50)', () => cardRows.subscribers('DAQQI')),
                },
                {
                  title: 'العملاء المحتملون', value: leadTotal, icon: UserPlus, bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200',
                  onDetail: () => openFetched('العملاء المحتملون (آخر 50)', () => cardRows.leads()),
                },
                {
                  title: 'الاستشارات', value: consultations.length, icon: CalendarCheck2, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200',
                  onDetail: () => setKpiModal({ title: 'الاستشارات', rows: consultations.slice(0, 50).map(c => ({ label: c.clientName || '', sub: `${c.sessionDate || ''} · ${c.status || ''}` })) }),
                },
                {
                  title: 'الطلبات المكتملة', value: paidCount, icon: CreditCard, bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200',
                  onDetail: () => openFetched('الطلبات المكتملة (آخر 50)', () => cardRows.paidOrders()),
                },
                {
                  title: 'الكورسات', value: courses.length, icon: BookOpen, bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200',
                  onDetail: () => setKpiModal({ title: 'الكورسات', rows: [...courses].sort((a, b) => (b.students || 0) - (a.students || 0)).map(c => ({ label: c.title || '', sub: `${c.students || 0} مسجل` })) }),
                },
                {
                  title: 'المحاضرون', value: therapists.length, icon: Users, bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200',
                  onDetail: () => setKpiModal({ title: 'المحاضرون', rows: therapists.map(t => ({ label: t.name || '', sub: t.specialty || '' })) }),
                },
                {
                  title: 'منشورات المجتمع', value: communityPosts.length, icon: MessageSquareText, bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200',
                  onDetail: () => setKpiModal({ title: 'منشورات المجتمع', rows: (communityPosts as CommunityPostSummary[]).slice(0, 30).map(p => ({ label: p.authorName || p.author_name || 'مجهول', sub: String(p.content || '').slice(0, 60) })) }),
                },
                {
                  title: 'الإيراد التقريبي (ج.م)', value: totalRevenue.toLocaleString('ar-EG-u-nu-latn'), icon: BarChart3, bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200',
                  onDetail: () => setKpiModal({ title: 'تفاصيل الإيراد', rows: [
                    { label: 'إجمالي المدفوعات', sub: `${totalRevenue.toLocaleString('ar-EG-u-nu-latn')} ج.م` },
                    { label: 'عدد الطلبات المكتملة', sub: String(paidCount) },
                    { label: 'متوسط قيمة الطلب', sub: paidCount ? `${Math.round(totalRevenue / paidCount).toLocaleString('ar-EG-u-nu-latn')} ج.م` : '0' },
                  ] }),
                },
                ...(isAdmin ? [{
                  title: 'عملاء متصلون الآن', value: onlineUsers.length, icon: Activity, bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200',
                  onDetail: () => setKpiModal({ title: 'عملاء متصلون الآن', rows: onlineUsers.length === 0 ? [{ label: 'لا يوجد عملاء متصلون حالياً' }] : onlineUsers.map(u => ({ label: u.displayName || u.email || u.uid, sub: u.email || '' })) }),
                }] : []),
              ];
              return (
                <div className="space-y-6">
                  {/* ── Today's snapshot (admin only) ── */}
                  {isAdmin && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'إيراد اليوم', value: `${Math.round(todayRevenue).toLocaleString('ar-EG-u-nu-latn')} ج`, color: 'from-emerald-500 to-teal-600' },
                        { label: 'إيراد الشهر', value: `${Math.round(monthRevenue / 1000)}K ج`, color: 'from-blue-500 to-indigo-600' },
                        { label: 'عملاء أونلاين اليوم', value: String(todayClients), color: 'from-violet-500 to-purple-600' },
                        { label: 'عملاء محتملون اليوم', value: String(todayNewLeads), color: 'from-amber-500 to-orange-600' },
                      ].map(w => (
                        <div key={w.label} className={`bg-gradient-to-br ${w.color} rounded-2xl p-4 text-white shadow-md`}>
                          <p className="text-xs font-medium opacity-80 mb-1">{w.label}</p>
                          <p className="text-2xl font-extrabold">{w.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                    {kpiCards.map(item => {
                      const Icon = item.icon;
                      return (
                        <article key={item.title} onClick={item.onDetail}
                          className={`bg-white border ${item.border} rounded-2xl p-5 shadow-sm flex items-center gap-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all`}>
                          <div className={`w-12 h-12 rounded-2xl ${item.bg} flex items-center justify-center flex-shrink-0`}>
                            <Icon size={22} className={item.text} />
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 leading-tight">{item.title}</p>
                            <h3 className="text-2xl font-extrabold text-gray-900 mt-0.5">{item.value}</h3>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {/* KPI Detail Modal */}
                  {kpiModal && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setKpiModal(null)}>
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                          <h3 className="font-extrabold text-gray-900 text-lg">{kpiModal.title}</h3>
                          <button onClick={() => setKpiModal(null)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
                          {kpiModal.rows.map((row, i) => (
                            <div key={i} className="px-5 py-3">
                              <p className="text-sm font-semibold text-gray-800 leading-snug">{row.label}</p>
                              {row.sub && <p className="text-xs text-gray-500 mt-0.5">{row.sub}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Charts Row 1 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Leads by Source */}
                    <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><UserPlus size={17} className="text-amber-500" />توزيع العملاء حسب المصدر</h3>
                      {sourceRows.length === 0 ? <p className="text-gray-400 text-sm">لا توجد بيانات بعد.</p> : (
                        <div className="space-y-3">
                          {sourceRows.map(([source, count]) => (
                            <div key={source}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-700 font-medium truncate">{source}</span>
                                <span className="font-bold text-gray-900 ml-2">{count}</span>
                              </div>
                              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(count / maxSource) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>

                    {/* Leads by Status */}
                    <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><BarChart3 size={17} className="text-primary-500" />حالة العملاء المحتملين</h3>
                      <div className="space-y-4">
                        {[
                          { label: 'جديد', count: newLeads, color: 'bg-blue-500', pill: 'bg-blue-50 text-blue-700' },
                          { label: 'تم التواصل', count: contactedLeads, color: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' },
                          { label: 'تحول لمشترك', count: convertedLeads, color: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700' },
                        ].map(s => (
                          <div key={s.label}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.pill}`}>{s.label}</span>
                              <span className="text-sm font-bold text-gray-700">{s.count} ({leadTotal > 0 ? Math.round((s.count / leadTotal) * 100) : 0}%)</span>
                            </div>
                            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full ${s.color} rounded-full`} style={{ width: `${leadTotal > 0 ? (s.count / leadTotal) * 100 : 0}%` }} />
                            </div>
                          </div>
                        ))}
                        <div className="pt-3 border-t border-gray-100 flex justify-between text-sm">
                          <span className="text-gray-500">معدل التحويل</span>
                          <span className="font-bold text-emerald-600">{leadTotal > 0 ? Math.round((convertedLeads / leadTotal) * 100) : 0}%</span>
                        </div>
                      </div>
                    </article>
                  </div>

                  {/* Charts Row 2 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Courses by Enrollment */}
                    <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><BookOpen size={17} className="text-cyan-500" />أكثر الكورسات تسجيلاً</h3>
                      {enrollmentRows.every(c => c.count === 0) ? <p className="text-gray-400 text-sm">لا توجد تسجيلات بعد.</p> : (
                        <div className="space-y-3">
                          {enrollmentRows.map(course => (
                            <div key={course.id}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-700 font-medium truncate">{course.title}</span>
                                <span className="font-bold text-gray-900 ml-2">{course.count}</span>
                              </div>
                              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${(course.count / maxEnroll) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>

                    {/* Right column: Consultations + Sales */}
                    <div className="space-y-4">
                      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2 text-sm"><CalendarCheck2 size={15} className="text-blue-500" />حالات الاستشارات</h3>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: 'pending', label: 'في الانتظار', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                            { key: 'confirmed', label: 'مؤكدة', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                            { key: 'completed', label: 'مكتملة', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                            { key: 'cancelled', label: 'ملغاة', color: 'bg-red-50 text-red-700 border-red-200' },
                          ].map(s => (
                            <div key={s.key} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold ${s.color}`}>
                              <span>{s.label}</span>
                              <span className="bg-white/70 rounded-full w-6 h-6 flex items-center justify-center text-gray-700 font-extrabold">{consultsByStatus[s.key] || 0}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2 text-sm"><Briefcase size={15} className="text-violet-500" />أداء فريق المبيعات</h3>
                        {salesRows.length === 0 ? <p className="text-xs text-gray-400">لا يوجد موظفو مبيعات بعد.</p> : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 border-b">
                                  <th className="text-right pb-2">الموظف</th>
                                  <th className="text-center pb-2">العملاء</th>
                                  <th className="text-center pb-2">محولون</th>
                                  <th className="text-center pb-2">معدل</th>
                                </tr>
                              </thead>
                              <tbody>
                                {salesRows.map(s => (
                                  <tr key={s.name} className="border-b border-gray-50">
                                    <td className="py-2 font-medium text-gray-700 truncate max-w-[100px]">{s.name}</td>
                                    <td className="py-2 text-center">{s.total}</td>
                                    <td className="py-2 text-center text-emerald-600 font-bold">{s.converted}</td>
                                    <td className="py-2 text-center">
                                      <span className={`px-2 py-0.5 rounded-full font-bold ${s.rate >= 50 ? 'bg-emerald-50 text-emerald-700' : s.rate >= 20 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{s.rate}%</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </article>
                    </div>
                  </div>

                  {/* Recent Leads */}
                  <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-gray-900 flex items-center gap-2"><UserPlus size={17} className="text-amber-500" />آخر العملاء المحتملين</h3>
                      <button onClick={() => setActiveTab('leads')} className="text-primary-600 text-sm font-bold hover:underline">عرض الكل</button>
                    </div>
                    {newestRows.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">لا توجد بيانات بعد.</p> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-right text-gray-500 border-b text-xs">
                              <th className="pb-2 pr-2">الاسم</th>
                              <th className="pb-2">الهاتف</th>
                              <th className="pb-2">المصدر</th>
                              <th className="pb-2">الحالة</th>
                              <th className="pb-2">التاريخ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {newestRows.map(lead => (
                              <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                <td className="py-2.5 pr-2 font-medium text-gray-800">{lead.name}</td>
                                <td className="py-2.5 text-gray-500 text-xs">{lead.phone}</td>
                                <td className="py-2.5 text-gray-500 text-xs">{lead.source}</td>
                                <td className="py-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${lead.status === 'new' ? 'bg-blue-50 text-blue-700' : lead.status === 'contacted' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                    {lead.status === 'new' ? 'جديد' : lead.status === 'contacted' ? 'تم التواصل' : 'محول'}
                                  </span>
                                </td>
                                <td className="py-2.5 text-gray-400 text-xs">{cairoDateTime(lead.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>

                  {/* ── التقارير التفصيلية ── */}
                  <div className="border-t-2 border-dashed border-gray-200 pt-6">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-1 h-8 bg-gradient-to-b from-primary-500 to-violet-500 rounded-full" />
                      <h2 className="text-xl font-extrabold text-gray-900">التقارير والإحصاءات التفصيلية</h2>
                    </div>
                    {/* They count the newest clients, leads and orders in the browser,
                        so they load them — on request, not with الرئيسية. */}
                    {showDetailedReports ? (
                      <Suspense fallback={<div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>}>
                        <AnalyticsTab notify={notify} />
                      </Suspense>
                    ) : (
                      <button type="button" onClick={() => setShowDetailedReports(true)}
                        className="w-full rounded-2xl border border-dashed border-primary-300 bg-primary-50/40 py-6 text-sm font-bold text-primary-700 hover:bg-primary-50">
                        اعرض التقارير التفصيلية
                      </button>
                    )}
                  </div>
                </div>
              );

}
