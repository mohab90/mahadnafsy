import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly, cairoDaysAhead } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { mapServerInstallmentPlan } from '../../../unified-client/installmentPlanMapper';
import type { Bundle, Course, Currency, InstallmentPlan, SubscriberItem } from '../../../../types';
import { clientItems } from '../../../../lib/agreedPrice';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type DraftEntry = { amount: string; dueDate: string };

/** A month after `from`, same day — clamped to the month's end. */
function addMonths(from: string, months: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1 + months, Math.min(d, last)));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Equal parts, the rounding left on the last one so they add up to the total. */
function schedule(total: number, count: number, firstDue: string): DraftEntry[] {
  const part = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => ({
    amount: String(i === count - 1 ? total - part * (count - 1) : part),
    dueDate: addMonths(firstDue, i),
  }));
}

/**
 * «الأقساط» for one client: the plans on file, a new schedule, and paying an
 * instalment into the box it went into (api/routes/installments.js).
 */
export function InstallmentPlansModal({ subscriber, courses, bundles, paymentBoxes, defaultCurrency, notify, onClose, onChanged }: {
  subscriber: SubscriberItem;
  courses: Course[];
  bundles: Bundle[];
  paymentBoxes: string[];
  defaultCurrency: Currency;
  notify: Notify;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [plans, setPlans] = useState<InstallmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // What this client holds, with its price, paid and remaining — the plan is
  // for one of these, not for anything in the catalogue.
  const items = useMemo(() => clientItems(subscriber, courses, bundles, defaultCurrency),
    [subscriber, courses, bundles, defaultCurrency]);
  const firstOwing = items.find(item => item.remaining > 0) || items[0];
  const [courseId, setCourseId] = useState(firstOwing?.item || '');
  const [total, setTotal] = useState(firstOwing?.remaining ? String(firstOwing.remaining) : '');
  const [currency, setCurrency] = useState<Currency>((firstOwing?.currency as Currency) || defaultCurrency);
  const chosen = items.find(item => item.item === courseId);
  const pickItem = (id: string) => {
    const item = items.find(entry => entry.item === id);
    setCourseId(id);
    setEntries([]);
    if (item) {
      setTotal(item.remaining > 0 ? String(item.remaining) : '');
      setCurrency(item.currency as Currency);
    }
  };
  const [count, setCount] = useState('3');
  const [firstDue, setFirstDue] = useState(cairoDaysAhead(30));
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [paying, setPaying] = useState<{ planId: string; index: number; amount: string; date: string; box: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<unknown[]>(`/admin/subscribers/${subscriber.id}/installment-plans`);
      setPlans((rows || []).map(mapServerInstallmentPlan));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل الأقساط');
    } finally { setLoading(false); }
  }, [subscriber.id, notify]);
  useEffect(() => { void load(); }, [load]);

  const titleOf = (id: string) => id.startsWith('bundle:')
    ? bundles.find(bundle => `bundle:${bundle.id}` === id)?.title || id
    : courses.find(course => course.id === id)?.title || id;

  const draftTotal = entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const canSave = entries.length > 0 && entries.every(entry => Number(entry.amount) > 0 && entry.dueDate)
    && Math.round(draftTotal) === Math.round(Number(total) || 0);

  const create = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`/admin/subscribers/${subscriber.id}/installment-plans`, {
        ...(courseId.startsWith('bundle:') ? { bundleId: courseId.slice(7) } : courseId ? { courseId } : {}),
        title: courseId ? titleOf(courseId) : 'أقساط',
        totalAmount: Number(total), currency,
        entries: entries.map(entry => ({ amount: Number(entry.amount), dueDate: entry.dueDate })),
      });
      notify('success', `تم عمل خطة ${entries.length} أقساط`);
      setEntries([]);
      setTotal('');
      await load();
      await onChanged();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر حفظ الخطة');
    } finally { setSaving(false); }
  };

  const pay = async () => {
    if (!paying) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`/admin/installment-plans/${paying.planId}/entries/${paying.index}/pay`, {
        amount: Number(paying.amount), paidDate: paying.date, paymentMethod: paying.box,
      });
      notify('success', 'تم تسجيل القسط');
      setPaying(null);
      await load();
      await onChanged();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تسجيل القسط');
    } finally { setSaving(false); }
  };

  const remove = async (planId: string) => {
    if (!confirm('مسح الخطة؟ مفيش أقساط اتدفعت منها.')) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminDelete(`/admin/installment-plans/${planId}`);
      await load();
      await onChanged();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر مسح الخطة');
    } finally { setSaving(false); }
  };

  const today = cairoDateOnly();
  const field = 'rounded-lg border border-gray-200 px-2 py-1.5 text-sm';

  return (
    <Modal open onClose={onClose} title={`الأقساط — ${subscriber.name}`} size="lg"
      icon={<CalendarClock size={18} className="text-teal-600" />}>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto p-4" dir="rtl">
        {loading ? <p className="text-sm text-gray-500">جاري التحميل…</p> : plans.length === 0 ? (
          <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-500">مفيش خطة أقساط للعميل ده.</p>
        ) : plans.map(plan => {
          const paidAny = plan.entries.some(entry => entry.paidAt);
          const planPaid = plan.entries.filter(entry => entry.paidAt).reduce((sum, entry) => sum + (entry.paidAmount ?? entry.amount), 0);
          const course = items.find(item => item.item === plan.courseId);
          return (
            <div key={plan.id} className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <strong className="text-sm">{plan.courseTitle || 'أقساط'} — خطة {plan.totalAmount.toLocaleString('ar-EG-u-nu-latn')} {plan.currency}</strong>
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    <span className="rounded bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">اتدفع من الخطة {planPaid.toLocaleString('ar-EG-u-nu-latn')}</span>
                    <span className="rounded bg-amber-50 px-2 py-0.5 font-bold text-amber-700">باقي في الخطة {Math.max(0, plan.totalAmount - planPaid).toLocaleString('ar-EG-u-nu-latn')}</span>
                    {course && (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">
                        الكورس: {course.expected.toLocaleString('ar-EG-u-nu-latn')} · اتدفع {course.paid.toLocaleString('ar-EG-u-nu-latn')} · باقي {course.remaining.toLocaleString('ar-EG-u-nu-latn')}
                      </span>
                    )}
                  </div>
                </div>
                {!paidAny && (
                  <button type="button" onClick={() => { void remove(plan.id); }} disabled={saving}
                    className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" aria-label="مسح الخطة"><Trash2 size={14} /></button>
                )}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {plan.entries.map(entry => {
                    const index = Number(entry.id);
                    const open = paying?.planId === plan.id && paying.index === index;
                    return (
                      <tr key={entry.id} className="border-t border-gray-100">
                        <td className={`py-1.5 ${!entry.paidAt && entry.dueDate < today ? 'font-bold text-red-600' : ''}`}>{entry.dueDate}</td>
                        <td>{entry.amount.toLocaleString('ar-EG-u-nu-latn')} {plan.currency}</td>
                        <td className="text-left">
                          {entry.paidAt ? <span className="text-emerald-700">✅ اتدفع {entry.paidAt}</span> : open ? (
                            <span className="flex flex-wrap items-center justify-end gap-1">
                              <input type="number" min="1" value={paying.amount} onChange={e => setPaying({ ...paying, amount: e.target.value })} className={`${field} w-24`} />
                              <input type="date" value={paying.date} onChange={e => setPaying({ ...paying, date: e.target.value })} className={field} />
                              <select value={paying.box} onChange={e => setPaying({ ...paying, box: e.target.value })} className={field}>
                                <option value="">— الخزنة —</option>
                                {paymentBoxes.map(box => <option key={box} value={box}>{box}</option>)}
                              </select>
                              <button type="button" disabled={saving || !paying.box || !(Number(paying.amount) > 0)} onClick={() => { void pay(); }}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">تسجيل</button>
                              <button type="button" onClick={() => setPaying(null)} className="px-2 text-gray-500">إلغاء</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setPaying({ planId: plan.id, index, amount: String(entry.amount), date: today, box: '' })}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 font-bold text-emerald-700">تسديد</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/40 p-3">
          <p className="flex items-center gap-1 text-sm font-bold text-teal-800"><Plus size={14} /> خطة أقساط جديدة</p>
          {items.length === 0 && <p className="text-xs text-amber-700">العميل مش مشترك في كورس — احجزله الأول.</p>}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <select value={courseId} onChange={e => pickItem(e.target.value)} className={`${field} md:col-span-2`}>
              <option value="">— كورس من كورسات العميل —</option>
              {items.map(item => (
                <option key={item.item} value={item.item}>
                  {item.isTrack ? '📌 ' : ''}{item.title} — باقي {item.remaining.toLocaleString('ar-EG-u-nu-latn')} {item.currency}
                </option>
              ))}
            </select>
            <input type="number" min="1" placeholder="المبلغ الكلي" value={total} onChange={e => setTotal(e.target.value)} className={field} />
            <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={field}>
              <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
            </select>
            <input type="number" min="2" max="24" value={count} onChange={e => setCount(e.target.value)} className={field} title="عدد الأقساط" />
          </div>
          {chosen && (
            <p className="text-[11px] text-gray-600">
              سعر الكورس {chosen.expected.toLocaleString('ar-EG-u-nu-latn')} · اتدفع {chosen.paid.toLocaleString('ar-EG-u-nu-latn')} ·
              <b className="text-amber-700"> باقي {chosen.remaining.toLocaleString('ar-EG-u-nu-latn')} {chosen.currency}</b> — الخطة بتقسّم الباقي.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-600">أول قسط
              <input type="date" value={firstDue} onChange={e => setFirstDue(e.target.value)} className={`${field} mr-1`} />
            </label>
            <button type="button" disabled={!(Number(total) > 0) || !(Number(count) >= 2)}
              onClick={() => setEntries(schedule(Math.round(Number(total)), Math.min(24, Math.round(Number(count))), firstDue))}
              className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-bold text-teal-700 disabled:opacity-50">
              قسّم شهري
            </button>
          </div>
          {entries.length > 0 && (
            <div className="space-y-1">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-gray-500">قسط {i + 1}</span>
                  <input type="date" value={entry.dueDate} onChange={e => setEntries(list => list.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} className={field} />
                  <input type="number" min="1" value={entry.amount} onChange={e => setEntries(list => list.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className={`${field} w-28`} />
                </div>
              ))}
              {!canSave && <p className="text-[11px] text-amber-700">مجموع الأقساط ({draftTotal.toLocaleString('ar-EG-u-nu-latn')}) لازم يساوي المبلغ الكلي.</p>}
              <button type="button" disabled={saving || !canSave} onClick={() => { void create(); }}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ الخطة</button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
