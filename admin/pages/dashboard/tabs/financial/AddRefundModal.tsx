import { useMemo, useState } from 'react';
import { Loader2, RotateCcw, Search } from 'lucide-react';
import { useCrmData, useStaticData } from '../../../../context/siteDataSlices';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { PaymentHistoryEntry, SubscriberItem } from '../../../../types';
import { Modal } from '../../../../../shared/ui/Modal';
import { REFUND_METHOD_CODES, paymentMethodLabel } from '../../../../../shared/paymentMethods';
import { cairoDay } from '../../../../../shared/cairoDate';
import { clientCurrency } from '../onlineClientsUtils';
import { usePaymentBoxes } from '../../../../lib/paymentMethods';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// Codes, not labels — «استرداد» on the online client writes the same list, and
// the inbox that prints them reads one vocabulary.

// «استرداد جزئي لكورس محدد للعميل … عند الاسترداد لازم يتحدد دفعه العميل …
// مش لازم الخطوه دي ممكن نلغيها لان في عملاء مش متسجلها دفعات». A refund is
// for a course, out of one of its payments or out of none; the amount is typed,
// up to the payment when there is one (the server holds it to what was paid for
// the course otherwise).
const isRefundable = (payment: { status?: string }) =>
  !payment.status || payment.status === 'paid';

const paymentItem = (payment: PaymentHistoryEntry) =>
  payment.bundleId ? `bundle:${payment.bundleId}` : payment.courseId || '';

export function AddRefundModal({ onClose, onCreated, notify, clients, subscriber: presetSubscriber, item: presetItem, itemTitle: presetTitle }: {
  onClose: () => void;
  onCreated: () => void;
  notify: NotifyFn;
  /**
   * Whom the refund can be for. An employee's own clients come from their
   * scoped list; the context holds the whole book only for an admin, so from a
   * staff account the picker was empty.
   */
  clients?: SubscriberItem[];
  /** Opened from a client's course: the client and the course are given. */
  subscriber?: SubscriberItem;
  item?: string;
  itemTitle?: string;
}) {
  const { subscribers: allSubscribers } = useCrmData();
  const { courses, bundles, content } = useStaticData();
  // With no payment behind it, the money leaves a box the institute keeps —
  // named, so the boxes report takes it out of that box.
  const boxes = usePaymentBoxes(content['finance.payment_methods']);
  const subscribers = clients ?? allSubscribers;
  const [branch, setBranch] = useState<'DAQQI' | 'ONLINE' | ''>('');
  const [search, setSearch] = useState('');
  const [subscriberId, setSubscriberId] = useState(presetSubscriber?.id || '');
  const [courseItem, setCourseItem] = useState(presetItem || '');
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<string>('bank_transfer');
  const [box, setBox] = useState('');
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

  const subscriber = presetSubscriber || subscribers.find(item => item.id === subscriberId) || null;
  const titleOf = (key: string) => key === presetItem && presetTitle ? presetTitle : key.startsWith('bundle:')
    ? bundles.find(bundle => bundle.id === key.slice(7))?.title || 'مسار'
    : (() => { const course = courses.find(entry => entry.id === key); return course?.titleAr || course?.title || 'كورس'; })();
  const items = [...new Set([
    ...(subscriber?.enrolledBundleIds || []).map(id => `bundle:${id}`),
    ...(subscriber?.enrolledCourseIds || []),
    ...(presetItem ? [presetItem] : []),
  ])];
  const payments = (subscriber?.paymentHistory || [])
    .filter(isRefundable)
    .filter(payment => !courseItem || paymentItem(payment) === courseItem);
  const payment = payments.find(item => item.id === paymentId) || null;
  const currency = payment?.currency || (subscriber ? clientCurrency(subscriber) : 'EGP');
  const value = Number(amount);
  const overPayment = !!payment && value - Number(payment.amount) > 0.01;
  const ready = !!subscriber && (!!payment || (!!courseItem && !!box)) && value > 0 && !overPayment && !!reason.trim();

  const submit = async () => {
    if (!subscriber) return notify('error', 'اختر العميل.');
    if (!payment && !courseItem) return notify('error', 'اختار الكورس أو الدفعة اللي الاسترداد ليها.');
    if (!payment && !box) return notify('error', 'اختار الخزنة اللي الفلوس هتخرج منها.');
    if (!(value > 0)) return notify('error', 'اكتب مبلغ الاسترداد.');
    if (overPayment) return notify('error', 'المبلغ أكبر من الدفعة.');
    if (!reason.trim()) return notify('error', 'اكتب سبب الاسترداد.');
    setSaving(true);
    try {
      await mysqlAdmin.createRefundByAdmin({
        subscriber_id: subscriber.id,
        payment_id: payment?.id || null,
        course_item: courseItem || null,
        amount: value,
        currency,
        reason: reason.trim(),
        refund_method: payment ? method : box,
      });
      notify('success', 'تم تسجيل طلب الاسترداد');
      onCreated();
      onClose();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الاسترداد');
    } finally { setSaving(false); }
  };

  const field = 'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-rose-400 focus:outline-none';
  return (
    <Modal
      open
      onClose={onClose}
      title={presetSubscriber ? `استرداد — ${presetSubscriber.name}` : 'إضافة استرداد'}
      icon={<RotateCcw size={17} className="text-rose-600" />}
      layer={presetSubscriber ? 'top' : undefined}
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 text-gray-600 hover:bg-white">إلغاء</button>
          <button onClick={() => void submit()} disabled={saving || !ready}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}تسجيل الاسترداد
          </button>
        </>
      )}
    >
        <div className="space-y-4">
          {!presetSubscriber && (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">الفرع <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                {([['DAQQI', 'الدقي'], ['ONLINE', 'أونلاين']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => { setBranch(key); setSubscriberId(''); setPaymentId(''); setCourseItem(''); }}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold border transition ${
                      branch === key ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!presetSubscriber && branch && (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">العميل <span className="text-red-500">*</span></label>
              <div className="relative mb-2">
                <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الكود..."
                  className="w-full pr-7 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-rose-400" />
              </div>
              <select value={subscriberId} onChange={event => { setSubscriberId(event.target.value); setPaymentId(''); setCourseItem(''); }} className={field}>
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
            <>
              <div>
                <label className="text-xs text-gray-600 font-bold mb-1 block">الكورس اللي الاسترداد ليه</label>
                <select value={courseItem} disabled={!!presetItem}
                  onChange={event => { setCourseItem(event.target.value); setPaymentId(''); }} className={`${field} disabled:bg-gray-50`}>
                  <option value="">{items.length ? 'اختار الكورس...' : 'العميل مش مشترك في كورسات'}</option>
                  {items.map(key => <option key={key} value={key}>{key.startsWith('bundle:') ? '📌 ' : ''}{titleOf(key)}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-600 font-bold mb-1 block">من دفعة (اختياري)</label>
                <select value={paymentId} className={field}
                  onChange={event => {
                    setPaymentId(event.target.value);
                    const picked = payments.find(item => item.id === event.target.value);
                    if (picked) {
                      setAmount(String(picked.amount));
                      if (!courseItem && paymentItem(picked)) setCourseItem(paymentItem(picked));
                    }
                  }}>
                  <option value="">بدون دفعة مسجّلة</option>
                  {payments.map(item => (
                    <option key={item.id} value={item.id}>
                      {Number(item.amount).toLocaleString('ar-EG-u-nu-latn')} {item.currency || 'EGP'} — {cairoDay(item.at)}
                      {item.paymentMethod ? ` — ${item.paymentMethod}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1 leading-5">
                  من غير دفعة الاسترداد بيتسجل على الكورس وبيتخصم من الخزنة اللي هتختارها تحت — للعملاء اللي دفعاتهم مش متسجلة.
                </p>
              </div>

              <div>
                <label className="text-xs text-gray-600 font-bold mb-1 block">المبلغ المسترد ({currency}) <span className="text-red-500">*</span></label>
                <input type="number" min="1" value={amount} onChange={event => setAmount(event.target.value)}
                  placeholder={payment ? `لحد ${payment.amount}` : 'المبلغ'} className={field} />
                {overPayment && <p className="text-[11px] text-red-600 mt-1">المبلغ أكبر من الدفعة ({payment?.amount}).</p>}
                {payment && value > 0 && !overPayment && value < Number(payment.amount) && (
                  <p className="text-[11px] text-amber-700 mt-1">استرداد جزئي — العميل بيفضل معاه الكورس.</p>
                )}
              </div>
            </>
          )}

          {payment || !subscriber ? (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">وسيلة الاسترداد</label>
              <select value={method} onChange={event => setMethod(event.target.value)} className={field}>
                {REFUND_METHOD_CODES.map(code => (
                  <option key={code} value={code}>{paymentMethodLabel(code)}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">الخزنة اللي الفلوس هتخرج منها <span className="text-red-500">*</span></label>
              <select value={box} onChange={event => setBox(event.target.value)} className={field}>
                <option value="">اختار الخزنة...</option>
                {boxes.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">السبب <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3}
              placeholder="اكتب سبب الاسترداد — بيتسجّل في الطلب وفي ملف العميل."
              className={field} />
          </div>
        </div>

    </Modal>
  );
}
