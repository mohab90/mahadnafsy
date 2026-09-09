import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Briefcase, Search, BarChart3, ChevronRight, UserPlus, Pencil,
  CalendarCheck, CalendarOff, Wallet, UserCheck, UserX, Layers,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { StaffMember } from '../../../types';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';
import StaffOnboardModal, { type OnboardResult } from './hr-sections/StaffOnboardModal';
import HrAppraisalsPanel from './hr-sections/HrAppraisalsPanel';
import HrDisciplinaryPanel from './hr-sections/HrDisciplinaryPanel';
import HrResignationsPanel from './hr-sections/HrResignationsPanel';
import HrPayrollPanel from './hr-sections/HrPayrollPanel';
import HrAttendancePanel from './hr-sections/HrAttendancePanel';
import HrLeavesPanel from './hr-sections/HrLeavesPanel';
import { ROLE_LABELS, ROLE_COLORS } from './hr-sections/hrLabels';
import { fmtMoney } from './hr-sections/hrFormat';

const JobPostingsPanel = React.lazy(() => import('./JobPostingsPanel'));
const RecruitmentPipelinePanel = React.lazy(() => import('./hr-sections/RecruitmentPipelinePanel'));
const OnboardingPanel = React.lazy(() => import('./hr-sections/OnboardingPanel'));

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }
type PerformanceRow = {
  staff_id: string;
  revenue: number;
  commission: number;
  orders_count: number;
  leads_count: number;
  converted_count: number;
  conversion_rate: number;
  target_pct: number;
  target_hit: boolean;
  bonus: number;
};



function getMonthsOfService(joinedAt: string) {
  const ms = Date.now() - new Date(joinedAt).getTime();
  const months = ms / (30.4 * 86400000);
  if (months < 1) return `${Math.round(ms / 86400000)} يوم`;
  if (months < 12) return `${Math.round(months)} شهر`;
  const y = Math.floor(months / 12); const m = Math.round(months % 12);
  return m > 0 ? `${y} سنة ${m} شهر` : `${y} سنة`;
}

const HrTab: React.FC<Props> = ({ notify }) => {
  const navigate = useNavigate();
  const { staffMembers, reloadStaffMembers, authUser, isAdmin } = useSiteData();
  const currentStaff = useMemo(
    () => staffMembers.find(row => row.email?.toLowerCase() === (authUser?.email || '').toLowerCase()) || null,
    [staffMembers, authUser?.email],
  );
  const canManageFinance = isAdmin || Boolean(currentStaff && hasPermission({
    role: currentStaff.role as RoleKey,
    permissions: currentStaff.permissions as PermissionKey[] | undefined,
  }, 'manage_financial'));

  // The two staff actions have different gates on the server, so they get
  // different gates here rather than one shared "can I manage HR".
  //
  // Someone holding only view_hr could see both buttons. The routes refuse
  // them, so nothing was exposed — but a button that always errors is its own
  // bug, and it invites people to keep trying.
  //
  // POST /api/admin/staff requires manage_staff.
  const canAddStaff = isAdmin || Boolean(currentStaff && hasPermission({
    role: currentStaff.role as RoleKey,
    permissions: currentStaff.permissions as PermissionKey[] | undefined,
  }, 'manage_staff'));

  // PUT /api/admin/hr/payroll/:runId/status accepts either permission.
  const canManagePayroll = canManageFinance || Boolean(currentStaff && hasPermission({
    role: currentStaff.role as RoleKey,
    permissions: currentStaff.permissions as PermissionKey[] | undefined,
  }, 'manage_hr'));

  // No gate for deletion, because there is no delete button to gate. The audit
  // report claimed one was visible to anyone holding view_hr; there is none in
  // this screen at all.
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [subTab, setSubTab] = useState<'directory' | 'performance' | 'attendance' | 'leaves' | 'payroll' | 'recruitment'>('directory');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [perfMonth, setPerfMonth] = useState(new Date().toISOString().slice(0, 7));
  const [serverPerformance, setServerPerformance] = useState<PerformanceRow[]>([]);
  const [loadingPerformance, setLoadingPerformance] = useState(false);




  // ── Fetch functions ─────────────────────────────────────────




  const fetchPerformance = useCallback(async () => {
    setLoadingPerformance(true);
    try {
      const response = await fetch(`/api/admin/hr/reports/performance?month=${encodeURIComponent(perfMonth)}`, {
        credentials: 'include',
        headers: adminAuthHeaders(),
      });
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload.error || 'تعذر تحميل تقرير الأداء');
      setServerPerformance(Array.isArray(payload) ? payload : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل تقرير الأداء');
      setServerPerformance([]);
    } finally {
      setLoadingPerformance(false);
    }
  }, [notify, perfMonth]);

  // ── Side effects ─────────────────────────────────────────────
  useEffect(() => {
    if (subTab === 'directory' || subTab === 'performance') fetchPerformance();
  }, [subTab, fetchPerformance]);

  // ── Actions ──────────────────────────────────────────────────






  const safeStaff: StaffMember[] = staffMembers || [];

  const filtered = useMemo(() => safeStaff.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (roleFilter !== 'all' && s.role !== roleFilter) return false;
    if (search) { const q = search.toLowerCase(); return s.name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q) || (s.phone || '').includes(q); }
    return true;
  }), [safeStaff, search, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    const active = safeStaff.filter(s => s.status === 'active');
    const byRole: Record<string, number> = {};
    active.forEach(s => { byRole[s.role] = (byRole[s.role] || 0) + 1; });
    return { total: safeStaff.length, active: active.length, inactive: safeStaff.length - active.length, byRole };
  }, [safeStaff]);

  const perfByStaff = useMemo(
    () => new Map(serverPerformance.map(row => [row.staff_id, row])),
    [serverPerformance],
  );
  const perfData = useMemo(() => serverPerformance
    .map(row => {
      const member = safeStaff.find(staff => staff.id === row.staff_id);
      return member ? {
        member,
        revenue: row.revenue,
        commission: row.commission,
        converted: row.converted_count,
        leadsCount: row.leads_count,
        convRate: row.conversion_rate,
        targetPct: row.target_pct,
        targetHit: row.target_hit,
        bonus: row.bonus,
      } : null;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter(row => row.revenue > 0 || row.leadsCount > 0 || row.member.salary),
  [safeStaff, serverPerformance]);


  // A staff editor used to sit here — selectedMember, handleSave, handleDelete —
  // none of it reachable: the state was set by a performance-table row that no
  // panel read. It was a stale copy of StaffProfile.tsx, which is the editor
  // users actually get, linked from the directory grid below. Removed rather
  // than carried into the split, where one dead block becomes three dead files.

  const uniqueRoles = [...new Set(safeStaff.map(s => s.role))];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-bl from-slate-800 via-slate-700 to-indigo-900 text-white shadow-lg shadow-slate-900/10">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <Briefcase size={20} />
            </span>
            <div>
              <h2 className="text-xl font-bold leading-tight">إدارة الموارد البشرية</h2>
              <p className="mt-0.5 text-sm text-slate-300">ملفات الموظفين · الرواتب · التارجت · الحضور</p>
            </div>
          </div>
          {canAddStaff && (
            <button type="button" onClick={() => setShowAddStaff(true)}
              className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100">
              <UserPlus size={15} /> إضافة موظف جديد
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
          {[
            { label: 'إجمالي الموظفين', v: stats.total, Icon: Users, tone: 'text-slate-200' },
            { label: 'نشطون', v: stats.active, Icon: UserCheck, tone: 'text-emerald-300' },
            { label: 'غير نشطين', v: stats.inactive, Icon: UserX, tone: stats.inactive > 0 ? 'text-amber-300' : 'text-slate-400' },
            { label: 'أدوار مختلفة', v: Object.keys(stats.byRole).length, Icon: Layers, tone: 'text-sky-300' },
          ].map(({ label, v, Icon, tone }) => (
            <div key={label} className="bg-slate-800/80 px-4 py-3.5">
              <div className="flex items-center gap-1.5">
                <Icon size={13} className={tone} />
                <span className="text-[11px] text-slate-300">{label}</span>
              </div>
              <div className={`mt-1 text-2xl font-black tabular-nums ${tone}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-gray-200 bg-white p-1.5">
        {([
          ['directory', 'دليل الموظفين', Users],
          ['performance', 'الأداء والتارجت', BarChart3],
          ['attendance', 'الحضور والغياب', CalendarCheck],
          ['leaves', 'الإجازات', CalendarOff],
          ['payroll', 'كشف الرواتب', Wallet],
          ['recruitment', 'التوظيف', Briefcase],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setSubTab(key)}
            aria-current={subTab === key ? 'page' : undefined}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors ${
              subTab === key
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-gray-500 hover:bg-slate-50 hover:text-slate-700'
            }`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {subTab === 'directory' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute right-3 top-2.5 text-gray-400"/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الإيميل..." className="w-full pr-8 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
            </div>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="all">كل الأدوار</option>
              {uniqueRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="all">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
            <span className="self-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold tabular-nums text-slate-600">
              {filtered.length} من {stats.total}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 py-16 text-center">
                <Users size={38} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-bold text-gray-500">
                  {safeStaff.length === 0 ? 'لا يوجد موظفون بعد' : 'لا يوجد موظف بهذه المواصفات'}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {safeStaff.length === 0 ? 'ابدأ بإضافة أول موظف من الزر أعلى الصفحة' : 'جرّب تغيير البحث أو الفلاتر'}
                </p>
              </div>
            ) : filtered.map(member => {
              const performance = perfByStaff.get(member.id);
              const myRev = performance?.revenue || 0;
              const myLeads = performance?.leads_count || 0;
              const tType = member.monthlyTargetType || 'egp';
              const tPct = performance?.target_pct || 0;
              return (
                <div key={member.id}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/60">
                  <div className="flex items-start gap-3 p-4 pb-3">
                    {member.image ? (
                      <img src={member.image} alt=""
                        className={`h-11 w-11 shrink-0 rounded-full object-cover ring-2 ${member.status === 'active' ? 'ring-emerald-200' : 'ring-gray-200 grayscale'}`} />
                    ) : (
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-black text-white ring-2 ${
                        member.status === 'active' ? 'bg-slate-600 ring-emerald-200' : 'bg-gray-400 ring-gray-200'
                      }`}>{member.name.charAt(0)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => navigate(`/staff/${member.id}`)}
                        className="flex w-full items-center gap-1 text-right">
                        <span className="truncate font-bold text-gray-800 transition-colors group-hover:text-slate-900">{member.name}</span>
                        <ChevronRight size={14} className="shrink-0 text-gray-300 transition-colors group-hover:text-slate-500" />
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>
                          {ROLE_LABELS[member.role] || member.role}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${member.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          {member.status === 'active' ? 'نشط' : 'غير نشط'}
                        </span>
                      </div>
                    </div>
                    <button type="button" onClick={() => navigate(`/staff/${member.id}?tab=settings`)}
                      title="تعديل بيانات الموظف" aria-label={`تعديل بيانات ${member.name}`}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                      <Pencil size={13} />
                    </button>
                  </div>

                  {(member.monthlyTarget || 0) > 0 && (
                    <div className="px-4 pb-3">
                      <div className="mb-1 flex items-baseline justify-between text-[10px]">
                        <span className="text-gray-400">التارجت</span>
                        <span className="font-bold tabular-nums text-gray-600">
                          {tType === 'clients' ? `${member.monthlyTarget} عميل` : fmtMoney(member.monthlyTarget!)}
                          <span className={`mr-1 ${tPct >= 100 ? 'text-emerald-600' : 'text-gray-400'}`}>· {Math.round(tPct)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full transition-all ${tPct >= 100 ? 'bg-emerald-500' : 'bg-slate-500'}`}
                          style={{ width: `${Math.min(tPct, 100)}%` }} />
                      </div>
                    </div>
                  )}

                  <div className="mt-auto grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 border-t border-gray-100 bg-gray-50/70 text-center">
                    <div className="px-2 py-2.5">
                      <div className="text-xs font-bold text-gray-700">
                        {member.joinedAt ? getMonthsOfService(member.joinedAt) : <span className="text-amber-600">بدون تاريخ</span>}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-400">مدة الخدمة</div>
                    </div>
                    <div className="px-2 py-2.5">
                      <div className="text-xs font-bold tabular-nums text-gray-700">{myLeads}</div>
                      <div className="mt-0.5 text-[10px] text-gray-400">ليدات</div>
                    </div>
                    <div className="px-2 py-2.5">
                      <div className={`text-xs font-bold tabular-nums ${myRev > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                        {myRev > 0 ? `${Math.round(myRev / 1000)}k` : '—'}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-400">مبيعات</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subTab === 'recruitment' && (
        <React.Suspense fallback={<div className="py-12 text-center text-sm text-gray-400">جاري تحميل قسم التوظيف...</div>}>
          <div className="space-y-4">
            <JobPostingsPanel notify={notify} />
            <RecruitmentPipelinePanel notify={notify} />
            <OnboardingPanel notify={notify} />
          </div>
        </React.Suspense>
      )}

      {subTab === 'performance' && (
        <div className="space-y-4">
          <HrAppraisalsPanel staff={staffMembers} notify={notify} />
          {/* Both of these drive endpoints that existed with no caller: an
              employee could acknowledge a disciplinary notice HR had no way to
              issue, and could file a resignation no one could act on. */}
          <HrDisciplinaryPanel staff={staffMembers} notify={notify} />
          <HrResignationsPanel notify={notify} />
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-gray-700">شهر التقرير:</label>
            <input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
          </div>
          {loadingPerformance ? (
            <div className="text-center py-16 text-gray-400"><span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"/></div>
          ) : perfData.length === 0 ? (
            <div className="text-center py-16 text-gray-400"><BarChart3 size={40} className="mx-auto mb-3 opacity-20"/><p className="text-sm">لا بيانات أداء لهذا الشهر</p></div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">الموظف</th>
                  <th className="px-4 py-3">المبيعات</th>
                  <th className="px-4 py-3">العمولة</th>
                  <th className="px-4 py-3">التارجت</th>
                  <th className="px-4 py-3">ليدات / تحويل</th>
                  <th className="px-4 py-3">مكافأة</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {perfData.map((p, i) => (
                    <tr key={p.member.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 text-center"><span className="text-sm font-bold text-gray-500">{i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}`}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">{p.member.name.charAt(0)}</div>
                          <div><p className="font-bold text-gray-800 text-xs">{p.member.name}</p><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLORS[p.member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[p.member.role]}</span></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-green-700 text-xs">{fmtMoney(p.revenue)}</td>
                      <td className="px-4 py-3 font-bold text-amber-700 text-xs">{fmtMoney(p.commission)}</td>
                      <td className="px-4 py-3">
                        {p.member.monthlyTarget ? (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${p.targetHit ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${p.targetPct}%` }}/></div>
                              <span className={`text-[10px] font-bold ${p.targetHit ? 'text-emerald-700' : 'text-gray-500'}`}>{p.targetPct}%</span>
                            </div>
                            {p.targetHit && <span className="text-[10px] text-emerald-600 font-bold">✅ تحقق</span>}
                          </div>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{p.leadsCount} / {p.converted} ({p.convRate}%)</td>
                      <td className="px-4 py-3 text-xs">{p.bonus > 0 ? <span className="text-emerald-700 font-bold">+{fmtMoney(p.bonus)}</span> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'attendance' && <HrAttendancePanel notify={notify} staff={safeStaff} />}

      {subTab === 'leaves' && <HrLeavesPanel notify={notify} staff={safeStaff} />}

      {subTab === 'payroll' && (
        <HrPayrollPanel notify={notify} canManageFinance={canManageFinance} canManagePayroll={canManagePayroll} />
      )}

      <StaffOnboardModal
        open={showAddStaff}
        title="إضافة موظف جديد"
        submitLabel="إنشاء الموظف"
        onClose={() => setShowAddStaff(false)}
        notify={notify}
        onSubmit={async (result: OnboardResult) => {
          try {
            // Two writes on purpose: the staff row, then the login. Creating the
            // login is optional — a record can exist before the person has
            // credentials — so it must not be folded into the staff insert.
            const staffId = `staff-${Date.now()}`;
            await mysqlAdmin.saveStaff({
              id: staffId,
              name: result.name,
              email: result.email,
              phone: result.phone,
              role: result.role,
              specialization: result.position || null,
              branch_id: result.branchId || undefined,
              is_active: result.activate ? 1 : 0,
              permissions: result.permissions || undefined,
            } as unknown as Record<string, unknown>);
            if (result.password) {
              await mysqlAdmin.createStaffAccount({
                staffId, name: result.name, email: result.email,
                role: result.role, password: result.password,
              } as unknown as Record<string, unknown>);
            }
            await reloadStaffMembers();
            setShowAddStaff(false);
            notify('success', result.password
              ? `تم إنشاء ${result.name} — يقدر يدخل بالإيميل وكلمة المرور`
              : `تم إنشاء ${result.name} — بدون حساب دخول`);
          } catch (error) {
            notify('error', error instanceof Error ? error.message : 'تعذر إنشاء الموظف');
          }
        }}
      />
    </div>
  );
};

export default HrTab;
