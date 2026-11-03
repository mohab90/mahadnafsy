// «خلي في زر تعديل اقدر اغير في الغيابات او ازود مكافاه او اعدل اي حاجة تخص الموظف»: one window per employee for the month on the month sheet —
// the days (change a day, make one a free day, add a missing one), a bonus or a deduction with its reason, and the employee's basics (salary,
// device number, target, free days). A day edited here becomes a manual entry, which a fingerprint re-upload leaves alone.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { fmtMoney } from './hrFormat';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Log = {
  id: string; date: string; status: string; check_in: string | null; check_out: string | null; late_minutes: number; early_leave_minutes: number;
  deduction_days: number | string | null; permit_used: string | null; source: string; notes: string | null; leave_id: string | null;
};
type Bonus = { id: string; type: 'bonus' | 'deduction'; amount: number | string; status: string; reason: string | null; for_month: number | null; for_year: number | null };
type Basics = {
  id: string; baseSalary: number | null; biometricNo: string; targetType: 'clients' | 'bookings' | 'egp' | null; targetValue: number | null;
  targetBonus: number | null; freeDays: number | null;
};

const STATUS_OPTIONS: [string, string][] = [
  ['PRESENT', 'حاضر'], ['LATE', 'متأخر'], ['ABSENT', 'غياب بدون إذن'], ['ABSENT_EXCUSED', 'غياب بإذن'], ['LEAVE_BALANCE', 'غياب من رصيد الإجازات (بدون خصم)'],
  ['HALF_DAY', 'نص يوم'], ['FREE_DAY', 'يوم إجازة مجاني'], ['REMOTE', 'عن بعد'], ['HOLIDAY', 'عطلة'],
];
const field = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50';
const hhmm = (value: string | null) => (value ? String(value).slice(0, 5) : '');
const dateOnly = (value: string) => String(value).slice(0, 10);
const statusOf = (log: Log) => {
  if (log.status === 'HOLIDAY' && log.permit_used === 'free_day') return 'FREE_DAY';
  if (log.status === 'HOLIDAY' && log.permit_used === 'leave_balance') return 'LEAVE_BALANCE';
  if (log.status === 'ABSENT' && log.permit_used === 'excused') return 'ABSENT_EXCUSED';
  return log.status;
};
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: CAIRO_TIME_ZONE });

type DayDraft = { status: string; check_in: string; check_out: string; deduction: string; notes: string };

export default function HrMonthEditModal({ staffId, name, month, canEditSalary, notify, onClose, onSaved }: {
  staffId: string; name: string; month: string; canEditSalary: boolean; notify: Notify; onClose: () => void; onSaved: () => void;
}) {
  const [y, m] = month.split('-');
  const [logs, setLogs] = useState<Log[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [basics, setBasics] = useState<Basics | null>(null);
  const [basicsDraft, setBasicsDraft] = useState<Partial<Basics>>({});
  const [days, setDays] = useState<Record<string, DayDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [newDay, setNewDay] = useState<DayDraft & { date: string }>({ date: `${month}-01`, status: 'PRESENT', check_in: '', check_out: '', deduction: '', notes: '' });
  const [adjust, setAdjust] = useState({ type: 'bonus' as 'bonus' | 'deduction', amount: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dayRows, bonusRows, basicsRows] = await Promise.all([
        mysqlAdmin.adminGet<Log[]>(`/admin/hr/attendance/${encodeURIComponent(staffId)}?month=${parseInt(m, 10)}&year=${y}`),
        mysqlAdmin.adminGet<Bonus[]>(`/admin/hr/employees/${encodeURIComponent(staffId)}/bonuses`),
        mysqlAdmin.adminGet<Basics[]>('/admin/hr/staff-basics'),
      ]);
      setLogs(Array.isArray(dayRows) ? dayRows : []);
      setBonuses((Array.isArray(bonusRows) ? bonusRows : []).filter(b => Number(b.for_month) === parseInt(m, 10) && Number(b.for_year) === Number(y)));
      setBasics((Array.isArray(basicsRows) ? basicsRows : []).find(row => row.id === staffId) || null);
      setDays({}); setBasicsDraft({});
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل بيانات الموظف');
    } finally { setLoading(false); }
  }, [staffId, m, y, notify]);
  useEffect(() => { void load(); }, [load]);

  const draftOf = (log: Log): DayDraft => days[dateOnly(log.date)] || {
    status: statusOf(log), check_in: hhmm(log.check_in), check_out: hhmm(log.check_out),
    deduction: log.deduction_days == null ? '' : String(Number(log.deduction_days)), notes: log.notes || '',
  };
  const editDay = (log: Log, patch: Partial<DayDraft>) => setDays(current => ({ ...current, [dateOnly(log.date)]: { ...draftOf(log), ...patch } }));

  const saveDay = async (date: string, draft: DayDraft) => {
    setBusy(`day:${date}`);
    try {
      await mysqlAdmin.adminPost('/admin/hr/attendance', {
        staff_id: staffId, date, status: draft.status, check_in: draft.check_in || undefined, check_out: draft.check_out || undefined,
        notes: draft.notes || undefined, deduction_days: draft.deduction === '' ? undefined : Number(draft.deduction),
      });
      notify('success', `اتعدل يوم ${date}`);
      await load(); onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ اليوم');
    } finally { setBusy(''); }
  };

  const addAdjustment = async () => {
    const amount = Number(adjust.amount);
    if (!(amount > 0)) { notify('error', 'اكتب مبلغ أكبر من صفر'); return; }
    setBusy('adjust');
    try {
      await mysqlAdmin.adminPost(`/admin/hr/employees/${encodeURIComponent(staffId)}/bonuses`, {
        type: adjust.type, amount, reason: adjust.reason || undefined, for_month: parseInt(m, 10), for_year: Number(y),
      });
      notify('success', `${adjust.type === 'bonus' ? 'المكافأة' : 'الخصم'} اتسجلت وبتستنى اعتماد حد تاني`);
      setAdjust({ type: 'bonus', amount: '', reason: '' });
      await load(); onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر التسجيل');
    } finally { setBusy(''); }
  };

  const removePending = async (id: string) => {
    setBusy(`bonus:${id}`);
    try { await mysqlAdmin.adminDelete(`/admin/hr/bonuses/${encodeURIComponent(id)}`); await load(); onSaved(); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحذف'); }
    finally { setBusy(''); }
  };

  const saveBasics = async () => {
    if (!basics || !Object.keys(basicsDraft).length) return;
    setBusy('basics');
    try {
      await mysqlAdmin.adminPut('/admin/hr/staff-basics', { rows: [{ id: staffId, ...basicsDraft }] });
      notify('success', 'اتحفظت بيانات الموظف');
      await load(); onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ البيانات');
    } finally { setBusy(''); }
  };
  const basic = <K extends keyof Basics>(key: K): Basics[K] | undefined => (key in basicsDraft ? (basicsDraft as Basics)[key] : basics?.[key]);
  const setBasic = (patch: Partial<Basics>) => setBasicsDraft(current => ({ ...current, ...patch }));
  const toNum = (value: string) => (value === '' ? null : Number(value));

  return (
    <Modal open onClose={onClose} title={`تعديل ${name} — ${month}`} size="xl">
      {loading ? <div className="py-12 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" size={20} /></div> : (
        <div className="space-y-6" dir="rtl">
          <section>
            <h4 className="mb-2 text-sm font-extrabold text-gray-900">أيام الشهر</h4>
            <p className="mb-2 text-xs text-gray-500">أي يوم تعدله هنا بيتحسب «تسجيل يدوي» ورفع شيت البصمة تاني ما بيغيّروش. سيب الخصم فاضي ويتحسب من السياسة، أو اكتب رقم من 0 ليوم كامل (0.25 = ربع يوم).</p>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-50 text-right text-xs font-bold text-gray-500">
                  <tr><th className="px-2 py-2">اليوم</th><th className="px-2 py-2">الحالة</th><th className="px-2 py-2">حضور</th><th className="px-2 py-2">انصراف</th><th className="px-2 py-2">خصم (يوم)</th><th className="px-2 py-2">ملاحظة</th><th className="px-2 py-2" /></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map(log => {
                    const date = dateOnly(log.date);
                    const draft = draftOf(log);
                    const locked = Boolean(log.leave_id);
                    return (
                      <tr key={log.id} className={days[date] ? 'bg-amber-50/40' : ''}>
                        <td className="px-2 py-1.5 text-gray-800">{weekday(date)}{log.source === 'MANUAL_ENTRY' && <span className="mr-1 text-[10px] text-indigo-600">يدوي</span>}{locked && <span className="mr-1 text-[10px] text-sky-600">إجازة معتمدة</span>}</td>
                        <td className="px-2 py-1.5"><select disabled={locked} className={field} value={draft.status} onChange={e => editDay(log, { status: e.target.value })}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                        <td className="px-2 py-1.5"><input type="time" disabled={locked} className={field} value={draft.check_in} onChange={e => editDay(log, { check_in: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input type="time" disabled={locked} className={field} value={draft.check_out} onChange={e => editDay(log, { check_out: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input type="number" min={0} max={1} step={0.25} disabled={locked} className={`${field} w-20`} value={draft.deduction} onChange={e => editDay(log, { deduction: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input className={field} disabled={locked} value={draft.notes} onChange={e => editDay(log, { notes: e.target.value })} /></td>
                        <td className="px-2 py-1.5">{days[date] && <button type="button" disabled={busy === `day:${date}`} onClick={() => void saveDay(date, draft)} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save size={12} /> حفظ</button>}</td>
                      </tr>
                    );
                  })}
                  {logs.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-400">مفيش أيام متسجلة للشهر ده — ضيف يوم من تحت</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-6">
              <input type="date" className={field} min={`${month}-01`} value={newDay.date} onChange={e => setNewDay(v => ({ ...v, date: e.target.value }))} />
              <select className={field} value={newDay.status} onChange={e => setNewDay(v => ({ ...v, status: e.target.value }))}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <input type="time" className={field} value={newDay.check_in} onChange={e => setNewDay(v => ({ ...v, check_in: e.target.value }))} />
              <input type="time" className={field} value={newDay.check_out} onChange={e => setNewDay(v => ({ ...v, check_out: e.target.value }))} />
              <input className={field} placeholder="ملاحظة" value={newDay.notes} onChange={e => setNewDay(v => ({ ...v, notes: e.target.value }))} />
              <button type="button" disabled={busy === `day:${newDay.date}` || !newDay.date.startsWith(month)} onClick={() => void saveDay(newDay.date, newDay)} className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Plus size={12} /> إضافة يوم</button>
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-extrabold text-gray-900">مكافأة أو خصم إضافي</h4>
            <p className="mb-2 text-xs text-gray-500">بيتسجل «مستني الاعتماد» ولازم حد غيرك يعتمده من اعتمادات المرتبات، وبعدها بيدخل في مسير الشهر. (المطلوب والمحقق والمبلغ الأساسي في الجدول نفسه.)</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <select className={field} value={adjust.type} onChange={e => setAdjust(v => ({ ...v, type: e.target.value as 'bonus' | 'deduction' }))}><option value="bonus">مكافأة</option><option value="deduction">خصم</option></select>
              <input type="number" min={0} className={field} placeholder="المبلغ (ج.م)" value={adjust.amount} onChange={e => setAdjust(v => ({ ...v, amount: e.target.value }))} />
              <input className={`${field} md:col-span-1`} placeholder="السبب" value={adjust.reason} onChange={e => setAdjust(v => ({ ...v, reason: e.target.value }))} />
              <button type="button" disabled={busy === 'adjust'} onClick={() => void addAdjustment()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">تسجيل</button>
            </div>
            {bonuses.length > 0 && (
              <ul className="mt-3 divide-y divide-gray-50 rounded-xl border border-gray-100 text-sm">
                {bonuses.map(b => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className={b.type === 'deduction' ? 'text-red-600' : 'text-emerald-700'}>{b.type === 'deduction' ? 'خصم' : 'مكافأة'} {fmtMoney(Number(b.amount))}{b.reason ? ` — ${b.reason}` : ''}</span>
                    <span className="flex items-center gap-2 text-xs text-gray-500">{b.status === 'APPROVED' ? 'معتمدة' : b.status === 'REJECTED' ? 'مرفوضة' : 'مستنية الاعتماد'}
                      {b.status === 'PENDING' && <button type="button" disabled={busy === `bonus:${b.id}`} onClick={() => void removePending(b.id)} className="text-red-500 hover:text-red-700" title="حذف"><Trash2 size={14} /></button>}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {basics && (
            <section>
              <h4 className="mb-2 text-sm font-extrabold text-gray-900">بيانات الموظف</h4>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <label className="text-xs text-gray-600">الراتب الأساسي (ج.م)
                  <input type="number" min={0} disabled={!canEditSalary} className={field} value={basic('baseSalary') ?? ''} onChange={e => setBasic({ baseSalary: toNum(e.target.value) })} /></label>
                <label className="text-xs text-gray-600">رقم البصمة على الجهاز
                  <input dir="ltr" className={field} value={basic('biometricNo') ?? ''} onChange={e => setBasic({ biometricNo: e.target.value.trim() })} /></label>
                <label className="text-xs text-gray-600">أيام الإجازة المجانية في الشهر
                  <input type="number" min={0} max={31} className={field} placeholder="حسب السياسة" value={basic('freeDays') ?? ''} onChange={e => setBasic({ freeDays: toNum(e.target.value) })} /></label>
                <label className="text-xs text-gray-600">نوع التارجت
                  <select className={field} value={basic('targetType') ?? ''} onChange={e => setBasic({ targetType: (e.target.value || null) as Basics['targetType'] })}>
                    <option value="">بدون تارجت</option><option value="clients">عدد عملاء</option><option value="bookings">عدد حجوزات</option><option value="egp">فلوس (ج.م)</option></select></label>
                <label className="text-xs text-gray-600">التارجت الشهري
                  <input type="number" min={0} className={field} value={basic('targetValue') ?? ''} onChange={e => setBasic({ targetValue: toNum(e.target.value) })} /></label>
                <label className="text-xs text-gray-600">مكافأة التارجت
                  <input type="number" min={0} className={field} value={basic('targetBonus') ?? ''} onChange={e => setBasic({ targetBonus: toNum(e.target.value) })} /></label>
              </div>
              <button type="button" disabled={busy === 'basics' || !Object.keys(basicsDraft).length} onClick={() => void saveBasics()} className="mt-3 flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save size={13} /> حفظ بيانات الموظف</button>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
