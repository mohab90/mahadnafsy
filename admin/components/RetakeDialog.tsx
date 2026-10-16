import { useMemo, useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { cairoDateOnly } from '../../shared/cairoDate';
import { arabicReason } from '../lib/apiErrorText';
import { useSiteData } from '../context/SiteDataContext';
import type { Course } from '../types';

export type RetakeOption = { cid: string; label: string; remaining: number | null };
type Currency = 'EGP' | 'SAR' | 'USD';

const RETAKE_PERCENT_OFF = 50;

/**
 * «إعادة»: the client takes a course they took before, again, at 50% off.
 *
 * «في زر حجز وادفع محتاجين نضيف بجانب جديد وقسط … زر اسمه إعادة، ودا بيخلي العميل يعيد نفس
 * كورس واحده قبل كدا بخصم 50%» (14 Oct 2026). The price shown is the course's list price in
 * the chosen currency, halved; the server works it out again from the catalogue
 * (api/lib/courseRetake.js) and refuses a course the client did not take, one still owing, or an
 * amount above the retake price. Only the courses the client holds are offered.
 */
export function RetakeDialog({ subjectId, subjectName, options, courses, currency: startCurrency, branch, paymentMethods, onClose, onDone }: {
  subjectId: string;
  subjectName: string;
  options: RetakeOption[];
  courses: Course[];
  currency: Currency;
  branch?: string;
  paymentMethods: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { recordSubscriberPayment } = useSiteData();
  const [currency, setCurrency] = useState<Currency>(startCurrency);
  const [courseId, setCourseId] = useState(options.find(option => !(option.remaining && option.remaining > 0))?.cid || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [date, setDate] = useState(cairoDateOnly());
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const listPrice = (id: string) => Number((courses.find(course => course.id === id)?.price as unknown as Record<string, number> | undefined)?.[currency]) || 0;
  const retakePrice = (id: string) => Math.round(listPrice(id) * (100 - RETAKE_PERCENT_OFF) / 100);
  const price = courseId ? retakePrice(courseId) : 0;
  const owing = useMemo(() => options.find(option => option.cid === courseId)?.remaining || 0, [options, courseId]);
  const paying = Number(amount) || 0;
  const field = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200';
  const money = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

  const choose = (id: string) => { setCourseId(id); setAmount(String(retakePrice(id) || '')); setError(''); };
  const valid = Boolean(courseId) && price > 0 && owing <= 0 && paying > 0 && paying <= price && Boolean(method);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError('');
    try {
      await recordSubscriberPayment(subjectId, {
        paymentType: 'course', courseId, amount: paying, currency, paymentMethod: method, date,
        retake: true, isInstallment: false, ...(branch ? { branch } : {}),
        transactionId: transactionId.trim() || undefined, note: note.trim() || undefined,
      });
      onDone();
    } catch (failure) {
      setError(arabicReason(failure, 'تعذّر تسجيل الإعادة'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`إعادة كورس بخصم ${RETAKE_PERCENT_OFF}%`} subtitle={subjectName} size="md" layer="over">
      <div className="space-y-3 px-5 pb-5 pt-3 text-sm" dir="rtl">
        {options.length === 0 ? (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">العميل ماخدش أي كورس قبل كده — الإعادة للكورس اللي خلّصه بس. اختار «حجز جديد».</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-gray-600">الكورس اللي هيعيده</p>
              <select value={currency} onChange={event => { setCurrency(event.target.value as Currency); setAmount(''); }} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold" aria-label="العملة">
                <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
              </select>
            </div>
            <div className="space-y-1.5">
              {options.map(option => {
                const half = retakePrice(option.cid);
                const blocked = Boolean(option.remaining && option.remaining > 0);
                return (
                  <button key={option.cid} type="button" disabled={blocked || half <= 0} onClick={() => choose(option.cid)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-right transition ${courseId === option.cid ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300'} disabled:cursor-not-allowed disabled:opacity-50`}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-gray-800">🎓 {option.label}</span>
                      {blocked && <span className="text-[11px] font-bold text-amber-600">لسه عليه متبقي {money(option.remaining || 0)} — اقفله الأول</span>}
                      {!blocked && half <= 0 && <span className="text-[11px] text-gray-500">مفيش سعر للكورس بالعملة دي</span>}
                    </span>
                    {!blocked && half > 0 && (
                      <span className="shrink-0 text-left">
                        <span className="block text-[10px] text-gray-400 line-through">{money(listPrice(option.cid))}</span>
                        <span className="block text-sm font-extrabold text-red-700">{money(half)} {currency}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-bold text-gray-600">المبلغ (لحد سعر الإعادة)
                <input type="number" min={0} max={price || undefined} value={amount} onChange={event => setAmount(event.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block text-xs font-bold text-gray-600">وسيلة الدفع
                <select value={method} onChange={event => setMethod(event.target.value)} className={`${field} mt-1`}>
                  <option value="">— اختار —</option>
                  {paymentMethods.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-gray-600">التاريخ
                <input type="date" value={date} onChange={event => setDate(event.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block text-xs font-bold text-gray-600">رقم العملية (اختياري)
                <input value={transactionId} onChange={event => setTransactionId(event.target.value)} className={`${field} mt-1`} />
              </label>
            </div>
            <label className="block text-xs font-bold text-gray-600">ملاحظة (اختياري)
              <input value={note} onChange={event => setNote(event.target.value)} className={`${field} mt-1`} />
            </label>
            {paying > 0 && price > 0 && paying > price && <p className="text-xs font-bold text-red-600">المبلغ أكبر من سعر الإعادة ({money(price)} {currency}).</p>}
            {error && <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-700" role="alert">{error}</p>}
          </>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm hover:bg-gray-50">إلغاء</button>
          <button type="button" disabled={!valid || busy} onClick={() => void submit()} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40">
            {busy ? '⏳…' : 'سجّل الإعادة'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
