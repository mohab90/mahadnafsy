import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import {
  Activity, AlertCircle, BarChart3, BookOpen, Briefcase,
  CalendarCheck2, Clock, CreditCard, MessageSquareText, Percent,
  Settings2, TrendingUp, UserCheck, UserPlus, Users, Wallet, X,
} from 'lucide-react';
import type { ConsultationItem, Course, LeadItem, OrderItem, StaffMember, SubscriberItem, Therapist } from '../../../types';
import { AnalyticsTab } from '../lazyTabs';
import ActionCenter from '../ActionCenter';
import { formatWaPhone } from '../dashboardShared';
import SalesOwnOverview from './overview-sections/SalesOwnOverview';
import CollectionOverview from './overview-sections/CollectionOverview';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type KpiModal = { title: string; rows: { label: string; sub?: string }[] } | null;
type OnlineUser = { uid: string; email?: string; displayName?: string; lastActiveAt: string };

interface Props {
  orders: OrderItem[];
  isSalesOnly: boolean;
  currentStaff: StaffMember | null;
  salesOwnLeads: LeadItem[];
  salesOwnSubscribers: SubscriberItem[];
  salesOwnOrders: OrderItem[];
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
  notify: NotifyFn;
  setActiveTab: (tab: string) => void;
  navigate: (path: string) => void;
}

export default function OverviewTab({
  orders, isSalesOnly, currentStaff, salesOwnLeads, salesOwnSubscribers, salesOwnOrders,
  subscribers, courses, staffMembers, leads, consultations, therapists, communityPosts, content,
  isAdmin, isOnlineManager, isCollectionRole, isReceptionDaqqi,
  onlineTeamMembers, onlineUsers,
  notify, setActiveTab, navigate,
}: Props) {
  // Org-wide collection monthly target — persisted server-side in the shared
  // sales_targets table (staff_id '__collection__') instead of localStorage, so
  // it's shared across the team and survives device changes.
  const _collMonth = new Date().toISOString().slice(0, 7);
  const [collMonthlyTarget, setCollMonthlyTarget] = useState<number>(160000);
  // A sales rep's own monthly (leads) target, from the shared sales_targets table.
  const [myMonthlyTarget, setMyMonthlyTarget] = useState<number>(10);
  useEffect(() => {
    let alive = true;
    mysqlAdmin.listSalesTargets(_collMonth).then(rows => {
      if (!alive) return;
      const list = rows as unknown as { staffId: string; revenueTarget: number; leadsTarget: number }[];
      const collRow = list.find(r => r.staffId === '__collection__');
      if (collRow && Number(collRow.revenueTarget) > 0) setCollMonthlyTarget(Number(collRow.revenueTarget));
      const myRow = currentStaff ? list.find(r => r.staffId === currentStaff.id) : null;
      if (myRow && Number(myRow.leadsTarget) > 0) setMyMonthlyTarget(Number(myRow.leadsTarget));
    }).catch(() => {});
    return () => { alive = false; };
  }, [_collMonth, currentStaff]);
  const saveCollMonthlyTarget = (val: number) => {
    if (!val || val <= 0) return;
    setCollMonthlyTarget(val);
    void mysqlAdmin.saveSalesTarget({ staffId: '__collection__', period: _collMonth, revenueTarget: val })
      .catch(() => notify('error', 'تعذّر حفظ هدف التحصيل'));
  };
  const [kpiModal, setKpiModal] = useState<KpiModal>(null); // lifted out of Dashboard god-hub
  const { totalRevenue, leadsBySource, courseEnrollments, consultsByStatus, salesStats, recentLeads, paidOrders, todayRevenue, todayNewSubscribers, todayNewLeads, monthRevenue } = useMemo(() => {
    const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
    const usdRate = parseFloat(content['exchange.usd_to_egp'] || '48') || 48;
    const toEGP = (o: { currency: string; amount: number }) =>
      o.currency === 'EGP' ? o.amount : o.currency === 'SAR' ? o.amount * sarRate : o.amount * usdRate;
    const paidOrders = orders.filter(o => o.status === 'paid');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? []).filter(p => !p.isInstallment).reduce((ps, p) => ps + toEGP(p), 0), 0);
    const leadsBySource: [string, number][] = (Object.entries(
      leads.reduce((acc: Record<string, number>, l) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {})
    ) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const courseEnrollments = courses.map(c => ({
      id: c.id,
      title: c.title.length > 26 ? c.title.slice(0, 26) + '…' : c.title,
      count: subscribers.filter(s => (s.enrolledCourseIds || []).includes(c.id)).length,
    })).sort((a, b) => b.count - a.count).slice(0, 6);
    const consultsByStatus = consultations.reduce((acc: Record<string, number>, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
    const salesStatsCalc = staffMembers.filter(s => s.role === 'sales').map(s => {
      const myLeads = leads.filter(l => l.assignedSalesId === s.id);
      const converted = myLeads.filter(l => l.status === 'converted').length;
      return { name: s.name, total: myLeads.length, converted, rate: myLeads.length > 0 ? Math.round((converted / myLeads.length) * 100) : 0 };
    });
    const seenIds = new Set<string>();
    const recentLeads = [...leads]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter(l => { if (seenIds.has(l.id)) return false; seenIds.add(l.id); return true; })
      .slice(0, 5);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRevenue = paidOrders
      .filter(o => (o.createdAt || '').slice(0, 10) === todayStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (p.at || '').slice(0, 10) === todayStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    const todayNewSubscribers = subscribers.filter(s => (s.createdAt || '').slice(0, 10) === todayStr).length;
    const todayNewLeads = leads.filter(l => (l.createdAt || '').slice(0, 10) === todayStr).length;
    const thisMonthStr = new Date().toISOString().slice(0, 7);
    const monthRevenue = paidOrders
      .filter(o => (o.createdAt || '').slice(0, 7) === thisMonthStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (p.at || '').slice(0, 7) === thisMonthStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    return { totalRevenue, leadsBySource, courseEnrollments, consultsByStatus, salesStats: salesStatsCalc, recentLeads, paidOrders, todayRevenue, todayNewSubscribers, todayNewLeads, monthRevenue };
  }, [orders, subscribers, leads, courses, staffMembers, consultations, content]);

              // ── Sales-only personal overview ───────────────────────────
  if (isSalesOnly && currentStaff) {
    return <SalesOwnOverview salesOwnLeads={salesOwnLeads} salesOwnSubscribers={salesOwnSubscribers} salesOwnOrders={salesOwnOrders} currentStaff={currentStaff} myMonthlyTarget={myMonthlyTarget} navigate={navigate} setActiveTab={setActiveTab} />;
  }
              // ── End sales-only overview ─────────────────────────────────

              // ── Collection personal overview ────────────────────────────
  if (isCollectionRole && currentStaff) {
    return <CollectionOverview salesOwnSubscribers={salesOwnSubscribers} currentStaff={currentStaff} collMonthlyTarget={collMonthlyTarget} saveCollMonthlyTarget={saveCollMonthlyTarget} navigate={navigate} />;
  }
              // ── End collection overview ─────────────────────────────────

              // ── Online Manager: collection team stats overview ──────────
              if (isOnlineManager && currentStaff) {
                const allSubsOm = salesOwnSubscribers;
                const nowOm = new Date();
                const todayStrOm = nowOm.toISOString().slice(0, 10);
                const thisMonthStrOm = nowOm.toISOString().slice(0, 7);
                const toEGPOm = (p: {amount?: number|string; currency?: string}) => {
                  const n = Number(p.amount)||0;
                  return p.currency==='SAR' ? n*13 : p.currency==='USD' ? n*50 : n;
                };
                const allPaymentsOm = allSubsOm.flatMap(s => (s.paymentHistory||[]).map(p => ({...p, subId: s.id})));
                const totalMonthRevOm = allPaymentsOm.filter(p=>(p.at||''). slice(0,7)===thisMonthStrOm).reduce((s,p)=>s+toEGPOm(p),0);
                const totalTodayRevOm = allPaymentsOm.filter(p=>(p.at||''). slice(0,10)===todayStrOm).reduce((s,p)=>s+toEGPOm(p),0);
                const totalAllRevOm   = allPaymentsOm.reduce((s,p)=>s+toEGPOm(p),0);
                const totalRemOm = allSubsOm.reduce((sum,s)=>{
                  const hist=s.paymentHistory||[];
                  const cpMap:Record<string,number>={};
                  hist.forEach(p=>{ if(p.courseId&&p.courseExpected&&!cpMap[p.courseId]) cpMap[p.courseId]=Number(p.courseExpected)||0; });
                  const exp=Object.values(cpMap).reduce((a,b)=>a+b,0);
                  const paid=hist.reduce((a,p)=>a+toEGPOm(p),0);
                  return sum+Math.max(0,exp-paid);
                },0);
                const overdueCountOm = allSubsOm.filter(s=>(s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate<todayStrOm))).length;
                const fmtMOm = (n:number) => n>=1000000 ? `${(n/1000000).toFixed(1)}M` : n>=1000 ? `${(n/1000).toFixed(0)}K` : String(Math.round(n));
                const collTeamOm = (isOnlineManager ? onlineTeamMembers : staffMembers).filter(s => (s.role||'').toLowerCase() === 'collection');
                const thisWeekStartOm = (() => { const d=new Date(nowOm); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
                const memberStatsOm = collTeamOm.map(m => {
                  const mLeads = salesOwnLeads.filter(l => l.assignedSalesId === m.id || l.assignedCsId === m.id || l.assignedSalesName === m.name);
                  const mSubIds = new Set(mLeads.map(l=>l.id));
                  const mSubs = allSubsOm.filter(s => s.leadId && mSubIds.has(s.leadId));
                  const mAllPayments = allSubsOm.flatMap(s=>(s.paymentHistory||[]).filter(p=>p.staffId===m.id||p.staffName===m.name).map(p=>({...p})));
                  const mMonthRev = mAllPayments.filter(p=>(p.at||''). slice(0,7)===thisMonthStrOm).reduce((s,p)=>s+toEGPOm(p),0);
                  const mWeekRev  = mAllPayments.filter(p=>(p.at||''). slice(0,10)>=thisWeekStartOm).reduce((s,p)=>s+toEGPOm(p),0);
                  const mTodayRev = mAllPayments.filter(p=>(p.at||''). slice(0,10)===todayStrOm).reduce((s,p)=>s+toEGPOm(p),0);
                  const mRem = mSubs.reduce((sum,s)=>{
                    const hist=s.paymentHistory||[];
                    const cpMap:Record<string,number>={};
                    hist.forEach(p=>{ if(p.courseId&&p.courseExpected&&!cpMap[p.courseId]) cpMap[p.courseId]=Number(p.courseExpected)||0; });
                    const exp=Object.values(cpMap).reduce((a,b)=>a+b,0);
                    const paid=hist.reduce((a,p)=>a+toEGPOm(p),0);
                    return sum+Math.max(0,exp-paid);
                  },0);
                  const mOverdue = mSubs.filter(s=>(s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate<todayStrOm))).length;
                  const allComms = mLeads.flatMap(l=>(l.communications||[]).map(c=>({...c})));
                  const callsToday  = allComms.filter(c=>c.type==='call'&&(c.date||'').slice(0,10)===todayStrOm).length;
                  const callsWeek   = allComms.filter(c=>c.type==='call'&&(c.date||'').slice(0,10)>=thisWeekStartOm).length;
                  const callsMonth  = allComms.filter(c=>c.type==='call'&&(c.date||'').slice(0,7)===thisMonthStrOm).length;
                  return { member: m, subs: mSubs.length, monthRev: mMonthRev, weekRev: mWeekRev, todayRev: mTodayRev, remaining: mRem, overdue: mOverdue, callsToday, callsWeek, callsMonth };
                });
                return (
                  <div className="space-y-5 w-full" dir="rtl">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'إيراد اليوم', value: `${fmtMOm(totalTodayRevOm)} ج`, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: TrendingUp },
                        { label: 'إيراد الشهر', value: `${fmtMOm(totalMonthRevOm)} ج`, bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: BarChart3 },
                        { label: 'إجمالي الإيراد', value: `${fmtMOm(totalAllRevOm)} ج`, bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', icon: Wallet },
                        { label: 'متأخر السداد', value: overdueCountOm, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: Clock },
                        { label: 'عملاء الأونلاين', value: allSubsOm.length, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: UserCheck },
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
                      const last30Om = Array.from({length:30},(_,i)=>{
                        const d=new Date(nowOm); d.setDate(d.getDate()-29+i);
                        const ds=d.toISOString().slice(0,10);
                        return { day: ds.slice(5), rev: allPaymentsOm.filter(p=>(p.at||'').slice(0,10)===ds).reduce((s,p)=>s+toEGPOm(p),0) };
                      });
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
                              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative" title={`${d.day}: ${d.rev.toLocaleString()} ج.م`}>
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
                      allSubsOm.forEach(s => {
                        (s.enrolledCourseIds||[]).forEach(cid => {
                          const title = courses.find(c=>c.id===cid)?.title || cid;
                          if (!courseCountMap[cid]) courseCountMap[cid] = {title, count:0};
                          courseCountMap[cid].count++;
                        });
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
                const allSubs = salesOwnSubscribers;
                const now3 = new Date();
                const todayStr3 = now3.toISOString().slice(0, 10);
                const thisMonthStr3 = now3.toISOString().slice(0, 7);
                const thisWeekStart3 = (() => { const d=new Date(now3); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
                const allPayments3 = allSubs.flatMap(s => (s.paymentHistory||[]).map(p => ({...p, subId: s.id})));
                const todayRev3  = allPayments3.filter(p=>(p.at||'').slice(0,10)===todayStr3).reduce((s,p)=>s+(Number(p.amount)||0),0);
                const weekRev3   = allPayments3.filter(p=>(p.at||'').slice(0,10)>=thisWeekStart3).reduce((s,p)=>s+(Number(p.amount)||0),0);
                const monthRev3  = allPayments3.filter(p=>(p.at||'').slice(0,7)===thisMonthStr3).reduce((s,p)=>s+(Number(p.amount)||0),0);
                const totalRem3  = allSubs.reduce((sum,s)=>{
                  const hist=s.paymentHistory||[];
                  const cpMap:Record<string,number>={};
                  hist.forEach(p=>{ if(p.courseId&&p.courseExpected&&!cpMap[p.courseId]) cpMap[p.courseId]=Number(p.courseExpected)||0; });
                  const exp=Object.values(cpMap).reduce((a,b)=>a+b,0);
                  const paid=hist.reduce((a,p)=>a+(Number(p.amount)||0),0);
                  return sum+Math.max(0,exp-paid);
                },0);
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

              const newLeads = leads.filter(l => l.status === 'new').length;
              const contactedLeads = leads.filter(l => l.status === 'contacted').length;
              const convertedLeads = leads.filter(l => l.status === 'converted').length;
              const maxSource = Math.max(...leadsBySource.map(([,n]) => n), 1);
              const maxEnroll = Math.max(...courseEnrollments.map(c => c.count), 1);
              const daqqiClients = subscribers.filter(s => s.branch === 'daqqi');
              const kpiCards: { title: string; value: string | number; icon: React.ElementType; bg: string; text: string; border: string; onDetail: () => void }[] = [
                {
                  title: 'العملاء', value: subscribers.length, icon: UserCheck, bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200',
                  onDetail: () => setKpiModal({ title: 'العملاء (آخر 50)', rows: subscribers.slice(0, 50).map(s => ({ label: s.name || s.email || '', sub: `${s.branch || '—'} · ${(s.enrolledCourseIds || []).length} كورس` })) }),
                },
                {
                  title: 'عملاء الدقي', value: daqqiClients.length, icon: UserCheck, bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200',
                  onDetail: () => setKpiModal({ title: 'عملاء فرع الدقي', rows: daqqiClients.map(s => ({ label: s.name || s.email || '', sub: s.phone || s.email || '' })) }),
                },
                {
                  title: 'العملاء المحتملون', value: leads.length, icon: UserPlus, bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200',
                  onDetail: () => setKpiModal({ title: 'العملاء المحتملون', rows: leads.slice(0, 50).map((l: any) => ({ label: l.name || l.email || '', sub: `${l.source || ''} · ${l.status || ''}` })) }),
                },
                {
                  title: 'الاستشارات', value: consultations.length, icon: CalendarCheck2, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200',
                  onDetail: () => setKpiModal({ title: 'الاستشارات', rows: (consultations as any[]).slice(0, 50).map(c => ({ label: c.clientName || c.client_name || '', sub: `${c.sessionDate || c.session_date || ''} · ${c.status || ''}` })) }),
                },
                {
                  title: 'الطلبات المكتملة', value: paidOrders.length, icon: CreditCard, bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200',
                  onDetail: () => setKpiModal({ title: 'الطلبات المكتملة', rows: paidOrders.slice(0, 50).map((o: any) => ({ label: o.subscriberName || o.subscriber_name || o.name || '', sub: `${Number(o.amount || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م · ${String(o.date || '').slice(0, 10)}` })) }),
                },
                {
                  title: 'الكورسات', value: courses.length, icon: BookOpen, bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200',
                  onDetail: () => setKpiModal({ title: 'الكورسات', rows: [...courses].sort((a: any, b: any) => (b.enrolledCount || 0) - (a.enrolledCount || 0)).map((c: any) => ({ label: c.title || '', sub: `${c.enrolledCount || 0} مسجل` })) }),
                },
                {
                  title: 'المحاضرون', value: therapists.length, icon: Users, bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200',
                  onDetail: () => setKpiModal({ title: 'المحاضرون', rows: (therapists as any[]).map(t => ({ label: t.name || '', sub: t.specialty || '' })) }),
                },
                {
                  title: 'منشورات المجتمع', value: communityPosts.length, icon: MessageSquareText, bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200',
                  onDetail: () => setKpiModal({ title: 'منشورات المجتمع', rows: (communityPosts as any[]).slice(0, 30).map(p => ({ label: p.authorName || p.author_name || 'مجهول', sub: String(p.content || '').slice(0, 60) })) }),
                },
                {
                  title: 'الإيراد التقريبي (ج.م)', value: totalRevenue.toLocaleString('ar-EG-u-nu-latn'), icon: BarChart3, bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200',
                  onDetail: () => setKpiModal({ title: 'تفاصيل الإيراد', rows: [
                    { label: 'إجمالي المدفوعات', sub: `${totalRevenue.toLocaleString('ar-EG-u-nu-latn')} ج.م` },
                    { label: 'عدد الطلبات المكتملة', sub: String(paidOrders.length) },
                    { label: 'متوسط قيمة الطلب', sub: paidOrders.length ? `${Math.round(totalRevenue / paidOrders.length).toLocaleString('ar-EG-u-nu-latn')} ج.م` : '0' },
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
                        { label: 'عملاء أونلاين اليوم', value: String(todayNewSubscribers), color: 'from-violet-500 to-purple-600' },
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
                      {leadsBySource.length === 0 ? <p className="text-gray-400 text-sm">لا توجد بيانات بعد.</p> : (
                        <div className="space-y-3">
                          {leadsBySource.map(([source, count]) => (
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
                              <span className="text-sm font-bold text-gray-700">{s.count} ({leads.length > 0 ? Math.round((s.count / leads.length) * 100) : 0}%)</span>
                            </div>
                            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full ${s.color} rounded-full`} style={{ width: `${leads.length > 0 ? (s.count / leads.length) * 100 : 0}%` }} />
                            </div>
                          </div>
                        ))}
                        <div className="pt-3 border-t border-gray-100 flex justify-between text-sm">
                          <span className="text-gray-500">معدل التحويل</span>
                          <span className="font-bold text-emerald-600">{leads.length > 0 ? Math.round((convertedLeads / leads.length) * 100) : 0}%</span>
                        </div>
                      </div>
                    </article>
                  </div>

                  {/* Charts Row 2 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Courses by Enrollment */}
                    <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><BookOpen size={17} className="text-cyan-500" />أكثر الكورسات تسجيلاً</h3>
                      {courseEnrollments.every(c => c.count === 0) ? <p className="text-gray-400 text-sm">لا توجد تسجيلات بعد.</p> : (
                        <div className="space-y-3">
                          {courseEnrollments.map(course => (
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
                        {salesStats.length === 0 ? <p className="text-xs text-gray-400">لا يوجد موظفو مبيعات بعد.</p> : (
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
                                {salesStats.map(s => (
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
                    {recentLeads.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">لا توجد بيانات بعد.</p> : (
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
                            {recentLeads.map(lead => (
                              <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                <td className="py-2.5 pr-2 font-medium text-gray-800">{lead.name}</td>
                                <td className="py-2.5 text-gray-500 text-xs">{lead.phone}</td>
                                <td className="py-2.5 text-gray-500 text-xs">{lead.source}</td>
                                <td className="py-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${lead.status === 'new' ? 'bg-blue-50 text-blue-700' : lead.status === 'contacted' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                    {lead.status === 'new' ? 'جديد' : lead.status === 'contacted' ? 'تم التواصل' : 'محول'}
                                  </span>
                                </td>
                                <td className="py-2.5 text-gray-400 text-xs">{lead.createdAt}</td>
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
                    <Suspense fallback={<div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>}>
                      <AnalyticsTab notify={notify} />
                    </Suspense>
                  </div>
                </div>
              );

}