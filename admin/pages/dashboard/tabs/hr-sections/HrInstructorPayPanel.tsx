// «أجور المحاضرين»: how each instructor is paid, and the month's lectures and
// retention bonuses as the system recorded them (api/lib/instructorPay.js).
//
// A lecture is recorded on its own when a Dokki round's week is marked held or
// an online session ends; the accounts team approves it, corrects it, or adds
// one by hand here. A rate change is a request a second person approves, as
// every rate change has always been.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GraduationCap, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly, cairoMonthOnly } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Basis = 'revenue_share' | 'per_lecture' | 'per_hour';

export type Instructor = {
  staff_id: string; name: string; role?: string;
  pay_basis: Basis | null; lecture_rate: number | null; lecture_rate_per_hour: number | null; lecture_hours: number | null;
  revenue_share_pct: number | null; retention_bonus_type: 'fixed' | 'percentage' | null; retention_bonus_value: number | null;
  currency: string | null; pending_rate_change: number;
};
export type Fee = {
  id: string; staff_id: string; fee_type: string; status: string; total_amount: number; currency: string;
  hours: number | null; lecture_date: string | null; note: string | null; source_key: string | null;
  course_title: string | null; subscriber_name: string | null;
};

const money = (value: number | null | undefined, currency = 'EGP') =>
  `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} ${currency === 'EGP' ? 'ج' : currency}`;
const BASIS_LABEL: Record<Basis, string> = { per_lecture: 'بالمحاضرة', per_hour: 'بالساعة', revenue_share: 'نسبة من الدفعة' };
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'مستني اعتماد', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'معتمد', cls: 'bg-emerald-100 text-emerald-700' },
  included_in_payroll: { label: 'في كشف المرتبات', cls: 'bg-sky-100 text-sky-700' },
  paid: { label: 'اتصرف', cls: 'bg-gray-100 text-gray-700' },
  rejected: { label: 'مرفوض', cls: 'bg-red-100 text-red-700' },
};

/** How an instructor is paid, in one line. */
export function describeRate(instructor: Instructor): string {
  if (!instructor.pay_basis) return 'لسه ما اتحددش';
  const currency = instructor.currency || 'EGP';
  const base = instructor.pay_basis === 'per_lecture'
    ? `${money(instructor.lecture_rate, currency)} للمحاضرة`
    : instructor.pay_basis === 'per_hour'
      ? `${money(instructor.lecture_rate_per_hour, currency)} للساعة${instructor.lecture_hours ? ` · المحاضرة ${instructor.lecture_hours} ساعة` : ''}`
      : `${Number(instructor.revenue_share_pct || 0)}% من الدفعة`;
  const retention = instructor.retention_bonus_type && Number(instructor.retention_bonus_value) > 0
    ? ` · تدوير ${instructor.retention_bonus_type === 'percentage' ? `${Number(instructor.retention_bonus_value)}%` : money(instructor.retention_bonus_value, currency)}`
    : '';
  return base + retention;
}

/** What one hand-added lecture is worth at the instructor's rate, or null when they are not paid by the lecture. */
export function lectureAmount(instructor: Instructor, hours: number | null): number | null {
  if (instructor.pay_basis === 'per_lecture') return Number(instructor.lecture_rate) > 0 ? Number(instructor.lecture_rate) : null;
  if (instructor.pay_basis === 'per_hour') {
    const h = Number(hours) > 0 ? Number(hours) : Number(instructor.lecture_hours) > 0 ? Number(instructor.lecture_hours) : 2;
    return Number(instructor.lecture_rate_per_hour) > 0 ? Math.round(Number(instructor.lecture_rate_per_hour) * h * 100) / 100 : null;
  }
  return null;
}

export default function HrInstructorPayPanel({ notify, canManage }: { notify: Notify; canManage: boolean }) {
  const [month, setMonth] = useState(cairoMonthOnly());
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [adding, setAdding] = useState<Instructor | null>(null);

  const load = useCallback(async () => {
    const [year, mm] = month.split('-').map(Number);
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<{ instructors: Instructor[]; fees: Fee[] }>(`/admin/hr/instructor-pay?month=${mm}&year=${year}`);
      setInstructors(data.instructors || []);
      setFees(data.fees || []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل أجور المحاضرين');
    } finally { setLoading(false); }
  }, [month, notify]);
  useEffect(() => { void load(); }, [load]);

  const byInstructor = useMemo(() => {
    const map = new Map<string, Fee[]>();
    for (const fee of fees) map.set(fee.staff_id, [...(map.get(fee.staff_id) || []), fee]);
    return map;
  }, [fees]);

  const review = async (fee: Fee, status: 'approved' | 'rejected') => {
    setBusy(fee.id);
    try {
      await mysqlAdmin.adminPatch(`/admin/hr/instructor-fees/${fee.id}`, { status });
      notify('success', status === 'approved' ? 'اتعتمد' : 'اترفض');
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذرت المراجعة'); } finally { setBusy(''); }
  };
  const remove = async (fee: Fee) => {
    setBusy(fee.id);
    try {
      await mysqlAdmin.adminDelete(`/admin/hr/instructor-fees/${fee.id}`);
      notify('success', 'اتشال');
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحذف'); } finally { setBusy(''); }
  };

  const cell = 'px-3 py-2 border-b border-gray-100 text-right align-top';
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-end gap-3">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 flex-1 min-w-[200px]"><GraduationCap size={16} /> أجور المحاضرين</h3>
        <label className="text-xs text-gray-500">الشهر
          <input id="instructor-pay-month" type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="block mt-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        المحاضرة بتتسجل لوحدها لما أسبوع روند الدقي يتعلّم «اتعملت» أو الجلسة الأونلاين تخلص، وبتستنى اعتماد الحسابات قبل ما تدخل المرتبات. مكافأة التدوير بتنزل لما عميل درس مع المحاضر قبل كده يدفع كورس تاني معاه.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm border-collapse">
          <thead>
            <tr className="text-xs text-gray-500">
              {['المحاضر', 'بيتحاسب إزاي', 'محاضرات الشهر', 'التدوير', 'معتمد', 'مستني اعتماد', ''].map(title => (
                <th key={title} className="px-3 py-2 text-right font-semibold border-b border-gray-200">{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instructors.map(instructor => {
              const rows = byInstructor.get(instructor.staff_id) || [];
              const live = rows.filter(fee => fee.status !== 'rejected');
              const lectures = live.filter(fee => fee.fee_type === 'lecture');
              const retention = live.filter(fee => fee.fee_type === 'retention');
              const sum = (list: Fee[]) => list.reduce((total, fee) => total + Number(fee.total_amount || 0), 0);
              const approved = live.filter(fee => ['approved', 'included_in_payroll', 'paid'].includes(fee.status));
              const pending = live.filter(fee => fee.status === 'pending');
              const isOpen = open === instructor.staff_id;
              return [
                <tr key={instructor.staff_id} className="hover:bg-gray-50">
                  <td className={cell}><span className="font-bold text-gray-800">{instructor.name}</span></td>
                  <td className={cell}>
                    <span className={instructor.pay_basis ? 'text-gray-700' : 'text-amber-700'}>{describeRate(instructor)}</span>
                    {Number(instructor.pending_rate_change) > 0 && <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">تعديل مستني اعتماد</span>}
                  </td>
                  <td className={cell}>{lectures.length}{lectures.some(fee => fee.hours) ? ` · ${lectures.reduce((h, fee) => h + Number(fee.hours || 0), 0)} ساعة` : ''}</td>
                  <td className={cell}>{retention.length ? `${retention.length} عميل · ${money(sum(retention))}` : "—"}</td>
                  <td className={`${cell} font-bold text-emerald-700`}>{money(sum(approved))}</td>
                  <td className={`${cell} text-amber-700`}>{pending.length ? money(sum(pending)) : '—'}</td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {canManage && (
                      <button type="button" onClick={() => setEditing(instructor)} title="تعديل طريقة الحساب"
                        className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-200">
                        <Pencil size={12} /> الحساب
                      </button>
                    )}
                    <button type="button" onClick={() => setOpen(isOpen ? null : instructor.staff_id)} aria-expanded={isOpen}
                      className="mr-1 inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-200">
                      {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} التفاصيل
                    </button>
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${instructor.staff_id}-detail`}>
                    <td colSpan={7} className="bg-gray-50 px-3 py-3">
                      <div className="space-y-2">
                        {canManage && lectureAmount(instructor, null) !== null && (
                          <button type="button" onClick={() => setAdding(instructor)}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
                            <Plus size={12} /> إضافة محاضرة يدوي
                          </button>
                        )}
                        {rows.length === 0 ? <p className="text-xs text-gray-400">مفيش محاضرات أو مكافآت متسجلة الشهر ده.</p> : (
                          <table className="w-full text-xs">
                            <tbody>
                              {rows.map(fee => (
                                <tr key={fee.id} className="border-t border-gray-200">
                                  <td className="py-1.5 pl-3 whitespace-nowrap text-gray-500">{fee.lecture_date ? String(fee.lecture_date).slice(0, 10) : '—'}</td>
                                  <td className="py-1.5 pl-3 font-bold">{fee.fee_type === 'retention' ? 'مكافأة تدوير' : fee.fee_type === 'lecture' ? 'محاضرة' : 'حصة من دفعة'}</td>
                                  <td className="py-1.5 pl-3 text-gray-600">{[fee.course_title, fee.subscriber_name, fee.note].filter(Boolean).join(' · ')}{fee.hours ? ` · ${fee.hours} ساعة` : ''}{fee.source_key ? '' : ' · يدوي'}</td>
                                  <td className="py-1.5 pl-3 font-bold whitespace-nowrap">{money(fee.total_amount, fee.currency)}</td>
                                  <td className="py-1.5 pl-3"><span className={`rounded-full px-2 py-0.5 font-bold ${STATUS[fee.status]?.cls || ''}`}>{STATUS[fee.status]?.label || fee.status}</span></td>
                                  <td className="py-1.5 whitespace-nowrap">
                                    {canManage && fee.status === 'pending' && (
                                      <span className="inline-flex gap-1">
                                        <button type="button" disabled={busy === fee.id} onClick={() => { void review(fee, 'approved'); }} title="اعتماد"
                                          className="rounded bg-emerald-600 p-1 text-white disabled:opacity-50"><Check size={12} /></button>
                                        <button type="button" disabled={busy === fee.id} onClick={() => { void review(fee, 'rejected'); }} title="رفض"
                                          className="rounded bg-red-50 p-1 text-red-700 disabled:opacity-50"><X size={12} /></button>
                                        <button type="button" disabled={busy === fee.id} onClick={() => { void remove(fee); }} title="حذف"
                                          className="rounded bg-gray-100 p-1 text-gray-600 disabled:opacity-50"><Trash2 size={12} /></button>
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            {instructors.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-gray-400">{loading ? 'جاري التحميل…' : 'مفيش محاضرين. المحاضر هو موظف مربوط بدكتور أو متسجل على كورس.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <RateModal instructor={editing} notify={notify} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {adding && <AddLectureModal instructor={adding} notify={notify} onClose={() => setAdding(null)} onSaved={async () => { setAdding(null); await load(); }} />}
    </div>
  );
}

function RateModal({ instructor, notify, onClose, onSaved }: {
  instructor: Instructor; notify: Notify; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    pay_basis: (instructor.pay_basis || 'per_lecture') as Basis,
    lecture_rate: instructor.lecture_rate ?? '',
    lecture_rate_per_hour: instructor.lecture_rate_per_hour ?? '',
    lecture_hours: instructor.lecture_hours ?? '',
    revenue_share_pct: instructor.revenue_share_pct ?? '',
    retention_bonus_type: (instructor.retention_bonus_type || '') as '' | 'fixed' | 'percentage',
    retention_bonus_value: instructor.retention_bonus_value ?? '',
    currency: instructor.currency || 'EGP',
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm';

  const save = async () => {
    setSaving(true);
    try {
      // The consultation and training rates live on the same row and go
      // through the same request: carried as they are.
      const current = await mysqlAdmin.adminGet<Record<string, unknown> | null>(`/admin/hr/instructors/${instructor.staff_id}/rates`);
      await mysqlAdmin.adminPut(`/admin/hr/instructors/${instructor.staff_id}/rates`, {
        consultation_rate_type: current?.consultation_rate_type || 'per_session',
        consultation_rate_value: current?.consultation_rate_value || 0,
        training_rate_per_hour: current?.training_rate_per_hour || 0,
        notes: current?.notes || null,
        ...form,
        lecture_rate_per_hour: form.pay_basis === 'per_hour' ? form.lecture_rate_per_hour : (current?.lecture_rate_per_hour || form.lecture_rate_per_hour || 0),
        retention_bonus_type: form.retention_bonus_type || null,
      });
      notify('success', 'اتبعت للاعتماد — بيتطبق بعد ما حد تاني يعتمده');
      await onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ طريقة الحساب');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`حساب ${instructor.name}`} subtitle="سعر واحد للمحاضر في كل الكورسات">
      <div className="space-y-3 text-sm" dir="rtl">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-bold text-gray-700">بيتحاسب إزاي</legend>
          {(['per_lecture', 'per_hour', 'revenue_share'] as Basis[]).map(basis => (
            <label key={basis} className="flex items-center gap-2">
              <input id={`basis-${basis}`} type="radio" name="pay_basis" checked={form.pay_basis === basis} onChange={() => set({ pay_basis: basis })} />
              {BASIS_LABEL[basis]}
            </label>
          ))}
        </fieldset>
        {form.pay_basis === 'per_lecture' && (
          <label className="block text-xs font-bold text-gray-700">سعر المحاضرة
            <input id="rate-lecture" type="number" min="0" value={form.lecture_rate} onChange={e => set({ lecture_rate: e.target.value })} className={field} /></label>
        )}
        {form.pay_basis === 'per_hour' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-gray-700">سعر الساعة
              <input id="rate-hour" type="number" min="0" value={form.lecture_rate_per_hour} onChange={e => set({ lecture_rate_per_hour: e.target.value })} className={field} /></label>
            <label className="block text-xs font-bold text-gray-700">ساعات المحاضرة في الدقي
              <input id="rate-hours" type="number" min="0" step="0.5" value={form.lecture_hours} onChange={e => set({ lecture_hours: e.target.value })} placeholder="2" className={field} /></label>
          </div>
        )}
        {form.pay_basis === 'revenue_share' && (
          <label className="block text-xs font-bold text-gray-700">النسبة من كل دفعة للكورس (%)
            <input id="rate-share" type="number" min="0" max="100" value={form.revenue_share_pct} onChange={e => set({ revenue_share_pct: e.target.value })} className={field} /></label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-bold text-gray-700">مكافأة التدوير
            <select id="retention-type" value={form.retention_bonus_type} onChange={e => set({ retention_bonus_type: e.target.value as typeof form.retention_bonus_type })} className={field}>
              <option value="">من غير</option><option value="fixed">مبلغ ثابت</option><option value="percentage">نسبة من الدفعة</option>
            </select></label>
          {form.retention_bonus_type && (
            <label className="block text-xs font-bold text-gray-700">{form.retention_bonus_type === 'percentage' ? 'النسبة (%)' : 'المبلغ'}
              <input id="retention-value" type="number" min="0" value={form.retention_bonus_value} onChange={e => set({ retention_bonus_value: e.target.value })} className={field} /></label>
          )}
        </div>
        <label className="block text-xs font-bold text-gray-700">العملة
          <select id="rate-currency" value={form.currency} onChange={e => set({ currency: e.target.value })} className={field}>
            <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
          </select></label>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 font-semibold text-gray-600">إلغاء</button>
          <button type="button" disabled={saving} onClick={() => { void save(); }}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 font-bold text-white disabled:opacity-50">{saving ? 'جارٍ الإرسال…' : 'إرسال للاعتماد'}</button>
        </div>
      </div>
    </Modal>
  );
}

function AddLectureModal({ instructor, notify, onClose, onSaved }: {
  instructor: Instructor; notify: Notify; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [date, setDate] = useState(cairoDateOnly());
  const [hours, setHours] = useState(instructor.pay_basis === 'per_hour' ? String(instructor.lecture_hours || 2) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const amount = lectureAmount(instructor, hours ? Number(hours) : null);
  const save = async () => {
    if (!amount) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/hr/instructor-fees', {
        staff_id: instructor.staff_id, fee_type: 'lecture', lecture_date: date, currency: instructor.currency || 'EGP',
        fixed_amount: amount, hours: instructor.pay_basis === 'per_hour' ? Number(hours) : null,
        rate_per_hour: instructor.pay_basis === 'per_hour' ? instructor.lecture_rate_per_hour : null,
        note: note || 'محاضرة اتضافت يدوي',
      });
      notify('success', 'المحاضرة اتسجلت وبتستنى الاعتماد');
      await onSaved();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تسجيل المحاضرة'); } finally { setSaving(false); }
  };
  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm';
  return (
    <Modal open onClose={onClose} size="sm" title={`محاضرة لـ${instructor.name}`} subtitle={describeRate(instructor)}>
      <div className="space-y-3 text-sm" dir="rtl">
        <label className="block text-xs font-bold text-gray-700">التاريخ
          <input id="lecture-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={field} /></label>
        {instructor.pay_basis === 'per_hour' && (
          <label className="block text-xs font-bold text-gray-700">عدد الساعات
            <input id="lecture-hours" type="number" min="0.5" step="0.5" value={hours} onChange={e => setHours(e.target.value)} className={field} /></label>
        )}
        <label className="block text-xs font-bold text-gray-700">ملاحظة (الكورس، المكان…)
          <input id="lecture-note" value={note} onChange={e => setNote(e.target.value)} className={field} /></label>
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">المستحق: {money(amount, instructor.currency || 'EGP')}</p>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 font-semibold text-gray-600">إلغاء</button>
          <button type="button" disabled={saving || !amount} onClick={() => { void save(); }}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 font-bold text-white disabled:opacity-50">{saving ? 'جارٍ الحفظ…' : 'تسجيل المحاضرة'}</button>
        </div>
      </div>
    </Modal>
  );
}
