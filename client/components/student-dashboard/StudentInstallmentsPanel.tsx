import { Calendar, Camera, CheckCircle, Clock, CreditCard, Loader2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { compressImage } from '../../../shared/imageCompress';
import { CAIRO_TIME_ZONE, cairoDateOnly } from '../../../shared/cairoDate';
import { paymentMethodLabel } from '../../../shared/paymentMethods';
import { moneySuffix } from '../../lib/itemBalance';
import { useManualPaymentMethods, usePaymentAvailability } from '../../lib/usePaymentAvailability';

/**
 * The client's installment plans, each instalment with its own «ادفع القسط».
 *
 * The second and third instalments were paid by opening WhatsApp with the amount
 * typed in and waiting for the desk. The amount here is the server's — what the
 * entry still owes (GET /api/me/installments) — and paying opens Paymob for
 * exactly that entry, or takes a transfer receipt for it; either way the entry
 * is marked paid and the course opens further when the payment is confirmed.
 */
type Entry = {
  index: number; amount: number; dueDate: string; paidAt: string | null;
  partialPaid: number; due: number; underReview: boolean; reviewDueAt: string | null;
};
type Plan = { id: string; courseId: string | null; bundleId: string | null; title: string; totalAmount: number; currency: string; entries: Entry[] };
type Customer = { name?: string; email?: string; phone?: string };

const fmt = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');
const reviewTime = (iso: string | null) => {
  if (!iso) return 'خلال 24 ساعة';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'خلال 24 ساعة';
  return `قبل ${at.toLocaleString('ar-EG-u-nu-latn', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE })}`;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'حصلت مشكلة — جرّب تاني');
  return data as T;
}

export function StudentInstallmentsPanel({ customer, onChanged }: { customer: Customer; onChanged?: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [receiptFor, setReceiptFor] = useState<{ planId: string; index: number } | null>(null);
  const [receiptImage, setReceiptImage] = useState('');
  const [receiptMethod, setReceiptMethod] = useState('');
  const [sentNotice, setSentNotice] = useState('');
  const online = usePaymentAvailability();
  const manualMethods = useManualPaymentMethods();

  const load = useCallback(() => {
    fetch('/api/me/installments', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { plans: [] }))
      .then((d: { plans?: Plan[] }) => setPlans(Array.isArray(d.plans) ? d.plans : []))
      .catch(() => setPlans([]));
  }, []);
  useEffect(load, [load]);

  const payByCard = async (plan: Plan, entry: Entry) => {
    const key = `${plan.id}:${entry.index}`;
    setBusy(key); setError('');
    try {
      const order = await postJson<{ orderId: string; itemTitle: string }>(
        `/api/me/installments/${encodeURIComponent(plan.id)}/entries/${entry.index}/checkout`, { method: 'card' });
      const init = await postJson<{ iframeUrl?: string }>('/api/payments/paymob-init', {
        orderId: order.orderId, itemTitle: order.itemTitle,
        customerName: customer.name || '', customerEmail: customer.email || '', customerPhone: customer.phone || '',
      });
      if (!init.iframeUrl) throw new Error('تعذر بدء الدفع الإلكتروني — جرّب التحويل وارفع الإيصال');
      window.location.assign(init.iframeUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر بدء الدفع');
      setBusy('');
    }
  };

  const sendReceipt = async (plan: Plan, entry: Entry) => {
    if (!receiptImage) { setError('ارفع صورة الإيصال الأول'); return; }
    const key = `${plan.id}:${entry.index}`;
    setBusy(key); setError('');
    try {
      const order = await postJson<{ orderId: string; itemTitle: string }>(
        `/api/me/installments/${encodeURIComponent(plan.id)}/entries/${entry.index}/checkout`, { method: 'transfer' });
      const intent = await postJson<{ id: string }>('/api/me/payment-intents', {
        order_id: order.orderId, provider: 'manual', idempotency_key: `installment:${order.orderId}`,
      });
      const proof = await postJson<{ review_due_at?: string }>('/api/me/payment-proof', {
        order_id: order.orderId, payment_intent_id: intent.id,
        payment_method: receiptMethod || manualMethods[0] || 'other',
        proof_image: receiptImage, note: order.itemTitle,
      });
      setSentNotice(`استلمنا إيصال ${order.itemTitle} — قيد المراجعة، وهنأكده ${reviewTime(proof.review_due_at || null)}.`);
      setReceiptFor(null); setReceiptImage('');
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الإيصال');
    } finally {
      setBusy('');
    }
  };

  if (!plans || plans.length === 0) return null;
  const today = cairoDateOnly();

  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-gray-700">
        <Calendar size={15} className="text-amber-500" /> خطط الأقساط
      </p>
      {sentNotice && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle size={16} /> {sentNotice}
        </div>
      )}
      {error && <p className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}
      <div className="space-y-4">
        {plans.map(plan => {
          const paidTotal = plan.entries.reduce((sum, entry) => sum + (entry.paidAt ? entry.amount : entry.partialPaid), 0);
          const remaining = Math.max(0, plan.totalAmount - paidTotal);
          // The one to pay next: the earliest still owing.
          const nextIndex = plan.entries.find(entry => entry.due > 0 && !entry.underReview)?.index;
          return (
            <div key={plan.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-50 bg-amber-50/50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-gray-800">{plan.title || 'خطة أقساط'}</p>
                  <p className="text-xs text-gray-500">الإجمالي: {fmt(plan.totalAmount)} {moneySuffix(plan.currency)}</p>
                </div>
                <p className="text-xs text-gray-500">متبقي: <span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{remaining > 0 ? `${fmt(remaining)} ${moneySuffix(plan.currency)}` : 'مكتمل'}</span></p>
              </div>
              <div className="divide-y divide-gray-50">
                {plan.entries.map(entry => {
                  const key = `${plan.id}:${entry.index}`;
                  const overdue = !entry.paidAt && entry.dueDate < today;
                  const receiptOpen = receiptFor?.planId === plan.id && receiptFor.index === entry.index;
                  return (
                    <div key={key} className={`px-4 py-3 text-sm ${overdue ? 'bg-red-50/60' : entry.paidAt ? 'bg-emerald-50/30' : ''}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-bold text-gray-800">القسط {entry.index + 1}: {fmt(entry.paidAt ? entry.amount : entry.due)} {moneySuffix(plan.currency)}</p>
                          <p className="text-xs text-gray-500">
                            موعده: {entry.dueDate}
                            {entry.partialPaid > 0 && !entry.paidAt ? ` · اتدفع منه ${fmt(entry.partialPaid)}` : ''}
                          </p>
                        </div>
                        {entry.paidAt ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-600">مدفوع</span>
                        ) : entry.underReview ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">
                            <Clock size={12} /> الإيصال قيد المراجعة — {reviewTime(entry.reviewDueAt)}
                          </span>
                        ) : entry.due > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">متأخر</span>}
                            {online && (
                              <button
                                type="button" disabled={!!busy} onClick={() => payByCard(plan, entry)}
                                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white transition disabled:opacity-60 ${entry.index === nextIndex ? 'bg-primary-700 hover:bg-primary-800' : 'bg-gray-500 hover:bg-gray-600'}`}
                              >
                                {busy === key ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />} ادفع القسط
                              </button>
                            )}
                            <button
                              type="button" disabled={!!busy}
                              onClick={() => { setReceiptFor(receiptOpen ? null : { planId: plan.id, index: entry.index }); setReceiptImage(''); setError(''); }}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
                            >
                              <Upload size={13} /> حوّلت؟ ارفع الإيصال
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {receiptOpen && (
                        <div className="mt-3 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                          <p className="text-xs text-gray-600">حوّل <b>{fmt(entry.due)} {moneySuffix(plan.currency)}</b> وارفع صورة الإيصال — هنراجعه ونأكد القسط.</p>
                          <div className="flex flex-wrap gap-2">
                            {manualMethods.map(method => (
                              <button key={method} type="button" onClick={() => setReceiptMethod(method)}
                                className={`rounded-lg border-2 px-2 py-1 text-xs font-medium ${(receiptMethod || manualMethods[0]) === method ? 'border-emerald-500 bg-white text-emerald-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                                {paymentMethodLabel(method)}
                              </button>
                            ))}
                          </div>
                          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-white p-3 text-xs text-gray-500">
                            <input type="file" accept="image/*" className="hidden" onChange={async event => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              try { setReceiptImage(await compressImage(file, 'receipt')); setError(''); }
                              catch { setError('تعذّر قراءة الصورة — جرّب صورة تانية'); }
                            }} />
                            {receiptImage ? <img src={receiptImage} alt="الإيصال" className="max-h-32 rounded-lg object-contain" /> : <><Camera size={18} /> اضغط لرفع صورة الإيصال</>}
                          </label>
                          <button type="button" disabled={!!busy} onClick={() => sendReceipt(plan, entry)}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                            {busy === key ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />} إرسال الإيصال
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
