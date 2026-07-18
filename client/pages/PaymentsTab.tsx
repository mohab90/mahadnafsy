import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Award, IdCard, Wallet, Clock, CheckCircle2, AlertCircle, Upload, Send } from 'lucide-react';
import { mysqlClient } from '../lib/mysqlapi';
import type { SubscriberItem, Currency } from '../types';

type Cur = 'EGP' | 'SAR' | 'USD';
const SYM: Record<Cur, string> = { EGP: 'ج.م', SAR: 'ر.س', USD: '$' };

interface Props {
  subscriber: SubscriberItem | undefined;
  currency: Currency;
  onGoToCertificates: () => void;
  onPaid: () => void; // refresh subscriber after a submission
}

type Mode = null | 'pay' | 'card';

/** صفحة "مدفوعاتي" — ملخص مالي + الأقساط المستحقة + سجل المدفوعات + طلبات،
 *  مع 3 إجراءات: سداد دفعة/قسط، حجز شهادة، حجز كارنيه (بطاقة عضوية).
 *  Self-contained: reuses the existing /me/payment-proof endpoint (admin reviews submissions). */
export default function PaymentsTab({ subscriber, currency, onGoToCertificates, onPaid }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState<Cur>((currency as Cur) || 'EGP');
  const [method, setMethod] = useState<'instapay' | 'bank_transfer' | 'vodafone_cash' | 'fawry' | 'other'>('instapay');
  const [note, setNote] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [proofs, setProofs] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    mysqlClient.getMyPaymentProofs().then(rows => setProofs((rows as Array<Record<string, unknown>>) || [])).catch(() => {});
  }, [success]);

  const paidTotals = useMemo(() => {
    const t: Record<Cur, number> = { EGP: 0, SAR: 0, USD: 0 };
    (subscriber?.paymentHistory ?? []).forEach(p => { if (t[p.currency as Cur] !== undefined) t[p.currency as Cur] += p.amount; });
    return t;
  }, [subscriber]);

  const dueInstallments = useMemo(() => {
    return (subscriber?.installmentPlans ?? []).flatMap(plan =>
      (plan.entries ?? [])
        .filter(e => !e.paidAt)
        .map(e => ({ planTitle: plan.courseTitle || 'خطة تقسيط', amount: e.amount, currency: e.currency as Cur, dueDate: e.dueDate, id: e.id }))
    ).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  }, [subscriber]);

  const certRequests = subscriber?.extraCertificateRequests ?? [];

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { setError('حجم الصورة كبير (الحد 4MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(reader.result as string); setImageName(f.name); };
    reader.readAsDataURL(f);
  };

  const resetForm = () => { setAmount(''); setNote(''); setImage(null); setImageName(''); setError(''); };

  const openPay = (presetAmount?: number, presetCur?: Cur) => {
    resetForm(); setSuccess('');
    if (presetAmount) setAmount(String(presetAmount));
    if (presetCur) setCur(presetCur);
    setMode('pay');
  };

  const submit = async () => {
    setError('');
    const isCard = mode === 'card';
    const amt = parseFloat(amount || '0');
    if (!isCard && (!amt || amt <= 0)) { setError('أدخل المبلغ المدفوع'); return; }
    setSubmitting(true);
    try {
      if (isCard) throw new Error('Membership card requests are not payment proofs');
      const orders = await mysqlClient.getMyOrders();
      const pendingOrder = orders.find(order =>
        ['PENDING', 'PAYMENT_PENDING', 'AWAITING_PAYMENT'].includes(String(order.status).toUpperCase()) &&
        Number(order.amount) === amt && String(order.currency).toUpperCase() === cur
      );
      if (!pendingOrder) throw new Error('No matching pending order');
      await mysqlClient.submitPaymentProof({
        order_id: pendingOrder.id,
        payment_method: isCard ? 'card_request' : method,
        proof_image: image,
        note: isCard ? `طلب كارنيه (بطاقة عضوية)${note ? ' — ' + note : ''}` : note,
      });
      setSuccess(isCard ? 'تم إرسال طلب الكارنيه — ستتم مراجعته من الإدارة.' : 'تم إرسال إثبات الدفع — ستتم مراجعته من الإدارة.');
      setMode(null);
      resetForm();
      onPaid();
    } catch {
      setError('تعذّر الإرسال، حاول مجددًا.');
    }
    setSubmitting(false);
  };

  const Money = ({ v, c }: { v: number; c: Cur }) => <span>{v.toLocaleString()} {SYM[c]}</span>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary-700 to-primary-900 text-white rounded-2xl p-5 shadow">
        <div className="flex items-center gap-2 mb-3"><Wallet size={20} /><h2 className="text-lg font-bold">مدفوعاتي</h2></div>
        <div className="grid grid-cols-3 gap-3">
          {(['EGP', 'SAR', 'USD'] as Cur[]).filter(c => paidTotals[c] > 0).map(c => (
            <div key={c} className="bg-white/10 rounded-xl p-3 text-center">
              <div className="text-xs text-white/70 mb-1">إجمالي مدفوع</div>
              <div className="font-bold"><Money v={paidTotals[c]} c={c} /></div>
            </div>
          ))}
          {(['EGP','SAR','USD'] as Cur[]).every(c => paidTotals[c] === 0) && (
            <div className="col-span-3 text-sm text-white/80">لا توجد مدفوعات مسجّلة بعد.</div>
          )}
        </div>
      </div>

      {/* Success / error banners */}
      {success && <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl px-4 py-3 text-sm flex items-center gap-2"><CheckCircle2 size={16} />{success}</div>}

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={() => openPay()} className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl px-4 py-4 font-bold shadow-sm transition">
          <CreditCard size={18} /> سداد دفعة / قسط
        </button>
        <button onClick={onGoToCertificates} className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl px-4 py-4 font-bold shadow-sm transition">
          <Award size={18} /> حجز / طلب شهادة
        </button>
        <button onClick={() => { resetForm(); setSuccess(''); setMode('card'); }} className="flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white rounded-2xl px-4 py-4 font-bold shadow-sm transition">
          <IdCard size={18} /> حجز كارنيه (بطاقة عضوية)
        </button>
      </div>

      {/* Inline form (pay / card) */}
      {mode && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-900">{mode === 'card' ? 'طلب كارنيه (بطاقة عضوية)' : 'تسجيل دفعة / سداد قسط'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">المبلغ {mode === 'card' ? '(إن وُجدت رسوم)' : ''}</label>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm" placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-gray-500">العملة</label>
              <select value={cur} onChange={e => setCur(e.target.value as Cur)} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm">
                <option value="EGP">جنيه مصري</option><option value="SAR">ريال سعودي</option><option value="USD">دولار</option>
              </select>
            </div>
            {mode === 'pay' && (
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-500">وسيلة الدفع</label>
                <select value={method} onChange={e => setMethod(e.target.value as typeof method)} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm">
                  <option value="instapay">إنستا باي</option><option value="vodafone_cash">فودافون كاش</option>
                  <option value="bank_transfer">تحويل بنكي</option><option value="fawry">فوري</option><option value="other">أخرى</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">ملاحظة (اختياري)</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none" placeholder={mode === 'card' ? 'بيانات إضافية للكارنيه…' : 'رقم العملية / تفاصيل التحويل…'} />
            </div>
            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-primary-600 font-bold">
                <Upload size={15} /> {imageName || 'إرفاق صورة الإيصال (اختياري)'}
                <input type="file" accept="image/*" className="hidden" onChange={onFile} />
              </label>
            </div>
          </div>
          {error && <div className="text-red-600 text-sm flex items-center gap-1"><AlertCircle size={14} />{error}</div>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={submitting} className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-xl px-5 py-2.5 font-bold text-sm flex items-center gap-2">
              <Send size={15} /> {submitting ? 'جارٍ الإرسال…' : 'إرسال'}
            </button>
            <button onClick={() => { setMode(null); resetForm(); }} className="bg-gray-100 text-gray-700 rounded-xl px-4 py-2.5 text-sm">إلغاء</button>
          </div>
        </div>
      )}

      {/* Due installments */}
      {dueInstallments.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Clock size={16} className="text-orange-500" /> أقساط مستحقة</h3>
          <div className="space-y-2">
            {dueInstallments.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2.5">
                <div className="text-sm">
                  <div className="font-bold text-gray-800">{d.planTitle}</div>
                  <div className="text-xs text-gray-500">الاستحقاق: {d.dueDate || '—'}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-orange-700"><Money v={d.amount} c={d.currency} /></span>
                  <button onClick={() => openPay(d.amount, d.currency)} className="bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold">ادفع</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-3">سجل المدفوعات</h3>
        {(subscriber?.paymentHistory ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">لا توجد مدفوعات بعد.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {(subscriber!.paymentHistory ?? []).slice().reverse().map((p, i) => (
              <div key={p.id || i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <div className="font-bold text-gray-800"><Money v={p.amount} c={p.currency as Cur} /></div>
                  <div className="text-xs text-gray-500">{p.paymentMethod || ''}{p.note ? ` — ${p.note}` : ''}</div>
                </div>
                {p.isInstallment && <span className="text-[11px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">قسط</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My submitted proofs status */}
      {proofs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-3">طلباتي المرسلة (قيد المراجعة)</h3>
          <div className="space-y-2">
            {proofs.map((pr, i) => {
              const st = String(pr.status || 'pending');
              const label = st === 'approved' ? 'مقبول' : st === 'rejected' ? 'مرفوض' : 'قيد المراجعة';
              const cls = st === 'approved' ? 'bg-green-50 text-green-700' : st === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700';
              return (
                <div key={String(pr.id) || i} className="flex items-center justify-between gap-3 text-sm border border-gray-100 rounded-xl px-3 py-2">
                  <span className="text-gray-700">{Number(pr.amount || 0).toLocaleString()} {SYM[(pr.currency as Cur) || 'EGP']} — {String(pr.payment_method || '')}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${cls}`}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Certificate requests status */}
      {certRequests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Award size={16} className="text-amber-500" /> طلبات الشهادات</h3>
          <div className="space-y-2">
            {certRequests.map((r, i) => (
              <div key={r.id || i} className="flex items-center justify-between gap-3 text-sm border border-gray-100 rounded-xl px-3 py-2">
                <span className="text-gray-700">{r.nameAr || r.customName || r.type}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-50 text-amber-700">{r.status === 'issued' ? 'صادرة' : r.status === 'priced' ? 'بانتظار الدفع' : 'قيد المراجعة'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
