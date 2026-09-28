import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw, UserPlus, Wallet, XCircle } from 'lucide-react';
import { cairoDay } from '../../../../../shared/cairoDate';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useStaticData } from '../../../../context/siteDataSlices';
import { LinkTransferDialog, type TransferLink } from './LinkTransferDialog';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

type BookingRequest = {
  id: string; name: string; phone: string | null; email: string | null; amount: number; currency: string;
  requestedByName: string | null; createdAt: string;
  payment: { courseId: string | null; bundleId: string | null; paymentMethod: string | null; transactionId: string | null; date: string | null; isInstallment: boolean; courseExpected: number | null; note: string | null };
};
type PendingPayment = {
  id: string; subscriberName: string; subscriberClientCode: string | null; amount: number; currency: string;
  paymentMethod: string | null; transactionId: string | null; at: string; staffName: string | null; staffRole: string | null;
  itemTitle: string | null; courseTitleAr: string | null; courseTitle: string | null; paymentType: string;
};
type Target =
  | { kind: 'request'; row: BookingRequest }
  | { kind: 'payment'; row: PendingPayment };

/**
 * «حجوزات بانتظار المراجعة» — what the manager confirms before it counts.
 *
 * A collection officer's new customer arrives as a request (nothing is created
 * yet), and any payment recorded without the right to confirm it arrives
 * pending. Each is approved against the transfer that brought the money —
 * «يتاكد من المدفوعات ويربطه بتحويل» — or rejected, and the officer hears
 * which on their own bell.
 */
export function CollectionBookingsReview({ notify, onChanged }: { notify: Notify; onChanged?: () => void }) {
  const { courses, bundles } = useStaticData();
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [requestRows, review] = await Promise.allSettled([
      mysqlAdmin.adminGet<BookingRequest[]>('/admin/subscriber-requests?status=pending'),
      mysqlAdmin.adminGet<{ rows: PendingPayment[] }>('/admin/payments/review?status=pending&limit=200'),
    ]);
    setRequests(requestRows.status === 'fulfilled' && Array.isArray(requestRows.value) ? requestRows.value : []);
    setPayments(review.status === 'fulfilled' ? (review.value.rows || []) : []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const itemTitle = (courseId: string | null, bundleId: string | null) =>
    (bundleId ? bundles.find(b => b.id === bundleId)?.title : courses.find(c => c.id === courseId)?.title) || '—';

  const approve = async (link: TransferLink | null) => {
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === 'request') {
        await mysqlAdmin.adminPost(`/admin/subscriber-requests/${encodeURIComponent(target.row.id)}/approve`, { transfer: link });
        notify('success', `✅ اتعتمد ${target.row.name} واتضاف للعملاء`);
      } else {
        // A row stored without a method takes the box the transfer arrived on.
        const method = target.row.paymentMethod || (link && 'method' in link ? link.method : undefined);
        await mysqlAdmin.adminPatch(`/admin/payments/${encodeURIComponent(target.row.id)}/status`, { status: 'paid', transfer: link, paymentMethod: method });
        notify('success', `✅ اتعتمدت دفعة ${target.row.subscriberName}`);
      }
      setTarget(null);
      await load();
      onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الاعتماد');
    } finally { setBusy(false); }
  };

  const reject = async (item: Target) => {
    const name = item.kind === 'request' ? item.row.name : item.row.subscriberName;
    if (!await confirmDialog(`ترفض ${item.kind === 'request' ? 'حجز' : 'دفعة'} ${name}؟ الموظف هيوصله الرفض.`)) return;
    try {
      if (item.kind === 'request') await mysqlAdmin.adminPost(`/admin/subscriber-requests/${encodeURIComponent(item.row.id)}/reject`, {});
      else await mysqlAdmin.adminPatch(`/admin/payments/${encodeURIComponent(item.row.id)}/status`, { status: 'failed', reviewNote: 'رفض المسئول' });
      notify('success', 'اترفض');
      await load();
      onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الرفض');
    }
  };

  const total = requests.length + payments.length;
  if (!loading && total === 0) return null;

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm" dir="rtl">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 text-white"><Clock size={17} /></span>
        <div className="flex-1">
          <h3 className="font-extrabold text-gray-900">حجوزات ومدفوعات بانتظار مراجعتك <span className="text-violet-700">({total})</span></h3>
          <p className="text-[11px] text-gray-500">مفيش حاجة من دول بتتحسب ولا بتفتح كورس لحد ما تربطها بالتحويل وتعتمدها.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg p-2 text-gray-500 hover:bg-white" aria-label="تحديث">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="space-y-2">
        {requests.map(row => (
          <div key={`r-${row.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-100 bg-white px-3 py-2.5">
            <UserPlus size={16} className="text-violet-600" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-gray-900">{row.name}</span>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">عميل جديد</span>
                <span className="text-[11px] text-gray-400" dir="ltr">{row.phone}</span>
              </div>
              <div className="text-[11px] text-gray-500">
                {itemTitle(row.payment.courseId, row.payment.bundleId)} · {row.payment.paymentMethod || 'بدون وسيلة'}
                {row.payment.transactionId ? ` · #${row.payment.transactionId}` : ''} · سجّله {row.requestedByName || '—'} · {cairoDay(row.createdAt)}
              </div>
            </div>
            <span className="font-black text-gray-900">{row.amount.toLocaleString('ar-EG-u-nu-latn')} <span className="text-[10px] font-bold text-gray-400">{row.currency}</span></span>
            <button type="button" onClick={() => setTarget({ kind: 'request', row })}
              className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"><CheckCircle2 size={13} /> ربط واعتماد</button>
            <button type="button" onClick={() => void reject({ kind: 'request', row })}
              className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"><XCircle size={13} /> رفض</button>
          </div>
        ))}
        {payments.map(row => (
          <div key={`p-${row.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-100 bg-white px-3 py-2.5">
            <Wallet size={16} className="text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-gray-900">{row.subscriberName || 'عميل'}</span>
                {row.subscriberClientCode && <span className="text-[11px] text-gray-400">{row.subscriberClientCode}</span>}
                {row.staffRole === 'collection' && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-700">من التحصيل</span>}
              </div>
              <div className="text-[11px] text-gray-500">
                {row.itemTitle || row.courseTitleAr || row.courseTitle || row.paymentType} · {row.paymentMethod || 'بدون وسيلة'}
                {row.transactionId ? ` · #${row.transactionId}` : ''} · سجّلها {row.staffName || '—'} · {cairoDay(row.at)}
              </div>
            </div>
            <span className="font-black text-gray-900">{row.amount.toLocaleString('ar-EG-u-nu-latn')} <span className="text-[10px] font-bold text-gray-400">{row.currency}</span></span>
            <button type="button" onClick={() => setTarget({ kind: 'payment', row })}
              className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"><CheckCircle2 size={13} /> ربط واعتماد</button>
            <button type="button" onClick={() => void reject({ kind: 'payment', row })}
              className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"><XCircle size={13} /> رفض</button>
          </div>
        ))}
      </div>
      {target && (
        <LinkTransferDialog
          title={target.kind === 'request' ? `${target.row.name} — عميل جديد` : target.row.subscriberName}
          amount={target.row.amount}
          currency={target.row.currency}
          method={target.kind === 'request' ? target.row.payment.paymentMethod : target.row.paymentMethod}
          reference={target.kind === 'request' ? target.row.payment.transactionId : target.row.transactionId}
          date={target.kind === 'request' ? target.row.payment.date : target.row.at}
          busy={busy}
          onConfirm={link => void approve(link)}
          onClose={() => setTarget(null)}
        />
      )}
    </section>
  );
}
