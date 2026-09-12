import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Phone, Mail, BarChart3, Activity, CreditCard, Settings, ChevronRight, Clock, Trash2, LayoutDashboard, MessageSquare, ListChecks, Trophy } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { toDialable } from '../lib/whatsappLink';
import { isCollected } from '../lib/money';
import { mysqlAdmin } from '../lib/mysqlapi';
import StaffTimelineChart from './staff-profile/StaffTimelineChart';
import StaffTodayStrip from './staff-profile/StaffTodayStrip';
import StaffRankCard from './staff-profile/StaffRankCard';
import StaffAchievements from './staff-profile/StaffAchievements';
import StaffMessagesPanel from './staff-profile/StaffMessagesPanel';
import StaffTasksPanel from './staff-profile/StaffTasksPanel';
import StaffPeriodReport from './staff-profile/StaffPeriodReport';
import StaffBroadcastPanel from './staff-profile/StaffBroadcastPanel';
import { fmtMoney as fmtMoneyEgp, fmtNum, monthLabel, type StaffProfileData } from './staff-profile/types';
import type { StaffMember, StaffPermission } from '../types';
import {
} from '../constants/permissions';
import { ROLE_LABELS } from './staff-profile/staffProfileConstants';
import StaffAttendancePanel from './staff-profile/StaffAttendancePanel';
import StaffSettingsPanel from './staff-profile/StaffSettingsPanel';
import { toEgp } from '../lib/money';
import { confirmDialog } from '../../shared/ui/confirmDialog';

// ── Helpers ──────────────────────────────────────────────────────────────────
const toEGP = (amt: number, cur: string) =>
  toEgp(amt, cur);

const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn');

// Delegates to the shared rule — this used to build country code "2".
const formatWaPhone = (p: string) => toDialable(p);

/** "منضم منذ سنة و3 شهور" — tenure, shown next to the name. */
const getTenure = (joinedAt: string) => {
  const ms = Date.now() - new Date(joinedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const months = ms / (30.44 * 86400000);
  if (months < 1) return `منضم منذ ${Math.max(1, Math.round(ms / 86400000))} يوم`;
  if (months < 12) return `منضم منذ ${Math.round(months)} شهر`;
  const years = Math.floor(months / 12);
  const rest = Math.round(months % 12);
  return `منضم منذ ${years} سنة${rest > 0 ? ` و${rest} شهر` : ''}`;
};




// ── Permission system constants ───────────────────────────────────────────────
// Derived from master constants — admin/constants/permissions.ts





type Tab = 'overview' | 'reports' | 'messages' | 'tasks' | 'attendance' | 'activity' | 'bookings' | 'settings';


const StaffProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { staffMembers, leads, subscribers, reloadStaffMembers, deleteStaffMember, authUser, isAdmin, currentStaff } = useSiteData();

  const [searchParams, setSearchParams] = useSearchParams();
  // ?tab= decides which tab opens, so a link can point at one. Anything
  // unrecognised falls back to the overview rather than a blank page.
  const TABS: Tab[] = ['overview', 'reports', 'messages', 'tasks', 'attendance', 'activity', 'bookings', 'settings'];
  const urlTab = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTabState] = useState<Tab>(
    urlTab && TABS.includes(urlTab) ? urlTab : 'overview',
  );
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true });
  };
  const [deleting, setDeleting] = useState(false);

  // Server-computed profile (whole-employment series, today's counters, rank,
  // lifetime records, task rollup). Kept separate from the client-side `perf`
  // below, which can only see the leads/subscribers the browser already holds.
  const [profile, setProfile] = useState<StaffProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setProfileLoading(true);
    setProfileError('');
    mysqlAdmin.getStaffProfile(id)
      .then(data => { if (!cancelled) setProfile(data as unknown as StaffProfileData); })
      .catch(error => { if (!cancelled) setProfileError(error instanceof Error ? error.message : 'تعذر تحميل ملف الأداء'); })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [id]);
  const [saveMsg, setSaveMsg] = useState('');
  const notify = React.useCallback((type: 'success' | 'error' | 'info', text: string) => {
    setSaveMsg(`${type === 'error' ? '❌' : type === 'info' ? 'ℹ️' : '✅'} ${text}`);
    setTimeout(() => setSaveMsg(''), 3500);
  }, []);

  const staff = useMemo(() => staffMembers.find(s => s.id === id), [staffMembers, id]);
  // From the context: staffMembers is empty for the ten roles that cannot read
  // the staff list, and this used to search it alone.



  // ── Performance computation ─────────────────────────────────────────────────
  const perf = useMemo(() => {
    if (!staff) return null;
    const sl = leads.filter(l => l.assignedSalesName === staff.name || l.assignedSalesId === staff.id);
    const assignedSubs = subscribers.filter(sub => sub.assignedSalesId === staff.id);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterdayStr = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const isT = (d: string) => !!d && new Date(d).toDateString() === now.toDateString();
    const isYest = (d: string) => !!d && d.slice(0, 10) === yesterdayStr;
    const isW = (d: string) => { if (!d) return false; const st = new Date(now); st.setDate(now.getDate() - now.getDay()); st.setHours(0, 0, 0, 0); return new Date(d) >= st; };
    const isTM = (d: string) => { if (!d) return false; const x = new Date(d); return x.getMonth() === now.getMonth() && x.getFullYear() === now.getFullYear(); };

    const allPayments = assignedSubs.flatMap(sub =>
      (sub.paymentHistory || []).filter(isCollected).map(p => ({ ...p, subName: sub.name, subId: sub.id, subCode: sub.clientCode }))
    );
    const toRevEGP = (list: typeof allPayments) => Math.round(list.reduce((s, p) => s + toEGP(p.amount, p.currency), 0));

    const allComms = sl.flatMap(l =>
      (l.communications || []).map(c => ({ ...c, leadName: l.name, leadId: l.id, leadPhone: l.phone || '' }))
    );
    allComms.sort((a, b) => b.date.localeCompare(a.date));

    const cr = staff.commissionRate || 0;
    const revTotal = toRevEGP(allPayments);

    return {
      total: sl.length,
      today: sl.filter(l => isT(l.createdAt || '')).length,
      yesterday: sl.filter(l => isYest(l.createdAt || '')).length,
      week: sl.filter(l => isW(l.createdAt || '')).length,
      month: sl.filter(l => isTM(l.createdAt || '')).length,
      converted: sl.filter(l => l.status === 'converted').length,
      convertedMonth: sl.filter(l => l.status === 'converted' && isTM(l.createdAt || '')).length,
      lost: sl.filter(l => l.status === 'lost').length,
      pending: sl.filter(l => l.status === 'new').length,
      contacted: sl.filter(l => l.status === 'contacted').length,
      noAnswer: sl.filter(l => l.status === 'no_answer').length,
      notInterested: sl.filter(l => l.status === 'not_interested').length,
      interested: sl.filter(l => l.status === 'interested').length,
      revTotal,
      revToday: toRevEGP(allPayments.filter(p => isT(p.at || ''))),
      revYest: toRevEGP(allPayments.filter(p => isYest(p.at || ''))),
      revWeek: toRevEGP(allPayments.filter(p => isW(p.at || ''))),
      revMonth: toRevEGP(allPayments.filter(p => isTM(p.at || ''))),
      commission: cr ? Math.round(revTotal * cr / 100) : 0,
      callsToday: allComms.filter(c => c.date === todayStr).length,
      callsYest: allComms.filter(c => c.date === yesterdayStr).length,
      callsWeek: allComms.filter(c => isW(c.date)).length,
      callsMonth: allComms.filter(c => isTM(c.date)).length,
      allComms,
      bookings: allPayments,
      leads: sl,
    };
  }, [staff, leads, subscribers]);

  if (!staff) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4" dir="rtl">
        <p className="text-5xl font-black text-gray-200 mb-4">404</p>
        <h1 className="text-xl font-bold text-gray-700 mb-2">الموظف غير موجود</h1>
        <button onClick={() => navigate('/dashboard/hr')} className="mt-4 bg-primary-600 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-primary-700 transition">
          العودة للموظفين
        </button>
      </div>
    );
  }

  const convRate = perf && perf.total > 0 ? Math.round((perf.converted / perf.total) * 100) : 0;

  // ── Save handler ─────────────────────────────────────────────────────────────
  // Salary changes go through /admin/hr/salary (pending approval by another
  // HR staff member) rather than being written directly — ported from the
  // old EmployeeProfileModal (HRTab.tsx) so this page has the exact same
  // guard: ported over, not reinvented, since it's the one that actually
  // matters (self-approving your own raise).

  // Soft-delete (is_active=0) — same superadmin-only endpoint the old
  // EmployeeProfileModal used (api/routes/staff.js DELETE /api/admin/staff/:id).
  const handleDelete = async () => {
    if (currentStaff?.id === staff.id) { setSaveMsg('❌ لا يمكنك حذف حسابك الخاص'); return; }
    if (!await confirmDialog(`حذف ${staff.name} نهائيًا من قائمة الموظفين النشطين؟ سجله وتاريخه المالي يبقى محفوظًا، ويمكن إعادة تفعيله لاحقًا.`)) return;
    setDeleting(true);
    try {
      const ok = await deleteStaffMember(staff.id);
      if (!ok) throw new Error('تعذر حذف الموظف — قد تحتاج صلاحية سوبر أدمن');
      navigate('/dashboard/hr');
    } catch (err: unknown) {
      setDeleting(false);
      setSaveMsg(`❌ ${err instanceof Error ? err.message : 'تعذر حذف الموظف'}`);
    }
  };


  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: <LayoutDashboard size={15} /> },
    { key: 'reports', label: 'التقارير', icon: <BarChart3 size={15} /> },
    { key: 'messages', label: 'المراسلات', icon: <MessageSquare size={15} /> },
    { key: 'tasks', label: 'المهام', icon: <ListChecks size={15} />, badge: profile ? profile.tasks.todo + profile.tasks.inProgress : undefined },
    { key: 'attendance', label: 'الحضور والانصراف', icon: <Clock size={15} /> },
    { key: 'activity', label: 'سجل النشاط', icon: <Activity size={15} /> },
    { key: 'bookings', label: 'الحجوزات', icon: <CreditCard size={15} /> },
    { key: 'settings', label: 'الإعدادات', icon: <Settings size={15} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* ── Hero header — identity, standing and quick actions in one band ── */}
      <div className="relative overflow-hidden bg-gradient-to-l from-slate-900 via-indigo-900 to-violet-800 text-white">
        {/* soft light blooms so the band reads as a designed surface, not a block */}
        <div className="pointer-events-none absolute -top-24 right-10 h-64 w-64 rounded-full bg-violet-500/30 blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-28 left-0 h-64 w-64 rounded-full bg-indigo-400/25 blur-[90px]" />

        <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-8 pt-5 pb-6">
          <nav className="mb-4 flex items-center gap-1 text-xs text-white/50">
            <button onClick={() => navigate(-1)}
              className="mr-1 grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"
              title="رجوع">
              <ArrowRight size={15} />
            </button>
            <button onClick={() => navigate('/dashboard/hr')} className="transition hover:text-white">الموظفون</button>
            <ChevronRight size={12} className="opacity-40" />
            <span className="truncate font-medium text-white/80">{staff.name}</span>
          </nav>

          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              {staff.image ? (
                <img src={staff.image} alt={staff.name}
                  className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-4 ring-white/15 shadow-xl" />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-white/15 text-3xl font-black ring-4 ring-white/10 shadow-xl">
                  {staff.name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-black tracking-tight">{staff.name}</h1>
                  {staff.status === 'inactive' && (
                    <span className="rounded-full bg-red-500/25 px-2 py-0.5 text-[11px] font-bold text-red-200">غير نشط</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-lg bg-white/15 px-2 py-1 font-bold">{ROLE_LABELS[staff.role] ?? staff.role}</span>
                  {staff.joinedAt && <span className="text-white/60">{getTenure(staff.joinedAt)}</span>}
                  {staff.commissionRate ? <span className="text-white/60">· عمولة {staff.commissionRate}%</span> : null}
                </div>
                {/* Headline stats, so the band answers "how is this person doing?" */}
                {profile && (
                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    <span><b className="text-base font-black">{fmtMoneyEgp(profile.lifetime.revenue)}</b><span className="text-white/50"> إيراد كلي</span></span>
                    <span><b className="text-base font-black">{fmtNum(profile.lifetime.bookings)}</b><span className="text-white/50"> حجز</span></span>
                    <span><b className="text-base font-black">{fmtNum(profile.today.calls)}</b><span className="text-white/50"> مكالمة اليوم</span></span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              {profile?.rank.position && (
                <div className="rounded-2xl bg-white/10 px-4 py-2.5 text-center backdrop-blur-sm ring-1 ring-white/15"
                  title={`ترتيبه ${profile.rank.position} من ${profile.rank.outOf} على إيراد الشهر الحالي`}>
                  <div className="flex items-center justify-center gap-1.5 text-amber-300">
                    <Trophy size={14} />
                    <span className="text-xl font-black leading-none">#{profile.rank.position}</span>
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-white/60">من {profile.rank.outOf} في الفريق</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {staff.phone && (
                  <a href={`https://wa.me/${formatWaPhone(staff.phone)}`} target="_blank" rel="noopener noreferrer"
                    className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/90 text-white transition hover:bg-emerald-400" title="واتساب">
                    <Phone size={16} />
                  </a>
                )}
                {staff.email && (
                  <a href={`mailto:${staff.email}`}
                    className="grid h-9 w-9 place-items-center rounded-full bg-sky-500/90 text-white transition hover:bg-sky-400" title="البريد الإلكتروني">
                    <Mail size={16} />
                  </a>
                )}
                <button onClick={() => setActiveTab('messages')}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold text-indigo-800 transition hover:bg-indigo-50"
                  title="مراسلة الموظف">
                  <MessageSquare size={14} /> رسالة
                </button>
                {isAdmin && currentStaff?.id !== staff.id && (
                  <button onClick={() => void handleDelete()} disabled={deleting}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-red-500/20 px-3 text-xs font-bold text-red-200 transition hover:bg-red-500/30 disabled:opacity-50"
                    title="حذف الموظف">
                    <Trash2 size={14} /> {deleting ? 'جارٍ...' : 'حذف'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab bar — sticks under the hero while scrolling ── */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur px-4 md:px-8">
        <div className="mx-auto flex max-w-6xl gap-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-5 py-3.5 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge ? (
                <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-black text-indigo-700">{tab.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Page body ── */}
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">

        {/* ══ OVERVIEW TAB — the professional at-a-glance profile ══ */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {profileLoading ? (
              <div className="py-20 text-center">
                <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
                <p className="mt-3 text-sm text-gray-400">جاري تحميل ملف الأداء...</p>
              </div>
            ) : profileError ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-700">
                {profileError}
              </div>
            ) : profile ? (
              <>
                <StaffTodayStrip data={profile} />

                {/* Lifetime record — the "ورقة الموظف" summary line */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { label: 'إجمالي الإيراد المحقق', value: fmtMoneyEgp(profile.lifetime.revenue), hint: `${fmtNum(profile.lifetime.bookings)} حجز` },
                    { label: 'إجمالي المكالمات', value: fmtNum(profile.lifetime.calls), hint: 'منذ الانضمام' },
                    {
                      label: 'معدل التحويل',
                      value: profile.lifetime.leads > 0 ? `${Math.round((profile.lifetime.converted / profile.lifetime.leads) * 100)}%` : '—',
                      hint: `${fmtNum(profile.lifetime.converted)} من ${fmtNum(profile.lifetime.leads)} ليد`,
                    },
                    { label: 'أكبر عملية بيع', value: fmtMoneyEgp(profile.lifetime.biggestSale), hint: profile.lifetime.bestMonth ? `أفضل شهر: ${monthLabel(profile.lifetime.bestMonth.ym)}` : '—' },
                  ].map(card => (
                    <div key={card.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-bold text-gray-400">{card.label}</p>
                      <p className="mt-1 text-xl font-black text-gray-900">{card.value}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">{card.hint}</p>
                    </div>
                  ))}
                </div>

                <StaffTimelineChart timeline={profile.timeline} />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <StaffRankCard data={profile} />
                  <StaffAchievements data={profile} />
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* ══ MESSAGES TAB — 1:1 thread + group broadcast composer ══ */}
        {activeTab === 'messages' && (
          <div className="space-y-6">
            <StaffMessagesPanel staffId={staff.id} staffName={staff.name} notify={notify} />
            <StaffBroadcastPanel staffMembers={staffMembers} notify={notify} />
          </div>
        )}

        {/* ══ TASKS TAB ══ */}
        {activeTab === 'tasks' && (
          <StaffTasksPanel staffId={staff.id} staffName={staff.name} notify={notify} />
        )}

        {/* ══ REPORTS TAB ══ */}
        {activeTab === 'reports' && (
          <div className="mb-6">
            <StaffPeriodReport staffId={staff.id} notify={notify} />
          </div>
        )}
        {activeTab === 'reports' && perf && (
          <div className="space-y-6">
            {/* Period cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'اليوم', leadsN: perf.today, calls: perf.callsToday, rev: perf.revToday },
                { label: 'بالأمس', leadsN: perf.yesterday, calls: perf.callsYest, rev: perf.revYest },
                { label: 'الأسبوع', leadsN: perf.week, calls: perf.callsWeek, rev: perf.revWeek },
                { label: 'الشهر', leadsN: perf.month, calls: perf.callsMonth, rev: perf.revMonth },
                { label: 'الإجمالي', leadsN: perf.total, calls: null, rev: perf.revTotal },
              ].map(p => (
                <div key={p.label} className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-xs font-bold text-gray-500 mb-1">{p.label}</div>
                  <div className="text-3xl font-bold text-indigo-700">{p.leadsN}</div>
                  <div className="text-[11px] text-gray-400 mb-1">ليد</div>
                  {p.calls !== null && (
                    <div className="text-[11px] text-blue-600 font-bold">📞 {p.calls} مكالمة</div>
                  )}
                  {p.rev > 0 && <div className="text-[11px] text-emerald-700 font-bold mt-0.5">{fmt(p.rev)} ج.م</div>}
                  {p.rev > 0 && (staff.commissionRate || 0) > 0 && (
                    <div className="text-[10px] text-orange-600 font-bold">
                      عمولة: {fmt(Math.round(p.rev * (staff.commissionRate || 0) / 100))} ج
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
                <div className="text-4xl font-bold text-green-700">{perf.converted}</div>
                <div className="text-sm text-green-600 mt-1">إجمالي تحوّل</div>
                <div className="text-2xl font-bold text-green-800 mt-2">{convRate}%</div>
                <div className="text-xs text-green-500">معدل التحويل</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center">
                <div className="text-4xl font-bold text-blue-700">{perf.allComms.length}</div>
                <div className="text-sm text-blue-600 mt-1">إجمالي التواصل</div>
              </div>
              {perf.revTotal > 0 ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
                  <div className="text-3xl font-bold text-emerald-700">{fmt(perf.revTotal)}</div>
                  <div className="text-sm text-emerald-600 mt-1">إيراد كلي (ج.م)</div>
                  {(staff.commissionRate || 0) > 0 && (
                    <>
                      <div className="text-xl font-bold text-orange-700 mt-2">{fmt(perf.commission)}</div>
                      <div className="text-xs text-orange-500">عمولة إجمالية</div>
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-center">
                  <div className="text-4xl font-bold text-gray-300">—</div>
                  <div className="text-sm text-gray-500 mt-1">لا يوجد إيراد مسجل</div>
                </div>
              )}
            </div>

            {/* Status distribution */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="text-sm font-bold text-gray-700 mb-3">توزيع حالات الليدز</h4>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  { label: 'جديد', val: perf.pending, color: 'bg-gray-100 text-gray-700' },
                  { label: 'تم التواصل', val: perf.contacted, color: 'bg-amber-50 text-amber-700' },
                  { label: 'مهتم', val: perf.interested, color: 'bg-emerald-50 text-emerald-700' },
                  { label: 'تحوّل', val: perf.converted, color: 'bg-green-50 text-green-700' },
                  { label: 'لا يرد', val: perf.noAnswer, color: 'bg-orange-50 text-orange-700' },
                  { label: 'غير مهتم / خسارة', val: perf.notInterested + perf.lost, color: 'bg-red-50 text-red-700' },
                ].map(st => (
                  <div key={st.label} className={`${st.color} rounded-xl p-3 text-center`}>
                    <div className="text-2xl font-bold">{st.val}</div>
                    <div className="text-xs leading-tight mt-0.5">{st.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Charts: Daily calls + conversions for last 7 days */}
            {(() => {
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return d.toISOString().slice(0, 10);
              });
              const callsPerDay = days.map(day => perf.allComms.filter(c => c.date === day).length);
              const convsPerDay = days.map(day => perf.leads.filter(l => l.status === 'converted' && (l.createdAt || '').slice(0, 10) === day).length);
              const maxCalls = Math.max(...callsPerDay, 1);
              const maxConvs = Math.max(...convsPerDay, 1);
              const dayLabels = days.map(d => { const x = new Date(d); return `${x.getDate()}/${x.getMonth() + 1}`; });
              const BAR_W = 28;
              const GAP = 12;
              const H = 100;
              const totalW = days.length * (BAR_W * 2 + GAP + 8);
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Calls chart */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <h4 className="text-sm font-bold text-blue-700 mb-3">📞 المكالمات — آخر 7 أيام</h4>
                    <svg viewBox={`0 0 ${totalW} ${H + 28}`} className="w-full" style={{ direction: 'ltr' }}>
                      {days.map((_, i) => {
                        const barH = callsPerDay[i] === 0 ? 3 : Math.max(6, Math.round((callsPerDay[i] / maxCalls) * H));
                        const x = i * (BAR_W + GAP + 8) + 4;
                        const y = H - barH;
                        return (
                          <g key={i}>
                            <rect x={x} y={y} width={BAR_W} height={barH} rx={5} fill={callsPerDay[i] === 0 ? '#e5e7eb' : '#6366f1'} />
                            {callsPerDay[i] > 0 && (
                              <text x={x + BAR_W / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="#4f46e5" fontWeight="bold">{callsPerDay[i]}</text>
                            )}
                            <text x={x + BAR_W / 2} y={H + 18} textAnchor="middle" fontSize="8.5" fill="#9ca3af">{dayLabels[i]}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  {/* Conversions chart */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <h4 className="text-sm font-bold text-green-700 mb-3">✅ التحويلات لحجوزات — آخر 7 أيام</h4>
                    <svg viewBox={`0 0 ${totalW} ${H + 28}`} className="w-full" style={{ direction: 'ltr' }}>
                      {days.map((_, i) => {
                        const barH = convsPerDay[i] === 0 ? 3 : Math.max(6, Math.round((convsPerDay[i] / maxConvs) * H));
                        const x = i * (BAR_W + GAP + 8) + 4;
                        const y = H - barH;
                        return (
                          <g key={i}>
                            <rect x={x} y={y} width={BAR_W} height={barH} rx={5} fill={convsPerDay[i] === 0 ? '#e5e7eb' : '#22c55e'} />
                            {convsPerDay[i] > 0 && (
                              <text x={x + BAR_W / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="#16a34a" fontWeight="bold">{convsPerDay[i]}</text>
                            )}
                            <text x={x + BAR_W / 2} y={H + 18} textAnchor="middle" fontSize="8.5" fill="#9ca3af">{dayLabels[i]}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══ ATTENDANCE TAB ══ */}
        {activeTab === 'attendance' && <StaffAttendancePanel staffId={id} />}

        {/* ══ ACTIVITY TAB ══ */}
        {activeTab === 'activity' && perf && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-gray-800 text-lg">سجل النشاط الكامل</h3>
              <span className="bg-blue-100 text-blue-700 text-sm font-bold px-3 py-1 rounded-full">{perf.allComms.length} إجراء</span>
            </div>
            {/* Calls summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'اليوم', count: perf.callsToday, color: 'bg-blue-50 text-blue-700 border-blue-200' },
                { label: 'بالأمس', count: perf.callsYest, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                { label: 'هذا الأسبوع', count: perf.callsWeek, color: 'bg-violet-50 text-violet-700 border-violet-200' },
                { label: 'هذا الشهر', count: perf.callsMonth, color: 'bg-purple-50 text-purple-700 border-purple-200' },
              ].map(c => (
                <div key={c.label} className={`${c.color} border rounded-2xl p-4 text-center`}>
                  <div className="text-3xl font-bold">📞 {c.count}</div>
                  <div className="text-xs mt-1 font-medium">{c.label}</div>
                </div>
              ))}
            </div>
            {/* Communications list */}
            {perf.allComms.length === 0 ? (
              <p className="text-center text-gray-400 py-10 bg-white rounded-2xl border border-gray-200">
                لا يوجد سجل نشاط بعد
              </p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100">
                {perf.allComms.map((c, idx) => {
                  const typeIcon = c.type === 'call' ? '📞' : c.type === 'whatsapp' ? '💬' : c.type === 'email' ? '✉️' : c.type === 'meeting' ? '🤝' : '📝';
                  const isStatusChange = c.notes?.startsWith('🔄 تغيير الحالة');
                  return (
                    <div key={c.id ?? idx} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition">
                      <span className="text-lg flex-shrink-0 mt-0.5">{typeIcon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-800 text-sm capitalize">{c.type === 'call' ? 'مكالمة' : c.type === 'whatsapp' ? 'واتساب' : c.type === 'email' ? 'بريد' : c.type === 'meeting' ? 'اجتماع' : 'ملاحظة'}</span>
                          {isStatusChange && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">تغيير حالة</span>
                          )}
                        </div>
                        {c.notes && <p className="text-sm text-gray-600 mt-0.5">{c.notes}</p>}
                        {c.outcome && <p className="text-xs text-gray-400 mt-0.5">النتيجة: {c.outcome}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{c.date}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ BOOKINGS TAB ══ */}
        {activeTab === 'bookings' && perf && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-gray-800 text-lg">سجل الحجوزات والإيرادات</h3>
              <span className="bg-emerald-100 text-emerald-700 text-sm font-bold px-3 py-1 rounded-full">
                {perf.bookings.length} دفعة · {fmt(perf.revTotal)} ج.م
              </span>
            </div>
            {/* Revenue periods */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'اليوم', rev: perf.revToday, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                { label: 'بالأمس', rev: perf.revYest, color: 'bg-green-50 text-green-700 border-green-200' },
                { label: 'هذا الأسبوع', rev: perf.revWeek, color: 'bg-teal-50 text-teal-700 border-teal-200' },
                { label: 'الإجمالي', rev: perf.revTotal, color: 'bg-blue-50 text-blue-700 border-blue-200' },
              ].map(c => (
                <div key={c.label} className={`${c.color} border rounded-2xl p-4 text-center`}>
                  <div className="text-2xl font-bold">{fmt(c.rev)}</div>
                  <div className="text-xs mt-1 font-medium">ج.م — {c.label}</div>
                  {c.rev > 0 && (staff.commissionRate || 0) > 0 && (
                    <div className="text-[11px] text-orange-600 font-bold mt-0.5">
                      عمولة: {fmt(Math.round(c.rev * (staff.commissionRate || 0) / 100))} ج
                    </div>
                  )}
                </div>
              ))}
            </div>
            {perf.bookings.length === 0 ? (
              <p className="text-center text-gray-400 py-10 bg-white rounded-2xl border border-gray-200">لا توجد حجوزات مسجلة بعد</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100">
                {perf.bookings.map((b, idx) => (
                  <div key={b.id ?? idx} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm">{b.subName}</p>
                      {b.note && <p className="text-xs text-gray-500 mt-0.5">{b.note}</p>}
                      {b.paymentType && (
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded mt-0.5 inline-block">{b.paymentType}</span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-emerald-700">{fmt(b.amount)} {b.currency}</div>
                      <div className="text-xs text-gray-400">{(b.at || '').slice(0, 10)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ SETTINGS TAB ══ */}
        {activeTab === 'settings' && (
          <StaffSettingsPanel
            staff={staff}
            currentStaff={currentStaff}
            isAdmin={isAdmin}
            reloadStaffMembers={reloadStaffMembers}
            saveMsg={saveMsg}
            setSaveMsg={setSaveMsg}
          />
        )}
      </div>
    </div>
  );
};

export default StaffProfile;
