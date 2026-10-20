import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cairoStamp } from '../../../../../shared/cairoDate';
import { paymentMethodLabel } from '../../../../../shared/paymentMethods';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { askRejectionReason } from '../../../../lib/rejectionReason';
import { LinkTransferDialog, type TransferLink } from './LinkTransferDialog';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export type BookingRequest = {
  id: string; name: string; phone: string | null; email: string | null; amount: number; currency: string;
  requestedByName: string | null; createdAt: string;
  payment: { courseId: string | null; bundleId: string | null; paymentMethod: string | null; transactionId: string | null; senderName?: string | null; fromAccountNumber?: string | null; date: string | null; isInstallment: boolean; courseExpected: number | null; note: string | null };
};

/**
 * New clients a collection officer sent — nothing is created for them until a manager approves against the transfer — shown as
 * rows of the payments table's «قيد المراجعة» tab, beside the other payments waiting.
 *
 * «التحويلات السعودية بتظهر فوق ليه … عاوزين نلغي الجزء اللى فوق وكله يظهر تحت» (20 Oct 2026): they were a separate block above
 * the table, so they were not among the payments and were gone from it. The rows go in the table's body; the dialog is drawn
 * outside it (`dialog`).
 */
export function useClientRequests({ enabled, notify, titleOf, onChanged }: {
  enabled: boolean; notify: Notify; titleOf: (courseId: string | null, bundleId: string | null) => string; onChanged?: () => void;
}): { count: number; rows: ReactNode; dialog: ReactNode } {
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [target, setTarget] = useState<BookingRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) { setRequests([]); return; }
    try {
      const rows = await mysqlAdmin.adminGet<BookingRequest[]>('/admin/subscriber-requests?status=pending');
      setRequests(Array.isArray(rows) ? rows : []);
    } catch { setRequests([]); }
  }, [enabled]);
  useEffect(() => { void load(); }, [load]);

  const approve = async (link: TransferLink | null) => {
    if (!target) return;
    setBusy(true);
    try {
      await mysqlAdmin.adminPost(`/admin/subscriber-requests/${encodeURIComponent(target.id)}/approve`, { transfer: link });
      notify('success', `✅ اتعتمد ${target.name} واتضاف للعملاء`);
      setTarget(null);
      await load();
      onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الاعتماد');
    } finally { setBusy(false); }
  };

  const reject = async (row: BookingRequest) => {
    const reason = await askRejectionReason('الحجز', row.name);
    if (reason === null) return;
    try {
      await mysqlAdmin.adminPost(`/admin/subscriber-requests/${encodeURIComponent(row.id)}/reject`, { note: reason });
      notify('success', 'اترفض');
      await load();
      onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الرفض');
    }
  };

  const rows = requests.map(row => (
    <tr key={`request-${row.id}`} className="border-b border-gray-100 bg-violet-50/40 transition-colors hover:bg-violet-50/70">
      <td className="px-3 py-2.5 font-mono text-gray-400 border-l border-gray-100 whitespace-nowrap"><span className="text-[9px]">#{row.id.slice(-6)}</span></td>
      <td className="px-3 py-2.5 border-l border-gray-100">
        <span className="text-gray-800 font-semibold text-[11px]">{row.name || '—'}</span>
        {row.phone && <div className="text-[10px] text-gray-400" dir="ltr">{row.phone}</div>}
      </td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px]"><span className="text-gray-300">—</span></td>
      <td className="px-3 py-2.5 border-l border-gray-100 max-w-[200px]">
        <span className="text-[11px] font-semibold text-gray-800 line-clamp-2">{titleOf(row.payment.courseId, row.payment.bundleId)}</span>
        {(row.payment.isInstallment || row.payment.note) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-gray-500">
            {row.payment.isInstallment && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700 border border-blue-200">قسط</span>}
            {row.payment.note && <span className="line-clamp-1" title={row.payment.note}>{row.payment.note}</span>}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 border-l border-gray-100 min-w-[150px] text-[11px]">
        {row.payment.transactionId && <div className="font-mono font-bold text-gray-800" dir="ltr">#{row.payment.transactionId}</div>}
        {row.payment.senderName && <div className="font-bold text-gray-700">{row.payment.senderName}</div>}
        {row.payment.fromAccountNumber && <div className="font-mono text-gray-500" dir="ltr">{row.payment.fromAccountNumber}</div>}
        {!row.payment.transactionId && !row.payment.senderName && !row.payment.fromAccountNumber && <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center">
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">عميل جديد</span>
      </td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center">
        <span className="font-extrabold text-emerald-700 text-[12px]">{Number(row.amount).toLocaleString('ar-EG-u-nu-latn')}</span>
        <span className="text-[9px] text-gray-400 mr-0.5">{row.currency || 'EGP'}</span>
      </td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-600">{paymentMethodLabel(row.payment.paymentMethod) || 'بدون وسيلة'}</td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500">{row.requestedByName || '—'}</td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500 whitespace-nowrap" dir="ltr">{cairoStamp(row.createdAt) || row.createdAt || '—'}</td>
      <td className="px-3 py-2.5 border-l border-gray-100 text-center">
        <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">⏳ انتظار</span>
      </td>
      <td className="px-3 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1">
          <button type="button" onClick={() => setTarget(row)} title="ربط بتحويل واعتماد"
            className="text-[10px] bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded-lg font-bold transition">🔗 ربط واعتماد</button>
          <button type="button" onClick={() => void reject(row)}
            className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold transition">✕ رفض</button>
        </div>
      </td>
    </tr>
  ));

  const dialog = target && (
    <LinkTransferDialog
      title={`${target.name} — عميل جديد`}
      customerName={target.name}
      amount={target.amount}
      currency={target.currency}
      method={target.payment.paymentMethod}
      reference={target.payment.transactionId}
      date={target.payment.date}
      busy={busy}
      onConfirm={link => void approve(link)}
      onClose={() => setTarget(null)}
    />
  );

  return { count: requests.length, rows, dialog };
}
