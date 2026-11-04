// «كشف الشهر — الحضور والمرتب لكل موظف»: the ONE table of the month. It used to be drawn three times on the page (this sheet, an attendance table and
// the payroll run's lines); now it holds everything: the fingerprint upload, the payroll run's calculate / approve / pay, and for each employee the
// department, basic salary, attendance, free day, deductions, the net (or an estimate before the run), the required / reached / bonus of the month
// and an edit button that opens every part of the employee's month.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Award, CalendarCheck, Gavel, Loader2, Pencil, Save, Upload, Wallet } from 'lucide-react';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';
import { departmentRank } from '../../../../../shared/staffDepartment';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { PAYROLL_STATUS_LABELS, PAYROLL_STATUS_COLORS } from './hrLabels';
import { fmtMoney } from './hrFormat';
import { useAutoResizableColumns } from '../../../../components/useAutoResizableColumns';
import HrFingerprintUpload from './HrFingerprintUpload';
import HrMonthEditModal from './HrMonthEditModal';
import HrPenaltyModal from './HrPenaltyModal';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type AttendanceRow = {
  id: string; name: string; department_name?: string | null; biometric_user_no?: string | null; base_salary?: number | null;
  present_days?: number; absent_days?: number; late_days?: number; total_late_minutes?: number;
  leave_days?: number; deduction_days?: number | string; flagged_days?: number; free_days_used?: number; free_days_allowed?: number;
  excused_days?: number; leave_balance?: { entitlement: number; used: number; remaining: number };
};
type Run = { id: string; month: number | string; year: number | string; status: string; employee_count?: number };
type Item = {
  staff_id: string; base_salary?: number | string; net_salary?: number | string;
  absence_deductions?: number | string; absence_deduction?: number | string;
  late_deductions?: number | string; late_deduction?: number | string;
  other_deductions?: number | string; other_deduction?: number | string;
  advance_deductions?: number | string; advance_deduction?: number | string;
  commission?: number | string; bonus_amount?: number | string; total_allowances?: number | string; allowances_total?: number | string; instructor_earnings?: number | string;
};
type MonthBonus = {
  staffId: string;
  standing: { type: 'clients' | 'bookings' | 'egp' | null; target: number | null; bonus: number | null };
  entry: { id: string; amount: number; status: string; note: string; targetValue: number | null; achievedValue: number | null; targetUnit: string | null; locked: boolean } | null;
};
type BonusDraft = { targetValue?: string; achievedValue?: string; amount?: string };
const UNIT_AR: Record<string, string> = { clients: 'عميل', bookings: 'حجز', egp: 'جنيه' };
const BONUS_STATUS_AR: Record<string, string> = { PENDING: 'مستني الاعتماد', APPROVED: 'معتمدة', REJECTED: 'مرفوضة' };

const num = (value: unknown) => Number(value) || 0;
const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');
const PAY_MONTH_DAYS = 30; // a day's pay is the month's salary over thirty (api/lib/payrollCalc.js)
const UNEXCUSED_ABSENCE_DAYS = 2; // a day missed without permission costs two (api/lib/payrollCalc.js)

export default function HrMonthSheet({ notify, canManageFinance, canManagePayroll }: { notify: Notify; canManageFinance: boolean; canManagePayroll: boolean }) {
  const [month, setMonth] = useState(cairoMonthOnly());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [items, setItems] = useState<Map<string, Item>>(new Map());
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [bonuses, setBonuses] = useState<Map<string, MonthBonus>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, BonusDraft>>({});
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [penalising, setPenalising] = useState(false);
  const tableRef = useAutoResizableColumns('hr-month-sheet');

  const load = useCallback(async () => {
    const [y, m] = month.split('-');
    setLoading(true);
    try {
      const [summary, runs, bonusList] = await Promise.allSettled([
        mysqlAdmin.adminGet<AttendanceRow[]>(`/admin/hr/attendance/summary?month=${parseInt(m, 10)}&year=${y}`),
        mysqlAdmin.adminGet<Run[]>('/admin/hr/payroll'),
        mysqlAdmin.adminGet<MonthBonus[]>(`/admin/hr/month-bonuses?month=${parseInt(m, 10)}&year=${y}`),
      ]);
      setAttendance(summary.status === 'fulfilled' && Array.isArray(summary.value) ? summary.value : []);
      setBonuses(new Map(bonusList.status === 'fulfilled' && Array.isArray(bonusList.value) ? bonusList.value.map(b => [b.staffId, b]) : []));
      setDrafts({});
      const monthRuns = runs.status === 'fulfilled' && Array.isArray(runs.value)
        ? runs.value.filter(r => Number(r.month) === parseInt(m, 10) && Number(r.year) === Number(y) && r.status !== 'CANCELLED')
        : [];
      const details = await Promise.allSettled(monthRuns.map(r => mysqlAdmin.adminGet<{ items?: Item[] }>(`/admin/hr/payroll/${encodeURIComponent(r.id)}`)
        .then(data => data.items || [])));
      const byStaff = new Map<string, Item>();
      for (const result of details) if (result.status === 'fulfilled') for (const item of result.value) byStaff.set(item.staff_id, item);
      setItems(byStaff);
      setRun(monthRuns[0] || null);
      if (summary.status === 'rejected') notify('error', 'تعذر تحميل حضور الشهر');
    } finally { setLoading(false); }
  }, [month, notify]);
  useEffect(() => { void load(); }, [load]);

  const draftOf = (staffId: string, key: keyof BonusDraft): string => {
    const draft = drafts[staffId]?.[key];
    if (draft !== undefined) return draft;
    const entry = bonuses.get(staffId)?.entry;
    const value = key === 'targetValue' ? entry?.targetValue : key === 'achievedValue' ? entry?.achievedValue : entry?.amount;
    return value == null || (key === 'amount' && value === 0) ? '' : String(value);
  };
  const edit = (staffId: string, patch: BonusDraft) => setDrafts(current => ({ ...current, [staffId]: { ...current[staffId], ...patch } }));
  const saveBonuses = async () => {
    const [y, m] = month.split('-');
    const payload = Object.keys(drafts).map(staffId => ({
      staffId,
      targetValue: draftOf(staffId, 'targetValue'), achievedValue: draftOf(staffId, 'achievedValue'), amount: draftOf(staffId, 'amount'),
      targetUnit: bonuses.get(staffId)?.entry?.targetUnit || bonuses.get(staffId)?.standing.type || undefined,
      note: bonuses.get(staffId)?.entry?.note || '',
    }));
    if (!payload.length) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminPut('/admin/hr/month-bonuses', { month: parseInt(m, 10), year: Number(y), rows: payload });
      notify('success', `اتسجل المطلوب والمحقق والمكافأة لـ ${payload.length} موظف — المكافأة بتتحسب في المرتب بعد ما حد تاني يعتمدها`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ المكافآت');
    } finally { setSaving(false); }
  };

  const calculate = async () => {
    const [y, m] = month.split('-');
    setCalculating(true);
    try {
      const data = await mysqlAdmin.adminPost<{ skippedNoSalary?: { id: string; name: string }[]; attendanceWarnings?: { name: string; unmarkedDays: number }[] }>(
        '/admin/hr/payroll/calculate', { month: parseInt(m, 10), year: Number(y), branch_id: 'branch-all', skip_missing_salary: true });
      notify('success', 'اتحسب مسير الشهر');
      if (data.skippedNoSalary?.length) {
        notify('info', `${data.skippedNoSalary.length} موظف ما اتحسبلهمش مرتب لإن الراتب الأساسي بتاعهم فاضي: ${data.skippedNoSalary.slice(0, 8).map(s => s.name).join('، ')} — اكتب راتبهم من «تعديل» واحسب تاني`);
      }
      const gaps = data.attendanceWarnings || [];
      if (gaps.length) notify('info', `${gaps.length} موظف عندهم أيام محدش سجّل فيها حضور أو غياب ومش متخصمة: ${gaps.slice(0, 5).map(g => `${g.name} (${g.unmarkedDays})`).join('، ')}`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل احتساب المسير');
    } finally { setCalculating(false); }
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
    // Before the run: what the month would cost at the basic salary, so the column is never just «not calculated».
    const estimate = !item && row.base_salary
      ? Math.max(0, num(row.base_salary) - (num(row.base_salary) / PAY_MONTH_DAYS) * (num(row.absent_days) + (num(row.absent_days) - num(row.excused_days)) * (UNEXCUSED_ABSENCE_DAYS - 1) + num(row.deduction_days)))
      : null;
    // The salary with the month's additions and before any deduction: base + allowances + commission + teaching + bonus; before the run, base + the bonus typed here.
    const gross = item
      ? num(item.base_salary) + num(item.total_allowances ?? item.allowances_total) + num(item.commission) + num(item.instructor_earnings) + num(item.bonus_amount)
      : (row.base_salary ? num(row.base_salary) + num(bonuses.get(row.id)?.entry?.amount) : null);
    return { row, item, deductions, estimate, gross };
  }), [attendance, items, bonuses]);
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
  const changed = Object.keys(drafts).length;

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
          <button type="button" onClick={() => void calculate()} disabled={calculating || run?.status === 'APPROVED' || run?.status === 'PAID'} className="flex items-center gap-1 rounded-xl bg-slate-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {calculating ? <Loader2 size={13} className="animate-spin" /> : <Award size={13} />} {run ? 'أعد حساب المسير' : 'احسب المسير'}
          </button>
          {run?.status === 'CALCULATED' && canManageFinance && <button type="button" onClick={() => void setRunStatus('APPROVED')} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">اعتماد</button>}
          {run?.status === 'APPROVED' && canManageFinance && <button type="button" onClick={() => void setRunStatus('PAID')} className="rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-bold text-white">تأكيد الصرف</button>}
          {run && canManagePayroll && (run.status === 'CALCULATED' || (run.status === 'APPROVED' && canManageFinance)) && (
            <button type="button" onClick={() => void setRunStatus('CANCELLED')} className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-red-50 hover:text-red-600">إلغاء المسير</button>
          )}
          {changed > 0 && (
            <button type="button" onClick={() => void saveBonuses()} disabled={saving} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} احفظ المكافآت ({n(changed)})
            </button>
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

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" size={20} /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table ref={tableRef} className="w-full min-w-[1600px] text-sm">
            <thead className="bg-gray-50 text-right text-xs font-bold text-gray-500">
              <tr>
                <th className="px-3 py-2">الموظف</th>
                <th className="px-3 py-2">القسم</th>
                <th className="px-3 py-2">الراتب الأساسي</th>
                <th className="px-3 py-2">حضور</th>
                <th className="px-3 py-2">غياب</th>
                <th className="px-3 py-2">تأخير</th>
                <th className="px-3 py-2">إجازات</th>
                <th className="px-3 py-2">يوم مجاني</th>
                <th className="px-3 py-2">رصيد الإجازات</th>
                <th className="px-3 py-2">أيام خصم</th>
                <th className="px-3 py-2">عمولة ومكافأة</th>
                <th className="px-3 py-2">الخصومات</th>
                <th className="px-3 py-2">إجمالي بعد المكافأة</th>
                <th className="px-3 py-2">الصافي</th>
                <th className="border-r border-gray-200 px-3 py-2">المطلوب</th>
                <th className="px-3 py-2">المحقق</th>
                <th className="px-3 py-2">المكافأة</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {groups.map(([department, members]) => (
                <Fragment key={department}>
                  <tr className="bg-indigo-50/60">
                    <td colSpan={18} className="px-3 py-1.5 text-xs font-extrabold text-indigo-900">
                      {department} <span className="mr-2 font-semibold text-indigo-700">{n(members.length)} موظف</span>
                      <span className="mr-2 font-semibold text-indigo-700">إجمالي الرواتب بعد المكافأة {fmtMoney(members.reduce((sum, member) => sum + (member.gross || 0), 0))}</span>
                      {members.some(member => member.item) && <span className="mr-2 font-semibold text-emerald-700">الصافي {fmtMoney(members.reduce((sum, member) => sum + num(member.item?.net_salary), 0))}</span>}
                    </td>
                  </tr>
                  {members.map(({ row, item, deductions, estimate, gross }) => {
                const bonus = bonuses.get(row.id);
                const locked = Boolean(bonus?.entry?.locked);
                const unit = bonus?.entry?.targetUnit || bonus?.standing.type;
                const cell = 'w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm tabular-nums disabled:bg-gray-50 disabled:text-gray-500';
                return (
                  <tr key={row.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2">
                      <p className="font-bold text-gray-800">{row.name}</p>
                      <p className="text-[11px] text-gray-400">{row.biometric_user_no ? `بصمة #${row.biometric_user_no}` : 'بدون رقم بصمة'}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.department_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{row.base_salary ? fmtMoney(num(row.base_salary)) : <span className="text-xs font-bold text-red-600">فاضي</span>}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-700">{n(num(row.present_days))}</td>
                    <td className={`px-3 py-2 tabular-nums ${num(row.absent_days) ? 'font-bold text-red-600' : 'text-gray-300'}`}>
                      {n(num(row.absent_days))}
                      {num(row.excused_days) > 0 && <span className="mr-1 text-[10px] font-normal text-gray-500">{n(num(row.excused_days))} بإذن · {n(num(row.absent_days) - num(row.excused_days))} بدون</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{num(row.late_days) ? `${n(num(row.late_days))} يوم · ${n(num(row.total_late_minutes))} د` : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{num(row.leave_days) ? n(num(row.leave_days)) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-sky-700">{num(row.free_days_allowed) || num(row.free_days_used) ? `${n(num(row.free_days_used))} من ${n(num(row.free_days_allowed))}` : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 tabular-nums text-sky-700" title="٢١ يوم في السنة؛ اليوم المجاني والإجازة الاعتيادية والغياب «من رصيد الإجازات» كل واحد بيخصم يوم">
                      {row.leave_balance ? `${n(row.leave_balance.remaining)} من ${n(row.leave_balance.entitlement)}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${num(row.deduction_days) ? 'font-bold text-amber-700' : 'text-gray-300'}`}>{num(row.deduction_days) ? n(num(row.deduction_days)) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-700">{item && (num(item.commission) + num(item.bonus_amount)) ? `+${fmtMoney(num(item.commission) + num(item.bonus_amount))}` : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-red-600">{deductions ? `−${fmtMoney(deductions)}` : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-800">{gross !== null ? <span className={item ? 'font-semibold' : 'text-xs text-gray-500'}>{item ? '' : '≈ '}{fmtMoney(Math.round(gross))}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 font-extrabold tabular-nums text-gray-900">
                      {item ? fmtMoney(num(item.net_salary))
                        : estimate !== null ? <span className="text-xs font-semibold text-gray-500" title="تقدير من الراتب الأساسي والغياب والخصم — احسب المسير لتثبيته">≈ {fmtMoney(Math.round(estimate))}</span>
                          : <span className="text-xs font-normal text-gray-400">{row.base_salary ? 'لسه ما اتحسبش' : 'من غير راتب أساسي'}</span>}
                    </td>
                    <td className="border-r border-gray-100 px-3 py-2">
                      <input type="number" min={0} disabled={locked} className={cell} value={draftOf(row.id, 'targetValue')} placeholder={bonus?.standing.target != null ? String(bonus.standing.target) : ''}
                        onChange={e => edit(row.id, { targetValue: e.target.value })} />
                      {unit && <span className="mr-1 text-[11px] text-gray-400">{UNIT_AR[unit]}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} disabled={locked} className={cell} value={draftOf(row.id, 'achievedValue')} onChange={e => edit(row.id, { achievedValue: e.target.value })} />
                      {Number(draftOf(row.id, 'targetValue') || bonus?.standing.target) > 0 && draftOf(row.id, 'achievedValue') !== '' && (
                        <span className="mr-1 text-[11px] font-bold text-indigo-600">{n(Math.round((Number(draftOf(row.id, 'achievedValue')) / Number(draftOf(row.id, 'targetValue') || bonus?.standing.target)) * 100))}٪</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} disabled={locked} className={cell} value={draftOf(row.id, 'amount')} placeholder={bonus?.standing.bonus != null ? String(bonus.standing.bonus) : ''}
                        onChange={e => edit(row.id, { amount: e.target.value })} />
                      {bonus?.entry && bonus.entry.amount > 0 && <span className="mr-1 text-[11px] text-gray-500">{BONUS_STATUS_AR[bonus.entry.status] || bonus.entry.status}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setEditing({ id: row.id, name: row.name })} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"><Pencil size={12} /> تعديل</button>
                    </td>
                  </tr>
                );
                  })}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={18} className="py-10 text-center text-gray-400">مفيش موظفين نشطين</td></tr>}
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
