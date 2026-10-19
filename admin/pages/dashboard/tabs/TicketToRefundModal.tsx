import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { cairoDateLabel } from '../../../../shared/cairoDate';

// «لازم يكون في زر تحويل لاسترداد لو العميل مشكلته متحلتش … بيروح قسم الاسترداد ولكن بيروح معاه كل التفاصيل»
// (19 Oct 2026). The problem is closed and handed to the refunds desk as a request against one of the client's
// paid payments; the server writes the problem's whole history onto the request (api/lib/ticketHistory.js).
type Payment = { id: string; amount: number; currency: string; method: string | null; title: string; date: string; courseItem: string };

export function TicketToRefundModal({ ticketId, title, subject, onClose, onDone, onError }: {
  ticketId: string;
  title: string;
  subject: string;
  onClose: () => void;
  onDone: () => void;
  onError: (text: string) => void;
}) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(subject);
  const [saving, setSaving] = useState(false);
  // The parent passes a new function every render; the payments are loaded once per problem.
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.adminGet<{ refundablePayments?: Payment[] }>(`/admin/tickets/${encodeURIComponent(ticketId)}`)
      .then(row => {
        if (cancelled) return;
        const list = Array.isArray(row?.refundablePayments) ? row.refundablePayments : [];
        setPayments(list);
        if (list.length === 1) { setPaymentId(list[0].id); setAmount(String(list[0].amount)); }
      })
      .catch(error => { if (!cancelled) { setPayments([]); report.current(error instanceof Error ? error.message : 'تعذر تحميل دفعات العميل'); } });
    return () => { cancelled = true; };
  }, [ticketId]);

  const picked = payments?.find(payment => payment.id === paymentId) || null;
  const field = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';
  const money = (payment: Payment) => `${payment.amount.toLocaleString('ar-EG-u-nu-latn')} ${payment.currency}`;

  const save = async () => {
    const value = Number(amount);
    if (!picked) { onError('اختار الدفعة اللي الاسترداد ليها'); return; }
    if (!Number.isFinite(value) || value <= 0) { onError('اكتب مبلغ الاسترداد'); return; }
    if (value - picked.amount > 0.01) { onError(`المبلغ أكبر من المدفوع (${money(picked)})`); return; }
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`/admin/tickets/${encodeURIComponent(ticketId)}/convert-to-refund`, {
        payment_id: picked.id, amount: value, currency: picked.currency, reason: reason.trim(),
      });
      onDone();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'تعذر التحويل لاسترداد');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="تحويل لاسترداد" subtitle={title} size="sm" layer="over">
      <div className="space-y-3" dir="rtl">
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
          المشكلة هتتشال من الشغل الحالي وتروح لقسم الاسترداد، ومعاها كل اللي اتكتب واتعمل فيها. بتفضل محفوظة في الأرشيف.
        </p>
        {payments === null ? (
          <p className="py-6 text-center text-sm text-slate-400">جاري التحميل…</p>
        ) : payments.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            العميل ده مالوش دفعات مدفوعة نقدر نسترد منها. لو في فلوس اتدفعت برا السيستم، سجّل الاسترداد من صفحة الاستردادات.
          </p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-500">الدفعة</span>
              <select value={paymentId} onChange={event => {
                const next = payments.find(payment => payment.id === event.target.value);
                setPaymentId(event.target.value);
                setAmount(next ? String(next.amount) : '');
              }} className={field}>
                <option value="">— اختار الدفعة —</option>
                {payments.map(payment => (
                  <option key={payment.id} value={payment.id}>
                    {`${payment.title || 'دفعة'} · ${money(payment)} · ${cairoDateLabel(payment.date)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-500">مبلغ الاسترداد{picked ? ` (حتى ${money(picked)})` : ''}</span>
              <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" dir="ltr" className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-500">السبب</span>
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} className={`${field} resize-none`} />
            </label>
          </>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm hover:bg-slate-50">إلغاء</button>
          {payments && payments.length > 0 && (
            <button disabled={saving || !picked} onClick={() => void save()} className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {saving ? '⏳…' : 'تحويل لاسترداد'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
