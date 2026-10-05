// Void or correct a recorded payment — managers only. The server keeps the
// books, commissions and course access in step (api/routes/payment-corrections.js):
// a new amount, currency or course becomes a corrected payment and the old one
// is voided; a changed currency needs the paid amount entered again in it.

import { useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { Modal } from '../../shared/ui/Modal';
import { cairoDay } from '../../shared/cairoDate';
import { mysqlAdmin } from '../lib/mysqlapi';
import { usePaymentBoxes } from '../lib/paymentMethods';
import { useStaticData } from '../context/siteDataSlices';

export type CorrectablePayment = {
  id: string;
  amount: number;
  currency?: string;
  courseId?: string;
  bundleId?: string;
  paymentMethod?: string;
  transactionId?: string;
  note?: string;
  at?: string;
  clientName?: string;
};

type Item = { id: string; title: string };
const CURRENCIES: { value: string; label: string }[] = [
  { value: 'EGP', label: 'جنيه مصري' },
  { value: 'SAR', label: 'ريال سعودي' },
  { value: 'USD', label: 'دولار' },
];
const input = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none';

export function PaymentCorrectionModal({ payment, mode, courses = [], bundles = [], onClose, onDone, notify }: {
  payment: CorrectablePayment;
  mode: 'edit' | 'void';
  courses?: Item[];
  bundles?: Item[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const { content } = useStaticData();
  const boxes = usePaymentBoxes(content['finance.payment_methods']);
  const originalCurrency = payment.currency || 'EGP';
  const originalItem = payment.bundleId ? `bundle:${payment.bundleId}` : (payment.courseId || '');
  const [reason, setReason] = useState('');
  const [currency, setCurrency] = useState(originalCurrency);
  const [amount, setAmount] = useState(String(payment.amount ?? ''));
  const [item, setItem] = useState(originalItem);
  const [method, setMethod] = useState(payment.paymentMethod || '');
  const [date, setDate] = useState(cairoDay(payment.at) || '');
  const [note, setNote] = useState(payment.note || '');
  const [transactionId, setTransactionId] = useState(payment.transactionId || '');
  const [busy, setBusy] = useState(false);

  const currencyChanged = currency !== originalCurrency;
  const amountMissing = currencyChanged && !(Number(amount) > 0);
  const ready = reason.trim().length > 0 && !amountMissing && (mode === 'void' || Number(amount) > 0);

  const changeCurrency = (next: string) => {
    setCurrency(next);
    // The old figure was in the old currency — it has to be typed again.
    setAmount(next === originalCurrency ? String(payment.amount ?? '') : '');
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      if (mode === 'void') {
        await mysqlAdmin.voidPayment(payment.id, reason.trim());
        notify('success', 'اتمسحت الدفعة — القيد اتعكس والعمولة والوصول اتراجعوا');
      } else {
        const body: Record<string, unknown> = { reason: reason.trim() };
        if (currencyChanged) body.currency = currency;
        if (currencyChanged || Number(amount) !== Number(payment.amount)) body.amount = Number(amount);
        if (item !== originalItem) body.courseId = item;
        if (method !== (payment.paymentMethod || '')) body.paymentMethod = method;
        if (date && date !== (cairoDay(payment.at) || '')) body.date = date;
        if (note !== (payment.note || '')) body.note = note;
        if (transactionId !== (payment.transactionId || '')) body.transactionId = transactionId;
        const result = await mysqlAdmin.correctPayment(payment.id, body);
        notify('success', result?.mode === 'edited' ? 'اتعدّلت الدفعة' : 'اتسجلت الدفعة بعد التصحيح واتلغت القديمة');
      }
      await onDone();
      onClose();
    } catch (error) {
      notify('error', error instanceof Error && error.message ? error.message : 'تعذر حفظ التعديل');
    } finally { setBusy(false); }
  };

  const isVoid = mode === 'void';
  return (
    <Modal open onClose={onClose} size="sm" tone={isVoid ? 'red' : 'indigo'} closeOnBackdrop={false}
      icon={isVoid ? <Trash2 size={16} /> : <Pencil size={16} />}
      title={isVoid ? 'مسح الدفعة' : 'تعديل الدفعة'}
      subtitle={`${payment.clientName ? `${payment.clientName} — ` : ''}${Number(payment.amount).toLocaleString('ar-EG-u-nu-latn')} ${originalCurrency}`}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100">إلغاء</button>
          <button type="button" onClick={() => void submit()} disabled={!ready || busy}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-40 ${isVoid ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
            {busy && <Loader2 size={14} className="animate-spin" />} {isVoid ? 'امسح الدفعة' : 'احفظ التعديل'}
          </button>
        </div>
      )}>
      <div className="space-y-3" dir="rtl">
        {isVoid ? (
          <p className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800">
            المسح بيعكس القيد المحاسبي، ويرجّع العمولة والمكافآت، ويقفل الكورس لو مفيش دفعة تانية بتفتحه. الدفعة بتفضل في السجل كمحذوفة بالسبب.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-bold text-gray-600">العملة
                <select value={currency} onChange={e => changeCurrency(e.target.value)} className={input}>
                  {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-gray-600">المدفوع{currencyChanged ? ` بالـ${currency}` : ''}
                <input type="number" min={0} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${input} ${amountMissing ? 'border-amber-400 bg-amber-50' : ''}`} placeholder={currencyChanged ? 'اكتب المبلغ تاني' : ''} />
              </label>
            </div>
            {currencyChanged && <p className="text-[11px] font-bold text-amber-700">غيّرت العملة — اكتب المبلغ المدفوع بالعملة الجديدة.</p>}
            <label className="block space-y-1 text-xs font-bold text-gray-600">الكورس / المسار
              <select value={item} onChange={e => setItem(e.target.value)} className={input}>
                <option value="">— بدون كورس —</option>
                {originalItem && ![...courses.map(c => c.id), ...bundles.map(b => `bundle:${b.id}`)].includes(originalItem) && <option value={originalItem}>{originalItem}</option>}
                {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                {bundles.map(b => <option key={b.id} value={`bundle:${b.id}`}>مسار: {b.title}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-bold text-gray-600">طريقة الدفع
                <select value={method} onChange={e => setMethod(e.target.value)} className={input}>
                  <option value="">—</option>
                  {[...new Set([method, ...boxes].filter(Boolean))].map(box => <option key={box} value={box}>{box}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-gray-600">التاريخ
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={input} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-bold text-gray-600">رقم العملية
                <input value={transactionId} onChange={e => setTransactionId(e.target.value)} className={input} dir="ltr" />
              </label>
              <label className="space-y-1 text-xs font-bold text-gray-600">ملاحظة
                <input value={note} onChange={e => setNote(e.target.value)} className={input} />
              </label>
            </div>
          </>
        )}
        <label className="block space-y-1 text-xs font-bold text-gray-600">السبب (إجباري)
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500} className={input}
            placeholder={isVoid ? 'مثلاً: الدفعة اتسجلت مرتين' : 'مثلاً: المبلغ اتكتب غلط'} />
        </label>
      </div>
    </Modal>
  );
}
