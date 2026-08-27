import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Briefcase, Search, BarChart3, ChevronRight, UserPlus, Pencil } from 'lucide-react';
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
      <div className="bg-gradient-to-l from-slate-700 to-gray-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Briefcase size={22}/> إدارة الموارد البشرية</h2>
        <p className="text-slate-300 text-sm mt-0.5">ملفات الموظفين · الرواتب · التارجت · الغياب</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'إجمالي الموظفين', v: stats.total, bg: 'bg-white/15' },
            { label: 'نشطون', v: stats.active, bg: 'bg-emerald-500/20' },
            { label: 'غير نشطين', v: stats.inactive, bg: stats.inactive > 0 ? 'bg-red-500/20' : 'bg-white/10' },
            { label: 'أدوار مختلفة', v: Object.keys(stats.byRole).length, bg: 'bg-blue-400/20' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-2xl font-black">{s.v}</div>
              <div className="text-xs text-slate-300 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['directory', 'دليل الموظفين'],
          ['performance', 'الأداء والتارجت'],
          ['attendance', 'الحضور والغياب'],
          ['leaves', 'الإجازات'],
          ['payroll', 'كشف الرواتب'],
          ['recruitment', 'التوظيف'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${subTab === k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>{l}</button>
        ))}
      </div>

      {subTab === 'directory' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
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
            <span className="text-sm text-gray-400 self-center">{filtered.length} موظف</span>
            {/* HR had no way at all to add an employee — the only door into the
                staff table was the interview→hire flow. */}
            {canAddStaff && (
              <button type="button" onClick={() => setShowAddStaff(true)}
                className="flex items-center gap-1.5 rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
                <UserPlus size={15} /> إضافة موظف جديد
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.length === 0 ? (
              <div className="col-span-3 text-center py-16 text-gray-400"><Users size={40} className="mx-auto mb-3 opacity-20"/><p>لا نتائج</p></div>
            ) : filtered.map(member => {
              const performance = perfByStaff.get(member.id);
              const myRev = performance?.revenue || 0;
              const myLeads = performance?.leads_count || 0;
              const tType = member.monthlyTargetType || 'egp';
              const tPct = performance?.target_pct || 0;
              return (
                <div key={member.id} className="relative">
                <button onClick={() => navigate(`/staff/${member.id}`)} className="bg-white border border-gray-200 rounded-2xl p-4 text-right hover:shadow-md hover:border-slate-400 transition-all group">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-base shrink-0 ${member.status === 'active' ? 'bg-slate-600' : 'bg-gray-400'}`}>{member.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 truncate group-hover:text-slate-700">{member.name}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[member.role] || member.role}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{member.status === 'active' ? '● نشط' : '● غير نشط'}</span>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 group-hover:text-slate-500 transition-colors shrink-0 mt-1"/>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-xs font-bold text-gray-700">{member.joinedAt ? getMonthsOfService(member.joinedAt) : <span className="text-amber-600">بدون تاريخ</span>}</div><div className="text-[10px] text-gray-400">مدة الخدمة</div></div>
                    <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-xs font-bold text-gray-700">{myLeads}</div><div className="text-[10px] text-gray-400">ليدات</div></div>
                    <div className="bg-gray-50 rounded-lg py-1.5"><div className={`text-xs font-bold ${myRev > 0 ? 'text-green-700' : 'text-gray-400'}`}>{myRev > 0 ? `${Math.round(myRev / 1000)}k` : '—'}</div><div className="text-[10px] text-gray-400">مبيعات</div></div>
                  </div>
                  {(member.monthlyTarget || 0) > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                        <span>التارجت</span>
                        <span>{tType === 'clients' ? `${member.monthlyTarget} عميل` : fmtMoney(member.monthlyTarget!)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${tPct >= 100 ? 'bg-emerald-500' : 'bg-slate-500'}`} style={{ width: `${tPct}%` }}/></div>
                    </div>
                  )}
                </button>
                  <button
                    onClick={() => navigate(`/staff/${member.id}?tab=settings`)}
                    title="تعديل بيانات الموظف"
                    className="absolute top-2 left-2 h-7 px-2 rounded-lg bg-slate-50 text-slate-600 text-[11px] font-bold
                      hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-1">
                    <Pencil size={11}/> تعديل
                  </button>
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

      {subTab === 'payroll' && <HrPayrollPanel notify={notify} canManageFinance={canManageFinance} />}

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
