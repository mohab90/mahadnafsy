import { useMemo, useState } from 'react';
import { Loader2, RotateCcw, Search, X } from 'lucide-react';
import { useCrmData } from '../../../../context/siteDataSlices';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { SubscriberItem } from '../../../../types';
import { useModalKeyboard } from '../../../../components/shared/useModalKeyboard';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const REFUND_METHODS = ['تحويل بنكي', 'محفظة إلكترونية', 'كاش', 'إرجاع على نفس وسيلة الدفع'];

// The API refunds against one paid payment: it checks the payment belongs to the
// customer, refuses an amount that differs from it, and refuses a currency that
// does not match. So the amount is never typed here — picking the payment sets
// it. Typing it would only produce 400s and 409s the desk cannot act on.
const isRefundable = (payment: { status?: string }) =>
  !payment.status || payment.status === 'paid';

export function AddRefundModal({ onClose, onCreated, notify }: {
  onClose: () => void;
  onCreated: () => void;
  notify: NotifyFn;
}) {
  const { subscribers } = useCrmData();
  const panelRef = useModalKeyboard(onClose);
  const [branch, setBranch] = useState<'DAQQI' | 'ONLINE' | ''>('');
  const [search, setSearch] = useState('');
  const [subscriberId, setSubscriberId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState(REFUND_METHODS[0]);
  const [saving, setSaving] = useState(false);

  const branchOf = (item: SubscriberItem) =>
    String(item.branch || '').toUpperCase().replace(/[-\s]/g, '_').includes('DAQQI') ? 'DAQQI' : 'ONLINE';

  const candidates = useMemo(() => {
    if (!branch) return [];
    const term = search.trim().toLowerCase();
    return subscribers
      .filter(item => branchOf(item) === branch)
      .filter(item => !term
        || item.name.toLowerCase().includes(term)
        || (item.phone || '').includes(term)
        || (item.clientCode || '').toLowerCase().includes(term))
      .slice(0, 50);
  }, [subscribers, branch, search]);

  const subscriber = subscribers.find(item => item.id === subscriberId) || null;
  const payments = (subscriber?.paymentHistory || []).filter(isRefundable);
  const payment = payments.find(item => item.id === paymentId) || null;

  const submit = async () => {
    if (!subscriber || !payment) return notify('error', 'اختر العميل والدفعة المطلوب استردادها.');
    if (!reason.trim()) return notify('error', 'اكتب سبب الاسترداد.');
    setSaving(true);
    try {
      await mysqlAdmin.createRefundByAdmin({
        subscriber_id: subscriber.id,
        payment_id: payment.id,
        // Straight from the payment: the server compares both and refuses a
        // mismatch, so deriving them here is what makes the request succeed.
        amount: Number(payment.amount),
        currency: payment.currency || 'EGP',
        reason: reason.trim(),
        refund_method: method,
      });
      notify('success', 'تم تسجيل طلب الاسترداد');
      onCreated();
      onClose();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الاسترداد');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={panelRef} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" dir="rtl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-l from-rose-50 to-white">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><RotateCcw size={17} className="text-rose-600" />إضافة استرداد</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">الفرع <span className="text-red-500">*</span></label>
            <div className="flex gap-2">
              {([['DAQQI', 'الدقي'], ['ONLINE', 'أونلاين']] as const).map(([key, label]) => (
                <button key={key} onClick={() => { setBranch(key); setSubscriberId(''); setPaymentId(''); }}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border transition ${
                    branch === key ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {branch && (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">العميل <span className="text-red-500">*</span></label>
              <div className="relative mb-2">
                <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الكود..."
                  className="w-full pr-7 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-rose-400" />
              </div>
              <select value={subscriberId} onChange={event => { setSubscriberId(event.target.value); setPaymentId(''); }}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-rose-400 focus:outline-none">
                <option value="">اختر العميل...</option>
                {candidates.map(item => (
                  <option key={item.id} value={item.id}>{item.name} — {item.phone}{item.clientCode ? ` (${item.clientCode})` : ''}</option>
                ))}
              </select>
              {candidates.length === 0 && (
                <p className="text-[11px] text-amber-700 mt-1">مفيش عملاء مطابقين في فرع {branch === 'DAQQI' ? 'الدقي' : 'الأونلاين'}.</p>
              )}
            </div>
          )}

          {subscriber && (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">الدفعة المطلوب استردادها <span className="text-red-500">*</span></label>
              {payments.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-6">
                  العميل ده مفيش عنده دفعات مسجّلة. الاسترداد بيتربط بدفعة محصّلة، فلازم تتسجّل الدفعة الأول.
                </p>
              ) : (
                <select value={paymentId} onChange={event => setPaymentId(event.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-rose-400 focus:outline-none">
                  <option value="">اختر الدفعة...</option>
                  {payments.map(item => (
                    <option key={item.id} value={item.id}>
                      {Number(item.amount).toLocaleString()} {item.currency || 'EGP'} — {String(item.at || '').slice(0, 10)}
                      {item.paymentMethod ? ` — ${item.paymentMethod}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[10px] text-gray-400 mt-1 leading-5">
                الاسترداد الجزئي مقفول، فالمبلغ بيتاخد من الدفعة زي ما هو.
              </p>
            </div>
          )}

          {payment && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm">
              <span className="font-bold text-rose-900">هيتم استرداد {Number(payment.amount).toLocaleString()} {payment.currency || 'EGP'}</span>
              <span className="text-rose-700"> لـ{subscriber?.name}</span>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">وسيلة الاسترداد</label>
            <select value={method} onChange={event => setMethod(event.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-rose-400 focus:outline-none">
              {REFUND_METHODS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">السبب <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3}
              placeholder="اكتب سبب الاسترداد — بيتسجّل في الطلب وبيظهر لمن يعتمده."
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-rose-400 focus:outline-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 text-gray-600 hover:bg-white">إلغاء</button>
          <button onClick={() => void submit()} disabled={saving || !payment || !reason.trim()}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}تسجيل الاسترداد
          </button>
        </div>
      </div>
    </div>
  );
}
