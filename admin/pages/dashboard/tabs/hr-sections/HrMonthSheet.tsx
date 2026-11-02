// «خلي الحضور مع كشف المرتبات في تاب واحدة وتفاصيل مع بعض»: one row per
// employee for the month — what the fingerprint sheet and the manual entries
// say (attendance summary), beside what the month's payroll run pays them.
// The two screens below it (attendance, payroll runs) stay as they were; this
// is the reading of both together.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Loader2, Save, Wallet } from 'lucide-react';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { PAYROLL_STATUS_LABELS, PAYROLL_STATUS_COLORS } from './hrLabels';
import { fmtMoney } from './hrFormat';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type AttendanceRow = {
  id: string; name: string; department_name?: string | null; biometric_user_no?: string | null;
  present_days?: number; absent_days?: number; late_days?: number; total_late_minutes?: number;
  leave_days?: number; deduction_days?: number | string; flagged_days?: number;
};
type MonthBonus = {
  staffId: string;
  standing: { type: 'clients' | 'bookings' | 'egp' | null; target: number | null; bonus: number | null };
  entry: { id: string; amount: number; status: string; note: string; targetValue: number | null; achievedValue: number | null; targetUnit: string | null; locked: boolean } | null;
};
type BonusDraft = { targetValue?: string; achievedValue?: string; amount?: string };
const UNIT_AR: Record<string, string> = { clients: 'عميل', bookings: 'حجز', egp: 'جنيه' };
const BONUS_STATUS_AR: Record<string, string> = { PENDING: 'مستني الاعتماد', APPROVED: 'معتمدة', REJECTED: 'مرفوضة' };
type Run = { id: string; month: number | string; year: number | string; status: string };
type Item = {
  staff_id: string; base_salary?: number | string; net_salary?: number | string;
  absence_deductions?: number | string; absence_deduction?: number | string;
  late_deductions?: number | string; late_deduction?: number | string;
  other_deductions?: number | string; other_deduction?: number | string;
  advance_deductions?: number | string; advance_deduction?: number | string;
  commission?: number | string; bonus_amount?: number | string;
};

const num = (value: unknown) => Number(value) || 0;
const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

export default function HrMonthSheet({ notify }: { notify: Notify }) {
  const [month, setMonth] = useState(cairoMonthOnly());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [items, setItems] = useState<Map<string, Item & { runStatus: string }>>(new Map());
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bonuses, setBonuses] = useState<Map<string, MonthBonus>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, BonusDraft>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [y, m] = month.split('-');
    setLoading(true);
    try {
      const [summary, runs, bonusList] = await Promise.allSettled([
        mysqlAdmin.adminGet<AttendanceRow[]>(`/admin/hr/attendance/summary?month=${parseInt(m, 10)}&year=${y}`),
        mysqlAdmin.adminGet<Run[]>('/admin/hr/payroll'),
        mysqlAdmin.adminGet<MonthBonus[]>(`/admin/hr/month-bonuses?month=${parseInt(m, 10)}&year=${y}`),
      ]);
      setBonuses(new Map(bonusList.status === 'fulfilled' && Array.isArray(bonusList.value) ? bonusList.value.map(b => [b.staffId, b]) : []));
      setDrafts({});
      setAttendance(summary.status === 'fulfilled' && Array.isArray(summary.value) ? summary.value : []);
      const monthRuns = runs.status === 'fulfilled' && Array.isArray(runs.value)
        ? runs.value.filter(run => Number(run.month) === parseInt(m, 10) && Number(run.year) === Number(y) && run.status !== 'CANCELLED')
        : [];
      const details = await Promise.allSettled(monthRuns.map(run => mysqlAdmin.adminGet<{ items?: Item[] }>(`/admin/hr/payroll/${encodeURIComponent(run.id)}`)
        .then(data => (data.items || []).map(item => ({ ...item, runStatus: run.status })))));
      const byStaff = new Map<string, Item & { runStatus: string }>();
      for (const result of details) if (result.status === 'fulfilled') for (const item of result.value) byStaff.set(item.staff_id, item);
      setItems(byStaff);
      setRunStatus(monthRuns[0]?.status || null);
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
  const changed = Object.keys(drafts).length;

  const rows = useMemo(() => attendance.map(row => {
    const item = items.get(row.id);
    const deductions = item
      ? num(item.absence_deductions ?? item.absence_deduction) + num(item.late_deductions ?? item.late_deduction)
        + num(item.other_deductions ?? item.other_deduction) + num(item.advance_deductions ?? item.advance_deduction)
      : null;
    return { row, item, deductions };
  }), [attendance, items]);
  const totals = useMemo(() => rows.reduce((acc, { row, item }) => ({
    absent: acc.absent + num(row.absent_days), late: acc.late + num(row.late_days),
    net: acc.net + (item ? num(item.net_salary) : 0),
  }), { absent: 0, late: 0, net: 0 }), [rows]);

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
          <CalendarCheck size={16} className="text-indigo-600" /> كشف الشهر — الحضور والمرتب لكل موظف
        </h3>
        <div className="flex items-center gap-2">
          {runStatus
            ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${PAYROLL_STATUS_COLORS[runStatus] || 'bg-gray-100 text-gray-600'}`}>مسير الرواتب: {PAYROLL_STATUS_LABELS[runStatus] || runStatus}</span>
            : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">مفيش مسير رواتب للشهر ده لسه — احسبه من تحت</span>}
          {changed > 0 && (
            <button type="button" onClick={() => void saveBonuses()} disabled={saving} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} احفظ المكافآت ({n(changed)})
            </button>
          )}
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-gray-100 px-2.5 py-1">{n(attendance.length)} موظف</span>
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{n(totals.absent)} يوم غياب</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{n(totals.late)} يوم تأخير</span>
        {items.size > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"><Wallet size={12} /> صافي المرتبات {fmtMoney(totals.net)}</span>}
      </div>

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" size={20} /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-gray-50 text-right text-xs font-bold text-gray-500">
              <tr>
                <th className="px-3 py-2">الموظف</th>
                <th className="px-3 py-2">حضور</th>
                <th className="px-3 py-2">غياب</th>
                <th className="px-3 py-2">تأخير</th>
                <th className="px-3 py-2">إجازات</th>
                <th className="px-3 py-2">أيام خصم</th>
                <th className="border-r border-gray-200 px-3 py-2">الأساسي</th>
                <th className="px-3 py-2">عمولة ومكافأة</th>
                <th className="px-3 py-2">الخصومات</th>
                <th className="px-3 py-2">الصافي</th>
                <th className="border-r border-gray-200 px-3 py-2">المطلوب</th>
                <th className="px-3 py-2">المحقق</th>
                <th className="px-3 py-2">المكافأة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(({ row, item, deductions }) => (
                <tr key={row.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <p className="font-bold text-gray-800">{row.name}</p>
                    <p className="text-[11px] text-gray-400">{[row.department_name, row.biometric_user_no ? `بصمة #${row.biometric_user_no}` : 'بدون رقم بصمة'].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-emerald-700">{n(num(row.present_days))}</td>
                  <td className={`px-3 py-2 tabular-nums ${num(row.absent_days) ? 'font-bold text-red-600' : 'text-gray-300'}`}>{n(num(row.absent_days))}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{num(row.late_days) ? `${n(num(row.late_days))} يوم · ${n(num(row.total_late_minutes))} د` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{num(row.leave_days) ? n(num(row.leave_days)) : '—'}</td>
                  <td className={`px-3 py-2 tabular-nums ${num(row.deduction_days) ? 'font-bold text-amber-700' : 'text-gray-300'}`}>{num(row.deduction_days) ? n(num(row.deduction_days)) : '—'}</td>
                  <td className="border-r border-gray-100 px-3 py-2 tabular-nums">{item ? fmtMoney(num(item.base_salary)) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-700">{item && (num(item.commission) + num(item.bonus_amount)) ? `+${fmtMoney(num(item.commission) + num(item.bonus_amount))}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-red-600">{deductions ? `−${fmtMoney(deductions)}` : '—'}</td>
                  <td className="px-3 py-2 font-extrabold tabular-nums text-gray-900">{item ? fmtMoney(num(item.net_salary)) : <span className="text-xs font-normal text-gray-400">لسه ما اتحسبش</span>}</td>
                  {(() => {
                    const bonus = bonuses.get(row.id);
                    const locked = Boolean(bonus?.entry?.locked);
                    const unit = bonus?.entry?.targetUnit || bonus?.standing.type;
                    const cell = 'w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm tabular-nums disabled:bg-gray-50 disabled:text-gray-500';
                    return (
                      <>
                        <td className="border-r border-gray-100 px-3 py-2">
                          <input type="number" min={0} disabled={locked} className={cell} value={draftOf(row.id, 'targetValue')} placeholder={bonus?.standing.target != null ? String(bonus.standing.target) : ''}
                            onChange={e => edit(row.id, { targetValue: e.target.value })} />
                          {unit && <span className="mr-1 text-[11px] text-gray-400">{UNIT_AR[unit]}</span>}
                        </td>
                        <td className="px-3 py-2"><input type="number" min={0} disabled={locked} className={cell} value={draftOf(row.id, 'achievedValue')} onChange={e => edit(row.id, { achievedValue: e.target.value })} /></td>
                        <td className="px-3 py-2">
                          <input type="number" min={0} disabled={locked} className={cell} value={draftOf(row.id, 'amount')} placeholder={bonus?.standing.bonus != null ? String(bonus.standing.bonus) : ''}
                            onChange={e => edit(row.id, { amount: e.target.value })} />
                          {bonus?.entry && bonus.entry.amount > 0 && <span className="mr-1 text-[11px] text-gray-500">{BONUS_STATUS_AR[bonus.entry.status] || bonus.entry.status}</span>}
                        </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={13} className="py-10 text-center text-gray-400">مفيش موظفين نشطين</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
