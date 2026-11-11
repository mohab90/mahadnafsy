// «كشف الشهر — الحضور والمرتب لكل موظف»: the ONE table of the month. It used to be drawn three times on the page (this sheet, an attendance table and
// the payroll run's lines); now it holds everything: the fingerprint upload, the payroll run's calculate / approve / pay, and for each employee the
// department, the net basic salary (basic less absence and lateness), the bonuses, the month's total pay (an estimate before the run), attendance, deductions
// and an edit button that opens every part of the employee's month.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Award, CalendarCheck, Gavel, Loader2, Pencil, Save, Upload, Wallet } from 'lucide-react';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';
import { departmentRank } from '../../../../../shared/staffDepartment';
import { mysqlAdmin, type SheetBonusPlan } from '../../../../lib/mysqlapi';
import { PAYROLL_STATUS_LABELS, PAYROLL_STATUS_COLORS } from './hrLabels';
import { fmtMoney } from './hrFormat';
import { useAutoResizableColumns } from '../../../../components/useAutoResizableColumns';
import HrFingerprintUpload from './HrFingerprintUpload';
import HrMonthEditModal from './HrMonthEditModal';
import HrPenaltyModal from './HrPenaltyModal';
import HrBonusInlineEditor from './HrBonusInlineEditor';
import { BonusRoundCells, BonusTotalCell, RoundOverrideEditor } from './HrBonusRoundCells';
import { bonusTotal, estimatedMonthPay, netBasicSalary } from './bonusSheetCells';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type AttendanceRow = {
  id: string; name: string; department_name?: string | null; biometric_user_no?: string | null; base_salary?: number | null;
  present_days?: number; absent_days?: number; late_days?: number; total_late_minutes?: number;
  leave_days?: number; deduction_days?: number | string; overtime_days?: number | string; flagged_days?: number; free_days_used?: number; free_days_allowed?: number;
  excused_days?: number; absence_charged_days?: number | string; paid_days?: number; left_on?: string | null; hired_on?: string | null; leave_balance?: { entitlement: number; used: number; remaining: number };
  bonuses?: { approved: number; pending: number; deductionsApproved: number; deductionsPending: number; manualApproved?: number; manualPending?: number; planSaved?: { amount: number; approved: boolean } | null };
  /** The month's bonus-plan figures: the rounds of a sales rep, the collector's level (null for an employee on no scheme). */
  bonus_plan?: SheetBonusPlan | null;
};
type Changed = { attendanceStaff: number; bonusStaff: number };
type Run = { id: string; month: number | string; year: number | string; status: string; employee_count?: number };
type Item = {
  staff_id: string; base_salary?: number | string; net_salary?: number | string;
  absence_deductions?: number | string; absence_deduction?: number | string;
  late_deductions?: number | string; late_deduction?: number | string;
  other_deductions?: number | string; other_deduction?: number | string;
  advance_deductions?: number | string; advance_deduction?: number | string;
  commission?: number | string; bonus_amount?: number | string; total_allowances?: number | string; allowances_total?: number | string; instructor_earnings?: number | string;
};
const num = (value: unknown) => Number(value) || 0;
const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');
const PAY_MONTH_DAYS = 30; // a day's pay is the month's salary over thirty (api/lib/payrollCalc.js)
const COLUMNS = 18;
const HEAD = 'sticky top-0 z-20 whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2';
const STICKY_HEAD = 'sticky top-0 whitespace-nowrap border-b border-gray-200 bg-gray-100 px-3 py-2';
const CELL = 'whitespace-nowrap border-b border-gray-100 px-3 py-2';

export default function HrMonthSheet({ notify, canManageFinance, canManagePayroll }: { notify: Notify; canManageFinance: boolean; canManagePayroll: boolean }) {
  const [month, setMonth] = useState(cairoMonthOnly());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [items, setItems] = useState<Map<string, Item>>(new Map());
  const [run, setRun] = useState<Run | null>(null);
  // What changed after the run was calculated (attendance edited, a bonus approved): the run does not have it until it is calculated again.
  const [changed, setChanged] = useState<Changed | null>(null);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [penalising, setPenalising] = useState(false);
  const [editingBonus, setEditingBonus] = useState<string | null>(null);
  const [editingRound, setEditingRound] = useState<{ id: string; round: number } | null>(null);
  const [savingBonuses, setSavingBonuses] = useState(false);
  const tableRef = useAutoResizableColumns('hr-month-sheet');

  const load = useCallback(async () => {
    const [y, m] = month.split('-');
    setLoading(true);
    try {
      const [summary, runs] = await Promise.allSettled([
        mysqlAdmin.adminGet<AttendanceRow[]>(`/admin/hr/attendance/summary?month=${parseInt(m, 10)}&year=${y}`),
        mysqlAdmin.adminGet<Run[]>('/admin/hr/payroll'),
      ]);
      setAttendance(summary.status === 'fulfilled' && Array.isArray(summary.value) ? summary.value : []);
      const monthRuns = runs.status === 'fulfilled' && Array.isArray(runs.value)
        ? runs.value.filter(r => Number(r.month) === parseInt(m, 10) && Number(r.year) === Number(y) && r.status !== 'CANCELLED')
        : [];
      const details = await Promise.allSettled(monthRuns.map(r => mysqlAdmin.adminGet<{ items?: Item[]; changedSinceCalculation?: Changed }>(`/admin/hr/payroll/${encodeURIComponent(r.id)}`)
        .then(data => ({ items: data.items || [], changed: data.changedSinceCalculation || null }))));
      const byStaff = new Map<string, Item>();
      for (const result of details) if (result.status === 'fulfilled') for (const item of result.value.items) byStaff.set(item.staff_id, item);
      setItems(byStaff);
      const firstDetail = details[0];
      setChanged(firstDetail?.status === 'fulfilled' ? firstDetail.value.changed : null);
      setRun(monthRuns[0] || null);
      if (summary.status === 'rejected') notify('error', 'تعذر تحميل حضور الشهر');
    } finally { setLoading(false); }
  }, [month, notify]);
  useEffect(() => { void load(); }, [load]);

  const calculate = async () => {
    const [y, m] = month.split('-');
    setCalculating(true);
    try {
      const data = await mysqlAdmin.adminPost<{ skippedNoSalary?: { id: string; name: string }[]; attendanceWarnings?: { name: string; unmarkedDays: number }[]; noHireDate?: { name: string }[] }>(
        '/admin/hr/payroll/calculate', { month: parseInt(m, 10), year: Number(y), branch_id: 'branch-all', skip_missing_salary: true });
      notify('success', 'اتحسب مسير الشهر');
      if (data.skippedNoSalary?.length) {
        notify('info', `${data.skippedNoSalary.length} موظف ما اتحسبلهمش مرتب لإن الراتب الأساسي بتاعهم فاضي: ${data.skippedNoSalary.slice(0, 8).map(s => s.name).join('، ')} — اكتب راتبهم من «تعديل» واحسب تاني`);
      }
      if (data.noHireDate?.length) {
        notify('info', `${data.noHireDate.length} موظف ما عندهمش تاريخ تعيين فاتحسبلهم الشهر كامل: ${data.noHireDate.slice(0, 8).map(s => s.name).join('، ')} — اكتب تاريخ تعيينهم لو ما اشتغلوش الشهر كله واحسب تاني`);
      }
      const gaps = data.attendanceWarnings || [];
      if (gaps.length) notify('info', `${gaps.length} موظف عندهم أيام محدش سجّل فيها حضور أو غياب ومش متخصمة: ${gaps.slice(0, 5).map(g => `${g.name} (${g.unmarkedDays})`).join('، ')}`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل احتساب المسير');
    } finally { setCalculating(false); }
  };
  // The month's bonuses (the rounds, the owner's figures in them) written as bonuses awaiting approval in «اعتمادات المرتبات»: what the round columns show.
  const saveBonuses = async () => {
    setSavingBonuses(true);
    try {
      const result = await mysqlAdmin.saveMonthlyBonuses(month);
      notify('success', `اتحفظت مكافآت ${result.written.length} موظف للاعتماد${result.kept.length ? ` — ${result.kept.length} معتمدة قبل كده فاتسابت زي ما هي` : ''}`);
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر حفظ المكافآت'); } finally { setSavingBonuses(false); }
  };
  const setRunStatus = async (status: string) => {
    if (!run) return;
    try {
      await mysqlAdmin.adminPut(`/admin/hr/payroll/${encodeURIComponent(run.id)}/status`, { status });
      notify('success', `المسير بقى «${PAYROLL_STATUS_LABELS[status] || status}»`);
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل التحديث'); }
  };

  const rows = useMemo(() => attendance.map(row => {
    const item = items.get(row.id);
    const deductions = item
      ? num(item.absence_deductions ?? item.absence_deduction) + num(item.late_deductions ?? item.late_deduction)
        + num(item.other_deductions ?? item.other_deduction) + num(item.advance_deductions ?? item.advance_deduction)
      : null;
    // A worked weekly day off is overtime: the day's pay times what HR set it at (1, 1.5, 2 … days; api/lib/payrollCalc.js).
    const overtimePay = row.base_salary ? (num(row.base_salary) / PAY_MONTH_DAYS) * num(row.overtime_days) : 0;
    // 10 Nov 2026, «الراتب الاساسي 5000 اتخصم منه غياب وتاخير … نكتب صافي الاساسي كام والمكافاه كام وبعدها اجمالي الراتب»: the basic salary less absence and
    // lateness, then the bonuses, then the month's pay — the run's net once it is calculated, before it an estimate so the column is never just «not calculated».
    const netBasic = netBasicSalary({
      base: num(row.base_salary), chargedDays: num(row.absence_charged_days) + num(row.deduction_days), paidDays: row.paid_days ?? 30,
      run: item ? { base: num(item.base_salary), attendanceDeductions: num(item.absence_deductions ?? item.absence_deduction) + num(item.late_deductions ?? item.late_deduction) } : null,
    });
    const extraDeductions = num(row.bonuses?.deductionsApproved) + num(row.bonuses?.deductionsPending);
    const estimate = !item && netBasic !== null
      ? estimatedMonthPay({ netBasic, bonuses: bonusTotal(row.bonus_plan || null, row.bonuses), overtimePay, extraDeductions })
      : null;
    // The salary with the month's additions and before any deduction: base + allowances + commission + teaching + the bonus HR typed; before the run, the basic salary.
    const gross = item
      ? num(item.base_salary) + num(item.total_allowances ?? item.allowances_total) + num(item.commission) + num(item.instructor_earnings) + num(item.bonus_amount) + overtimePay
      : (row.base_salary ? num(row.base_salary) + overtimePay : null);
    return { row, item, deductions, netBasic, estimate, gross, overtimePay };
  }), [attendance, items]);
  // One block per department, in the order above.
  const groups = useMemo(() => {
    const byDepartment = new Map<string, typeof rows>();
    for (const entry of rows) {
      const name = entry.row.department_name || 'أخرى';
      byDepartment.set(name, [...(byDepartment.get(name) || []), entry]);
    }
    return [...byDepartment.entries()].sort((a, b) => departmentRank(a[0]) - departmentRank(b[0]) || a[0].localeCompare(b[0], 'ar'));
  }, [rows]);
  const totals = useMemo(() => rows.reduce((acc, { row, item }) => ({
    absent: acc.absent + num(row.absent_days), late: acc.late + num(row.late_days),
    net: acc.net + (item ? num(item.net_salary) : 0), noSalary: acc.noSalary + (row.base_salary ? 0 : 1),
  }), { absent: 0, late: 0, net: 0, noSalary: 0 }), [rows]);

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
          <CalendarCheck size={16} className="text-indigo-600" /> كشف الشهر — الحضور والمرتب لكل موظف
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {run
            ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${PAYROLL_STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-600'}`}>مسير الرواتب: {PAYROLL_STATUS_LABELS[run.status] || run.status}</span>
            : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">مفيش مسير رواتب للشهر ده لسه — دوس «احسب المسير»</span>}
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
          <button type="button" onClick={() => setShowUpload(true)} className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"><Upload size={13} /> رفع شيت البصمة</button>
          <button type="button" onClick={() => setPenalising(true)} className="flex items-center gap-1 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white"><Gavel size={13} /> خصم جزاء من المدير</button>
          {canManagePayroll && attendance.some(row => row.bonus_plan) && (
            <button type="button" onClick={() => void saveBonuses()} disabled={savingBonuses} className="flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {savingBonuses ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} حفظ المكافآت للاعتماد
            </button>
          )}
          <button type="button" onClick={() => void calculate()} disabled={calculating || run?.status === 'APPROVED' || run?.status === 'PAID'} className="flex items-center gap-1 rounded-xl bg-slate-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {calculating ? <Loader2 size={13} className="animate-spin" /> : <Award size={13} />} {run ? 'أعد حساب المسير' : 'احسب المسير'}
          </button>
          {run?.status === 'CALCULATED' && canManageFinance && <button type="button" onClick={() => void setRunStatus('APPROVED')} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">اعتماد</button>}
          {run?.status === 'APPROVED' && canManageFinance && <button type="button" onClick={() => void setRunStatus('PAID')} className="rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-bold text-white">تأكيد الصرف</button>}
          {run && canManagePayroll && (run.status === 'CALCULATED' || (run.status === 'APPROVED' && canManageFinance)) && (
            <button type="button" onClick={() => void setRunStatus('CANCELLED')} className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-red-50 hover:text-red-600">إلغاء المسير</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-gray-100 px-2.5 py-1">{n(attendance.length)} موظف</span>
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{n(totals.absent)} يوم غياب</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{n(totals.late)} يوم تأخير</span>
        {totals.noSalary > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 font-bold text-red-700">{n(totals.noSalary)} موظف من غير راتب أساسي — مش هيتحسبلهم مرتب</span>}
        {items.size > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"><Wallet size={12} /> صافي المرتبات {fmtMoney(totals.net)}</span>}
      </div>

      {run && changed && (changed.attendanceStaff > 0 || changed.bonusStaff > 0) && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          المسير اتحسب قبل تعديلات حصلت بعده{changed.attendanceStaff > 0 ? ` — حضور ${n(changed.attendanceStaff)} موظف اتعدّل` : ''}{changed.bonusStaff > 0 ? ` — مكافآت ${n(changed.bonusStaff)} موظف اتعتمدت` : ''}.
          {run.status === 'CALCULATED' ? ' دوس «أعد حساب المسير» قبل الاعتماد.' : run.status === 'APPROVED' ? ' الأرقام في المسير المعتمد مش فيها التعديلات دي: ألغي المسير واحسبه تاني قبل الصرف.' : ' المسير اتصرف بالأرقام القديمة؛ التعديلات دي مش فيه.'}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" size={20} /></div>
      ) : (
        // 9 Nov 2026, «سكرول علي الشمال ولكن عمود اسم الموظف يكون ثابت»: the name stays put while the rest scrolls and the header stays at the top. The money reads
        // in the order it adds up (10 Nov 2026): the net basic salary, the bonuses, the month's total pay, then what was typed by hand.
        <div className="max-h-[72vh] overflow-auto rounded-xl border border-gray-200">
          <table ref={tableRef} className="w-full min-w-[1500px] border-separate border-spacing-0 text-sm">
            <thead className="text-right text-xs font-bold text-gray-500">
              <tr>
                <th className={`${STICKY_HEAD} right-0 z-30 min-w-[210px] border-l border-gray-200`}>الموظف</th>
                <th className={`${HEAD} min-w-[130px] text-gray-800`} title="الراتب الأساسي بعد خصم الغياب والتأخير">صافي الأساسي</th>
                <th className={`${HEAD} min-w-[150px] text-emerald-700`}>مكافأة الروند الأولى</th>
                <th className={`${HEAD} min-w-[150px] text-emerald-700`}>مكافأة الروند الثانية</th>
                <th className={`${HEAD} min-w-[150px] text-emerald-700`}>إجمالي المكافآت</th>
                <th className={`${HEAD} min-w-[140px] text-gray-800`} title="صافي الأساسي + المكافآت، بعد باقي الإضافات والخصومات">إجمالي الراتب</th>
                <th className={`${HEAD} min-w-[210px] text-emerald-700`}>مكافآت يدوية وإضافي</th>
                <th className={`${HEAD} min-w-[110px] text-red-600`}>الخصومات</th>
                <th className={`${HEAD} min-w-[130px]`}>الإجمالي قبل الخصم</th>
                <th className={`${HEAD} min-w-[110px]`}>الراتب الأساسي</th>
                <th className={HEAD}>أيام خصم</th>
                <th className={HEAD}>حضور</th>
                <th className={HEAD}>غياب</th>
                <th className={HEAD}>تأخير</th>
                <th className={HEAD}>إجازات</th>
                <th className={HEAD}>يوم مجاني</th>
                <th className={HEAD}>رصيد الإجازات</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {groups.map(([department, members]) => (
                <Fragment key={department}>
                  <tr>
                    <td className="sticky right-0 z-10 border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-extrabold text-indigo-900">{department} <span className="font-semibold text-indigo-700">· {n(members.length)}</span></td>
                    <td colSpan={COLUMNS - 1} className="border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                      {members.some(member => member.item) && <span className="ml-3 text-emerald-700">الصافي {fmtMoney(members.reduce((sum, member) => sum + num(member.item?.net_salary), 0))}</span>}
                      الإجمالي قبل الخصم {fmtMoney(members.reduce((sum, member) => sum + (member.gross || 0), 0))}
                    </td>
                  </tr>
                  {members.map(({ row, item, deductions, netBasic, estimate, gross, overtimePay }) => {
                    const bonus = row.bonuses || { approved: 0, pending: 0, deductionsApproved: 0, deductionsPending: 0 };
                    const open = editingBonus === row.id;
                    const roundOpen = editingRound?.id === row.id ? row.bonus_plan?.rounds?.find(round => round.round === editingRound.round) : undefined;
                    // Only what somebody typed: the plan's bonuses have their own columns and nothing here is worked out by the system.
                    const manualApproved = num(bonus.manualApproved);
                    const manualPending = num(bonus.manualPending);
                    const basic = num(item ? item.base_salary : row.base_salary);
                    const nothing = !manualApproved && !manualPending && !bonus.deductionsApproved && !bonus.deductionsPending && !num(row.overtime_days);
                    return (
                      <Fragment key={row.id}>
                        <tr className="group">
                          <td className={`${CELL} sticky right-0 z-10 border-l border-gray-200 bg-white group-hover:bg-slate-50`}>
                            <p className="font-bold text-gray-800">{row.name}</p>
                            <p className="text-[11px] text-gray-400">{row.biometric_user_no ? `بصمة #${row.biometric_user_no}` : 'بدون رقم بصمة'}</p>
                          </td>
                          <td className={`${CELL} tabular-nums text-gray-900`}>
                            {netBasic === null ? <span className="text-xs text-gray-400">من غير راتب أساسي</span> : (
                              <>
                                <p className="text-sm font-bold">{item ? '' : '≈ '}{fmtMoney(Math.round(netBasic))}</p>
                                {basic - netBasic >= 0.5 && <p className="text-[10px] text-red-600">من {fmtMoney(basic)} · غياب وتأخير −{fmtMoney(Math.round(basic - netBasic))}</p>}
                              </>
                            )}
                          </td>
                          <BonusRoundCells plan={row.bonus_plan || null} canEdit={canManageFinance} onEdit={round => setEditingRound({ id: row.id, round })} />
                          <BonusTotalCell plan={row.bonus_plan || null} bonuses={row.bonuses} />
                          <td className={`${CELL} bg-emerald-50/40 text-base font-extrabold tabular-nums text-gray-900`}>
                            {item ? fmtMoney(num(item.net_salary))
                              : estimate !== null ? <span className="text-sm font-semibold text-gray-500" title="تقدير: صافي الأساسي + المكافآت والأوفر تايم − الخصم الإضافي — احسب المسير لتثبيته">≈ {fmtMoney(Math.round(estimate))}</span>
                                : <span className="text-xs font-normal text-gray-400">—</span>}
                            {item && num(item.commission) > 0 && <p className="text-[10px] font-normal text-amber-700" title="المسير حسبها تلقائي من قواعد العمولات، مش من نظام المكافآت ولا مدخلة يدوي">فيه حوافز مبيعات تلقائية {fmtMoney(num(item.commission))}</p>}
                          </td>
                          <td className={`${CELL} tabular-nums`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-0.5 text-xs">
                                {manualApproved > 0 && <p className="font-bold text-emerald-700">مكافأة يدوية +{fmtMoney(manualApproved)}</p>}
                                {manualPending > 0 && <p className="text-amber-600">يدوية مستنية الاعتماد +{fmtMoney(manualPending)}</p>}
                                {bonus.deductionsApproved + bonus.deductionsPending > 0 && <p className="text-red-600">خصم إضافي −{fmtMoney(bonus.deductionsApproved + bonus.deductionsPending)}{bonus.deductionsPending ? ' (جزء مستني)' : ''}</p>}
                                {num(row.overtime_days) > 0 && <p className="text-indigo-700">أوفر تايم {n(num(row.overtime_days))} يوم{overtimePay ? ` +${fmtMoney(Math.round(overtimePay))}` : ''}</p>}
                                {nothing && <p className="text-gray-300">—</p>}
                              </div>
                              <button type="button" onClick={() => setEditingBonus(open ? null : row.id)}
                                className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold ${open ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>± مكافأة</button>
                            </div>
                          </td>
                          <td className={`${CELL} tabular-nums text-red-600`}>{deductions ? `−${fmtMoney(deductions)}` : '—'}</td>
                          <td className={`${CELL} tabular-nums text-emerald-800`}>{gross !== null ? <span className={item ? 'font-semibold' : 'text-xs text-gray-500'}>{item ? '' : '≈ '}{fmtMoney(Math.round(gross))}</span> : <span className="text-gray-300">—</span>}</td>
                          <td className={`${CELL} tabular-nums`}>{row.base_salary ? fmtMoney(num(row.base_salary)) : <span className="text-xs font-bold text-red-600">فاضي</span>}</td>
                          <td className={`${CELL} tabular-nums ${num(row.deduction_days) ? 'font-bold text-amber-700' : 'text-gray-300'}`}>{num(row.deduction_days) ? n(num(row.deduction_days)) : '—'}</td>
                          <td className={`${CELL} tabular-nums text-emerald-700`}>{n(num(row.present_days))}</td>
                          <td className={`${CELL} tabular-nums ${num(row.absent_days) ? 'font-bold text-red-600' : 'text-gray-300'}`}>
                            {n(num(row.absent_days))}
                            {num(row.excused_days) > 0 && <span className="mr-1 text-[10px] font-normal text-gray-500">{n(num(row.excused_days))} بإذن · {n(num(row.absent_days) - num(row.excused_days))} بدون</span>}
                          </td>
                          <td className={`${CELL} tabular-nums text-gray-700`}>{num(row.late_days) ? `${n(num(row.late_days))} يوم · ${n(num(row.total_late_minutes))} د` : '—'}</td>
                          <td className={`${CELL} tabular-nums text-gray-700`}>{num(row.leave_days) ? n(num(row.leave_days)) : '—'}</td>
                          <td className={`${CELL} tabular-nums text-sky-700`}>{num(row.free_days_allowed) || num(row.free_days_used) ? `${n(num(row.free_days_used))} من ${n(num(row.free_days_allowed))}` : <span className="text-gray-300">—</span>}</td>
                          <td className={`${CELL} tabular-nums text-sky-700`} title="٢١ يوم في السنة؛ اليوم المجاني والإجازة الاعتيادية والغياب «من رصيد الإجازات» كل واحد بيخصم يوم">
                            {row.leave_balance ? `${n(row.leave_balance.remaining)} من ${n(row.leave_balance.entitlement)}` : <span className="text-gray-300">—</span>}
                          </td>
                          <td className={CELL}>
                            <button type="button" onClick={() => setEditing({ id: row.id, name: row.name })} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"><Pencil size={12} /> تعديل</button>
                          </td>
                        </tr>
                        {roundOpen && (
                          <tr>
                            <td colSpan={COLUMNS} className="border-b border-indigo-100 bg-indigo-50/40 p-0">
                              <div className="sticky right-0 w-[min(calc(100vw-4rem),760px)] p-3">
                                <RoundOverrideEditor staffId={row.id} name={row.name} month={month} round={roundOpen} notify={notify} onSaved={() => void load()} onClose={() => setEditingRound(null)} />
                              </div>
                            </td>
                          </tr>
                        )}
                        {open && (
                          <tr>
                            <td colSpan={COLUMNS} className="border-b border-emerald-100 bg-emerald-50/40 p-0">
                              <div className="sticky right-0 w-[min(calc(100vw-4rem),760px)] p-3">
                                <HrBonusInlineEditor staffId={row.id} name={row.name} month={month} notify={notify} onSaved={() => void load()} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={COLUMNS} className="py-10 text-center text-gray-400">مفيش موظفين نشطين</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {penalising && <HrPenaltyModal employees={attendance} month={month} notify={notify} onClose={() => setPenalising(false)} onSaved={() => void load()} />}
      {showUpload && <HrFingerprintUpload month={month} notify={notify} onClose={() => setShowUpload(false)} onImported={imported => { setMonth(imported); void load(); }} />}
      {editing && (
        <HrMonthEditModal staffId={editing.id} name={editing.name} month={month} canEditSalary={canManageFinance} notify={notify}
          onClose={() => setEditing(null)} onSaved={() => void load()} />
      )}
    </section>
  );
}
