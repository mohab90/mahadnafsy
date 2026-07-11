import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { StaffMember } from '../../../types';
import EmployeeProfileModal from './hr-sections/EmployeeProfileModal';
import DirectoryTab from './hr-sections/DirectoryTab';
import PerformanceTab from './hr-sections/PerformanceTab';
import AttendanceTab from './hr-sections/AttendanceTab';
import LeavesTab from './hr-sections/LeavesTab';
import PayrollTab from './hr-sections/PayrollTab';
import RecruitingTab from './hr-sections/RecruitingTab';
import { PAYROLL_STATUS_LABELS, type NotifyFn, type LeavesFilter, type ManualEntry, type LeaveForm, type AttReport, type ImportResult } from './hr-sections/shared';

interface Props { notify: NotifyFn; }

const HrTab: React.FC<Props> = ({ notify }) => {
  const { staffMembers, orders, leads, updateStaffMember } = useSiteData() as any;
  const [subTab, setSubTab] = useState<'directory' | 'performance' | 'attendance' | 'leaves' | 'payroll' | 'recruiting'>('directory');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMember, setSelectedMember] = useState<StaffMember | null>(null);
  const [perfMonth, setPerfMonth] = useState(new Date().toISOString().slice(0, 7));

  // ── Attendance state ────────────────────────────────────────
  const [attMonth, setAttMonth] = useState(new Date().toISOString().slice(0, 7));
  const [attSummary, setAttSummary] = useState<any[]>([]);
  const [loadingAtt, setLoadingAtt] = useState(false);
  const [attReport, setAttReport] = useState<AttReport | null>(null);
  const [loadingAttReport, setLoadingAttReport] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntry, setManualEntry] = useState<ManualEntry>({ staff_id: '', date: new Date().toISOString().slice(0, 10), check_in: '', check_out: '', status: 'PRESENT', notes: '' });
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // ── Leaves state ────────────────────────────────────────────
  const [leavesFilter, setLeavesFilter] = useState<LeavesFilter>('PENDING');
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loadingLeaves, setLoadingLeaves] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState<LeaveForm>({ staff_id: '', type: 'ANNUAL', start_date: '', end_date: '', reason: '' });

  // ── Server payroll state ─────────────────────────────────────
  const [payrollRuns, setPayrollRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [payrollItems, setPayrollItems] = useState<any[]>([]);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(0, 7));
  // Recruiting — website applicants flowing into the HR funnel (routes/hr/talent.js)
  const [talent, setTalent] = useState<any[]>([]);
  const [loadingTalent, setLoadingTalent] = useState(false);
  const [talentBusy, setTalentBusy] = useState<string | null>(null);
  const [recruitTab, setRecruitTab] = useState<'instructors' | 'employees'>('instructors');

  // ── Fetch functions ─────────────────────────────────────────
  const fetchTalent = useCallback(() => {
    setLoadingTalent(true);
    fetch('/api/admin/hr/talent-pool', { credentials: 'include' })
      .then(r => r.json()).then(d => setTalent(Array.isArray(d) ? d : []))
      .catch(() => {}).finally(() => setLoadingTalent(false));
  }, []);
  const talentAction = useCallback(async (url: string, id: string, ok: string) => {
    setTalentBusy(id);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error();
      notify('success', ok); fetchTalent();
    } catch { notify('error', 'فشل تنفيذ العملية'); } finally { setTalentBusy(null); }
  }, [notify, fetchTalent]);
  const fetchAttendanceSummary = useCallback(async (month?: string) => {
    const m = month || attMonth;
    const [y, mo] = m.split('-');
    setLoadingAtt(true);
    try {
      const res = await fetch(`/api/admin/hr/attendance/summary?month=${parseInt(mo)}&year=${y}`, { credentials: 'include' });
      if (res.ok) setAttSummary(await res.json());
    } catch { /* silently fail */ } finally { setLoadingAtt(false); }
  }, [attMonth]);

  const fetchAttendanceReport = useCallback(async (month?: string) => {
    const m = month || attMonth;
    setLoadingAttReport(true);
    try {
      const res = await fetch(`/api/admin/hr/attendance-report?month=${m}`, { credentials: 'include' });
      if (res.ok) setAttReport(await res.json());
    } catch { /* silently fail */ } finally { setLoadingAttReport(false); }
  }, [attMonth]);

  const fetchLeaves = useCallback(async () => {
    setLoadingLeaves(true);
    try {
      const url = leavesFilter === 'all' ? '/api/admin/hr/leaves' : `/api/admin/hr/leaves?status=${leavesFilter}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) setLeaves(await res.json());
    } catch { /* silently fail */ } finally { setLoadingLeaves(false); }
  }, [leavesFilter]);

  const fetchPayrollRuns = useCallback(async () => {
    setLoadingPayroll(true);
    try {
      const res = await fetch('/api/admin/hr/payroll', { credentials: 'include' });
      if (res.ok) setPayrollRuns(await res.json());
    } catch { /* silently fail */ } finally { setLoadingPayroll(false); }
  }, []);

  const fetchRunItems = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/admin/hr/payroll/${runId}`, { credentials: 'include' });
      if (res.ok) { const data = await res.json(); setPayrollItems(data.items || []); }
    } catch { /* silently fail */ }
  }, []);

  // ── Side effects ─────────────────────────────────────────────
  useEffect(() => { if (subTab === 'attendance') { fetchAttendanceSummary(); fetchAttendanceReport(); } }, [subTab, fetchAttendanceSummary, fetchAttendanceReport]);
  useEffect(() => { if (subTab === 'leaves') fetchLeaves(); }, [subTab, leavesFilter, fetchLeaves]);
  useEffect(() => { if (subTab === 'payroll') fetchPayrollRuns(); }, [subTab, fetchPayrollRuns]);
  useEffect(() => { if (subTab === 'recruiting') fetchTalent(); }, [subTab, fetchTalent]);

  // ── Actions ──────────────────────────────────────────────────
  const submitManualAttendance = useCallback(async () => {
    if (!manualEntry.staff_id || !manualEntry.date) return;
    try {
      const res = await fetch('/api/admin/hr/attendance', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualEntry),
      });
      if (res.ok) {
        notify('success', 'تم تسجيل الحضور ✅');
        setShowManualEntry(false);
        setManualEntry({ staff_id: '', date: new Date().toISOString().slice(0, 10), check_in: '', check_out: '', status: 'PRESENT', notes: '' });
        fetchAttendanceSummary();
      } else { const d = await res.json(); notify('error', d.error || 'فشل التسجيل'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [manualEntry, notify, fetchAttendanceSummary]);

  const submitCsvImport = useCallback(async () => {
    if (!csvText.trim()) return;
    try {
      const [y, mo] = attMonth.split('-');
      const res = await fetch('/api/admin/hr/attendance/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, month: parseInt(mo), year: parseInt(y) }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportResult(data);
        notify('success', `تم استيراد ${data.imported} سجل ✅`);
        fetchAttendanceSummary();
      } else { const d = await res.json(); notify('error', d.error || 'فشل الاستيراد'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [csvText, attMonth, notify, fetchAttendanceSummary]);

  const updateLeaveStatus = useCallback(async (leaveId: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await fetch(`/api/admin/hr/leaves/${leaveId}/status`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        notify('success', status === 'APPROVED' ? 'تمت الموافقة على الإجازة ✅' : 'تم رفض الإجازة');
        fetchLeaves();
      } else { const d = await res.json(); notify('error', d.error || 'فشل التحديث'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [notify, fetchLeaves]);

  const submitLeaveRequest = useCallback(async () => {
    if (!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date) return;
    try {
      const res = await fetch('/api/admin/hr/leaves', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...leaveForm, leave_type: leaveForm.type }),
      });
      if (res.ok) {
        notify('success', 'تم إرسال طلب الإجازة ✅');
        setShowLeaveForm(false);
        setLeaveForm({ staff_id: '', type: 'ANNUAL', start_date: '', end_date: '', reason: '' });
        fetchLeaves();
      } else { const d = await res.json(); notify('error', d.error || 'فشل الإرسال'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [leaveForm, notify, fetchLeaves]);

  const calculatePayroll = useCallback(async () => {
    setCalculating(true);
    try {
      const [y, mo] = payrollMonth.split('-');
      const res = await fetch('/api/admin/hr/payroll/calculate', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: parseInt(mo), year: parseInt(y) }),
      });
      if (res.ok) {
        const data = await res.json();
        notify('success', `تم احتساب كشف الرواتب ✅`);
        fetchPayrollRuns();
        setSelectedRun(data.run || data);
        setPayrollItems(data.items || []);
        if ((data.run || data).id) fetchRunItems((data.run || data).id);
      } else { const d = await res.json(); notify('error', d.error || 'فشل الاحتساب'); }
    } catch { notify('error', 'خطأ في الاتصال'); } finally { setCalculating(false); }
  }, [payrollMonth, notify, fetchPayrollRuns, fetchRunItems]);

  const updatePayrollRunStatus = useCallback(async (runId: string, status: string) => {
    try {
      const res = await fetch(`/api/admin/hr/payroll/${runId}/status`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        notify('success', `تم تحديث حالة الكشف إلى "${PAYROLL_STATUS_LABELS[status] || status}" ✅`);
        fetchPayrollRuns();
        if (selectedRun?.id === runId) setSelectedRun((r: any) => ({ ...r, status }));
      } else { const d = await res.json(); notify('error', d.error || 'فشل التحديث'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [notify, fetchPayrollRuns, selectedRun]);

  const safeOrders = orders || [];
  const safeLeads = leads || [];
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

  const getPerfData = useCallback((month: string) => {
    const start = month + '-01';
    const end = new Date(new Date(start).getTime() + 32 * 86400000).toISOString().slice(0, 7) + '-01';
    return safeStaff.map(s => {
      const myOrders = safeOrders.filter((o: any) => o.staffId === s.id && o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) < end);
      const revenue = myOrders.reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
      const myLeads = safeLeads.filter((l: any) => l.assignedSalesId === s.id);
      const converted = myLeads.filter((l: any) => l.status === 'converted').length;
      const commission = revenue * (s.commissionRate || 0) / 100;
      const tType = s.monthlyTargetType || 'egp';
      const prog = tType === 'egp' ? revenue : converted;
      const targetHit = (s.monthlyTarget || 0) > 0 && prog >= (s.monthlyTarget || 0);
      const tPct = (s.monthlyTarget || 0) > 0 ? Math.min(100, Math.round(prog / s.monthlyTarget! * 100)) : 0;
      return { member: s, revenue, commission, converted, leadsCount: myLeads.length, convRate: myLeads.length > 0 ? Math.round(converted / myLeads.length * 100) : 0, targetPct: tPct, targetHit, bonus: targetHit ? (s.monthlyBonus || 0) : 0 };
    }).filter(x => x.revenue > 0 || x.leadsCount > 0 || x.member.salary).sort((a, b) => b.revenue - a.revenue);
  }, [safeStaff, safeOrders, safeLeads]);

  const perfData = useMemo(() => getPerfData(perfMonth), [getPerfData, perfMonth]);

  const handleSave = useCallback((updated: StaffMember) => {
    if (updateStaffMember) updateStaffMember(updated);
    notify('success', `تم حفظ بيانات ${updated.name} ✅`);
    setSelectedMember(updated);
  }, [updateStaffMember, notify]);

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
          ['recruiting', 'طلبات الانضمام'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${subTab === k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>{l}</button>
        ))}
      </div>

      {subTab === 'directory' && (
        <DirectoryTab
          search={search} setSearch={setSearch}
          roleFilter={roleFilter} setRoleFilter={setRoleFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          uniqueRoles={uniqueRoles} filtered={filtered}
          safeOrders={safeOrders} safeLeads={safeLeads}
          onSelect={setSelectedMember}
        />
      )}

      {subTab === 'performance' && (
        <PerformanceTab perfMonth={perfMonth} setPerfMonth={setPerfMonth} perfData={perfData} onSelect={setSelectedMember} />
      )}

      {subTab === 'attendance' && (
        <AttendanceTab
          attMonth={attMonth} setAttMonth={setAttMonth}
          attSummary={attSummary} loadingAtt={loadingAtt}
          attReport={attReport} loadingAttReport={loadingAttReport}
          fetchAttendanceSummary={fetchAttendanceSummary} fetchAttendanceReport={fetchAttendanceReport}
          showManualEntry={showManualEntry} setShowManualEntry={setShowManualEntry}
          manualEntry={manualEntry} setManualEntry={setManualEntry}
          submitManualAttendance={submitManualAttendance}
          showCsvImport={showCsvImport} setShowCsvImport={setShowCsvImport}
          csvText={csvText} setCsvText={setCsvText}
          importResult={importResult} setImportResult={setImportResult}
          submitCsvImport={submitCsvImport}
          safeStaff={safeStaff}
        />
      )}

      {subTab === 'leaves' && (
        <LeavesTab
          leavesFilter={leavesFilter} setLeavesFilter={setLeavesFilter}
          leaves={leaves} loadingLeaves={loadingLeaves}
          updateLeaveStatus={updateLeaveStatus}
          showLeaveForm={showLeaveForm} setShowLeaveForm={setShowLeaveForm}
          leaveForm={leaveForm} setLeaveForm={setLeaveForm}
          submitLeaveRequest={submitLeaveRequest}
          safeStaff={safeStaff}
        />
      )}

      {subTab === 'payroll' && (
        <PayrollTab
          payrollMonth={payrollMonth} setPayrollMonth={setPayrollMonth}
          payrollRuns={payrollRuns} loadingPayroll={loadingPayroll}
          calculating={calculating} calculatePayroll={calculatePayroll} fetchPayrollRuns={fetchPayrollRuns}
          selectedRun={selectedRun} setSelectedRun={setSelectedRun}
          payrollItems={payrollItems} fetchRunItems={fetchRunItems}
          updatePayrollRunStatus={updatePayrollRunStatus}
          perfMonth={perfMonth} setPerfMonth={setPerfMonth}
          safeStaff={safeStaff} safeOrders={safeOrders} safeLeads={safeLeads}
          onSelect={setSelectedMember}
        />
      )}

      {subTab === 'recruiting' && (
        <RecruitingTab
          talent={talent} loadingTalent={loadingTalent} talentBusy={talentBusy}
          talentAction={talentAction}
          recruitTab={recruitTab} setRecruitTab={setRecruitTab}
          notify={notify}
        />
      )}

      {selectedMember && (
        <EmployeeProfileModal
          member={selectedMember}
          orders={safeOrders}
          leads={safeLeads}
          onClose={() => setSelectedMember(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

export default HrTab;
