// The official payroll runs: calculate a month, then approve, pay or cancel it.
//
// Lifted out of HRTab.tsx with its own state, because none of it was shared —
// the runs, the selected run, its line items and the month/branch pickers were
// read by this tab and nothing else.
import { useCallback, useEffect, useState } from 'react';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';
import { Award, BarChart3, Wallet } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { PAYROLL_STATUS_LABELS, PAYROLL_STATUS_COLORS } from './hrLabels';
import { fmtMoney } from './hrFormat';
import HrCompensationApprovals from './HrCompensationApprovals';
import HrAdvancesPanel from './HrAdvancesPanel';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type PayrollRun = {
  id: string;
  month: number | string;
  year: number | string;
  status: string;
  employee_count?: number;
  total_amount?: number;
  total_gross?: number;
  total_net?: number;
};
type PayrollItem = {
  id: string;
  staff_name?: string;
  name?: string;
  base_salary?: number;
  total_allowances?: number;
  allowances_total?: number;
  absence_deductions?: number;
  absence_deduction?: number;
  late_deductions?: number;
  late_deduction?: number;
  other_deductions?: number;
  other_deduction?: number;
  advance_deductions?: number;
  advance_deduction?: number;
  commission?: number;
  instructor_earnings?: number;
  bonus_amount?: number;
  net_salary?: number;
};

export default function HrPayrollPanel({ notify, canManageFinance, canManagePayroll }: {
  notify: Notify;
  canManageFinance: boolean;
  // The route accepts manage_hr OR manage_financial, so the cancel action needs
  // its own gate rather than borrowing the finance one.
  canManagePayroll: boolean;
}) {
  // ── Server payroll state ─────────────────────────────────────
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [payrollItems, setPayrollItems] = useState<PayrollItem[]>([]);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [payrollMonth, setPayrollMonth] = useState(cairoMonthOnly());
  const [payrollBranch, setPayrollBranch] = useState('branch-all');

  const fetchPayrollRuns = useCallback(async () => {
    setLoadingPayroll(true);
    try {
      const res = await fetch('/api/admin/hr/payroll', { credentials: 'include', headers: adminAuthHeaders() });
      if (res.ok) setPayrollRuns(await res.json());
    } catch { notify('error', 'تعذر تحميل مسيرات الرواتب'); } finally { setLoadingPayroll(false); }
  }, [notify]);

  const fetchRunItems = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/admin/hr/payroll/${runId}`, { credentials: 'include', headers: adminAuthHeaders() });
      if (res.ok) { const data = await res.json(); setPayrollItems(data.items || []); }
    } catch { notify('error', 'تعذر تحميل تفاصيل مسير الرواتب'); }
  }, [notify]);

  const calculatePayroll = useCallback(async () => {
    setCalculating(true);
    try {
      const [y, mo] = payrollMonth.split('-');
      const res = await fetch('/api/admin/hr/payroll/calculate', {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ month: parseInt(mo), year: parseInt(y), branch_id: payrollBranch }),
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
  }, [payrollMonth, payrollBranch, notify, fetchPayrollRuns, fetchRunItems]);

  const updatePayrollRunStatus = useCallback(async (runId: string, status: string) => {
    try {
      const res = await fetch(`/api/admin/hr/payroll/${runId}/status`, {
        method: 'PUT', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        notify('success', `تم تحديث حالة الكشف إلى "${PAYROLL_STATUS_LABELS[status] || status}" ✅`);
        fetchPayrollRuns();
        if (selectedRun?.id === runId) setSelectedRun((run) => run ? ({ ...run, status }) : run);
      } else { const d = await res.json(); notify('error', d.error || 'فشل التحديث'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [notify, fetchPayrollRuns, selectedRun]);

  // The panel only mounts while its tab is open, so mounting is the cue to load.
  useEffect(() => { fetchPayrollRuns(); }, [fetchPayrollRuns]);

  return (
      <div className="space-y-4">
        <HrCompensationApprovals notify={notify} />
        <HrAdvancesPanel notify={notify} canDisburse={canManageFinance} />
        {/* Server payroll section */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Wallet size={16}/> كشوف الرواتب الرسمية</h3>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">شهر الاحتساب</label>
              <input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">نطاق المسير</label>
              <select value={payrollBranch} onChange={event => setPayrollBranch(event.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                <option value="branch-all">كل الفروع</option>
                <option value="branch-daqqi">الدقي</option>
                <option value="branch-tagamoa">التجمع</option>
                <option value="branch-online-egypt">أونلاين مصر</option>
                <option value="branch-online-saudi">أونلاين السعودية</option>
                <option value="branch-online-abroad">أونلاين دولي</option>
                <option value="branch-other">أخرى / غير مصنف</option>
              </select>
            </div>
            <button onClick={calculatePayroll} disabled={calculating} className="px-5 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50 flex items-center gap-2">
              {calculating ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"/> : <Award size={15}/>}
              {calculating ? 'جاري الاحتساب...' : 'احتساب كشف الرواتب'}
            </button>
            <button onClick={fetchPayrollRuns} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-200 transition">تحديث</button>
          </div>

          {loadingPayroll ? (
            <div className="text-center py-8 text-gray-400">
              <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
              <p className="text-sm">جاري تحميل الكشوف...</p>
            </div>
          ) : payrollRuns.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Wallet size={36} className="mx-auto mb-2 opacity-20"/>
              <p className="text-sm">لا توجد كشوف رواتب محتسبة بعد</p>
              <p className="text-xs mt-1">اختر الشهر واضغط "احتساب كشف الرواتب" لبدء العملية</p>
            </div>
          ) : (
            <div className="space-y-2">
              {payrollRuns.map(run => (
                <div key={run.id} className={`border rounded-xl p-4 cursor-pointer transition ${selectedRun?.id === run.id ? 'border-slate-500 bg-slate-50' : 'border-gray-200 bg-white hover:border-slate-300'}`}
                  onClick={() => { setSelectedRun(run); fetchRunItems(run.id); }}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm text-gray-800">{run.month}/{run.year}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${PAYROLL_STATUS_COLORS[run.status] || 'bg-gray-100'}`}>{PAYROLL_STATUS_LABELS[run.status] || run.status}</span>
                        <span className="text-xs text-gray-400">{run.employee_count} موظف</span>
                      </div>
                      <div className="flex gap-4 text-xs text-gray-600">
                        <span>الإجمالي: <strong className="text-gray-800">{fmtMoney(run.total_amount || run.total_gross || 0)}</strong></span>
                        <span>الصافي: <strong className="text-emerald-700">{fmtMoney(run.total_amount || run.total_net || 0)}</strong></span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {run.status === 'CALCULATED' && canManageFinance && (
                        <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'APPROVED'); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition">اعتماد</button>
                      )}
                      {run.status === 'APPROVED' && canManageFinance && (
                        <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'PAID'); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition">تأكيد الصرف</button>
                      )}
                      {canManagePayroll && (run.status === 'CALCULATED' || (run.status === 'APPROVED' && canManageFinance)) && (
                        <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'CANCELLED'); }} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-red-100 hover:text-red-700 transition">إلغاء</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Run items breakdown */}
          {selectedRun && payrollItems.length > 0 && (
            <div className="mt-4">
              <h4 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2">
                <BarChart3 size={14}/> تفاصيل كشف {selectedRun.month}/{selectedRun.year}
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-right text-[11px] font-bold text-gray-500">
                      <th className="px-3 py-2">الموظف</th>
                      <th className="px-3 py-2">الراتب الأساسي</th>
                      <th className="px-3 py-2">البدلات</th>
                      <th className="px-3 py-2">العمولة</th>
                      <th className="px-3 py-2">مكافآت</th>
                      <th className="px-3 py-2">استقطاعات</th>
                      <th className="px-3 py-2 font-black text-slate-700">صافي الراتب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {payrollItems.map(item => {
                      const allowances = (item.total_allowances || item.allowances_total || 0);
                      const deductions = (item.absence_deductions || item.absence_deduction || 0) +
                        (item.late_deductions || item.late_deduction || 0) +
                        (item.other_deductions || item.other_deduction || 0) +
                        (item.advance_deductions || item.advance_deduction || 0);
                      const bonuses = (item.commission || 0) + (item.instructor_earnings || 0) + (item.bonus_amount || 0);
                      return (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-bold text-gray-800">{item.staff_name || item.name || '—'}</td>
                          <td className="px-3 py-2">{fmtMoney(item.base_salary || 0)}</td>
                          <td className="px-3 py-2 text-blue-600">{allowances > 0 ? fmtMoney(allowances) : '—'}</td>
                          <td className="px-3 py-2 text-amber-600">{(item.commission || 0) > 0 ? fmtMoney(item.commission || 0) : '—'}</td>
                          <td className="px-3 py-2 text-emerald-600">{bonuses - (item.commission || 0) > 0 ? fmtMoney(bonuses - (item.commission || 0)) : '—'}</td>
                          <td className="px-3 py-2 text-red-600">{deductions > 0 ? `-${fmtMoney(deductions)}` : '—'}</td>
                          <td className="px-3 py-2 font-black text-slate-700">{fmtMoney(item.net_salary || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={6} className="px-3 py-2 font-black text-slate-700">الإجمالي</td>
                      <td className="px-3 py-2 font-black text-slate-700">{fmtMoney(payrollItems.reduce((s, i) => s + (i.net_salary || 0), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

      </div>
  );
}
