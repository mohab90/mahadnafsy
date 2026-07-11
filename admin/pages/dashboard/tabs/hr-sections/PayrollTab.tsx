import React from 'react';
import { Wallet, Award, BarChart3 } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import { PAYROLL_STATUS_LABELS, PAYROLL_STATUS_COLORS, fmtMoney } from './shared';

interface Props {
  payrollMonth: string;
  setPayrollMonth: React.Dispatch<React.SetStateAction<string>>;
  payrollRuns: any[];
  loadingPayroll: boolean;
  calculating: boolean;
  calculatePayroll: () => void;
  fetchPayrollRuns: () => void;
  selectedRun: any;
  setSelectedRun: React.Dispatch<React.SetStateAction<any>>;
  payrollItems: any[];
  fetchRunItems: (runId: string) => void;
  updatePayrollRunStatus: (runId: string, status: string) => void;
  perfMonth: string;
  setPerfMonth: React.Dispatch<React.SetStateAction<string>>;
  safeStaff: StaffMember[];
  safeOrders: any[];
  safeLeads: any[];
  onSelect: (member: StaffMember) => void;
}

const PayrollTab: React.FC<Props> = ({
  payrollMonth, setPayrollMonth, payrollRuns, loadingPayroll, calculating, calculatePayroll,
  fetchPayrollRuns, selectedRun, setSelectedRun, payrollItems, fetchRunItems, updatePayrollRunStatus,
  perfMonth, setPerfMonth, safeStaff, safeOrders, safeLeads, onSelect,
}) => (
  <div className="space-y-4">
    {/* Server payroll section */}
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Wallet size={16}/> كشوف الرواتب الرسمية</h3>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">شهر الاحتساب</label>
          <input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
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
                  {run.status === 'CALCULATED' && (
                    <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'APPROVED'); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition">اعتماد</button>
                  )}
                  {run.status === 'APPROVED' && (
                    <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'PAID'); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition">تأكيد الصرف</button>
                  )}
                  {(run.status === 'CALCULATED' || run.status === 'APPROVED') && (
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
                      <td className="px-3 py-2 text-amber-600">{item.commission > 0 ? fmtMoney(item.commission) : '—'}</td>
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

    {/* Quick estimate (local) */}
    <details className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <summary className="px-5 py-3 cursor-pointer font-bold text-sm text-gray-600 flex items-center gap-2 select-none hover:bg-gray-50">
        <BarChart3 size={14}/> تقدير سريع (من بيانات النظام المحلية)
      </summary>
      <div className="px-0 overflow-x-auto">
        <div className="px-4 py-2 border-t border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <label className="text-xs text-gray-500">شهر التقدير:</label>
            <input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs"/>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
            <th className="px-4 py-2">الموظف</th>
            <th className="px-4 py-2">الراتب الأساسي</th>
            <th className="px-4 py-2">العمولة</th>
            <th className="px-4 py-2">المكافأة</th>
            <th className="px-4 py-2">الإجمالي</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {safeStaff.filter(s => s.status === 'active').map(s => {
              const start = perfMonth + '-01';
              const end = new Date(new Date(start).getTime() + 32 * 86400000).toISOString().slice(0, 7) + '-01';
              const rev = safeOrders.filter((o: any) => o.staffId === s.id && o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) < end).reduce((sm: number, o: any) => sm + (o.amount || 0), 0);
              const comm = rev * (s.commissionRate || 0) / 100;
              const conv = safeLeads.filter((l: any) => l.assignedSalesId === s.id && l.status === 'converted').length;
              const prog = (s.monthlyTargetType || 'egp') === 'egp' ? rev : conv;
              const bon = (s.monthlyTarget || 0) > 0 && prog >= (s.monthlyTarget || 0) ? (s.monthlyBonus || 0) : 0;
              return (
                <tr key={s.id} className="hover:bg-gray-50 cursor-pointer text-xs" onClick={() => onSelect(s)}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-[10px] shrink-0">{s.name.charAt(0)}</div>
                      <span className="font-bold text-gray-800">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">{s.salary ? fmtMoney(s.salary) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2 text-amber-700 font-bold">{comm > 0 ? fmtMoney(comm) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2 text-emerald-700 font-bold">{bon > 0 ? fmtMoney(bon) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2 font-black text-slate-700">{(s.salary || 0) + comm + bon > 0 ? fmtMoney((s.salary || 0) + comm + bon) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  </div>
);

export default PayrollTab;
