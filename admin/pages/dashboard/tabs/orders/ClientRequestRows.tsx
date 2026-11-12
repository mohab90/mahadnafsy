import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly, cairoStamp } from '../../../../../shared/cairoDate';
import { isCashBox, paymentMethodLabel } from '../../../../../shared/paymentMethods';
import { BRANCH_LABELS_AR, normalizeBranch } from '../../../../constants/branches';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { askRejectionReason } from '../../../../lib/rejectionReason';
import { LinkTransferDialog, type TransferLink } from './LinkTransferDialog';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export type BookingRequest = {
  id: string; name: string; phone: string | null; email: string | null; amount: number; currency: string; branch?: string | null;
  requestedByName: string | null; createdAt: string;
  payment: { courseId: string | null; bundleId: string | null; paymentMethod: string | null; transactionId: string | null; senderName?: string | null; fromAccountNumber?: string | null; date: string | null; isInstallment: boolean; courseExpected: number | null; note: string | null };
};
type EditDraft = { amount: string; paymentMethod: string; transactionId: string; senderName: string; fromAccountNumber: string; date: string; note: string };

const field = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm';

/**
 * New clients a collection officer sent — nothing is created for them until a manager approves — shown as rows of the payments
 * table's «قيد المراجعة» tab, beside the other payments waiting.
 *
 * «التحويلات السعودية بتظهر فوق ليه … عاوزين نلغي الجزء اللى فوق وكله يظهر تحت» (20 Oct 2026): they were a separate block above
 * the table. «في شكلين بيظهروا … انا محتاج اللي فيه قبول ورفض وربط وتعديل، محتاجين نثبت الشكل» (12 Nov 2026): a request is drawn as
 * a waiting payment is — the same cells, the same four actions, under the same rule (whoever accepts a payment outright accepts
 * this one; everybody else ties it to its transfer; api/lib/paymentApprovalPolicy.js). The dialogs are drawn outside the table.
 */
export function useClientRequests({ enabled, notify, titleOf, onChanged, canAcceptDirectly, paymentBoxes }: {
  enabled: boolean; notify: Notify; titleOf: (courseId: string | null, bundleId: string | null) => string; onChanged?: () => void;
  canAcceptDirectly: boolean; paymentBoxes: string[];
}): { count: number; rows: ReactNode; dialog: ReactNode } {
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [target, setTarget] = useState<BookingRequest | null>(null);
  const [editing, setEditing] = useState<{ row: BookingRequest; draft: EditDraft } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) { setRequests([]); return; }
    try {
      const rows = await mysqlAdmin.adminGet<BookingRequest[]>('/admin/subscriber-requests?status=pending');
      setRequests(Array.isArray(rows) ? rows : []);
    } catch { setRequests([]); }
  }, [enabled]);
  useEffect(() => { void load(); }, [load]);

  const approve = async (row: BookingRequest, link: TransferLink | null) => {
    setBusy(true);
    try {
      await mysqlAdmin.adminPost(`/admin/subscriber-requests/${encodeURIComponent(row.id)}/approve`, { transfer: link });
      notify('success', `✅ اتعتمد ${row.name} واتضاف للعملاء`);
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

  const startEdit = (row: BookingRequest) => setEditing({
    row,
    draft: {
      amount: String(row.amount), paymentMethod: row.payment.paymentMethod || '', transactionId: row.payment.transactionId || '',
      senderName: row.payment.senderName || '', fromAccountNumber: row.payment.fromAccountNumber || '',
      date: row.payment.date ? cairoDateOnly(row.payment.date) : '', note: row.payment.note || '',
    },
  });
  const saveEdit = async () => {
    if (!editing) return;
    if (!(Number(editing.draft.amount) > 0)) { notify('error', 'اكتب المبلغ'); return; }
    setBusy(true);
    try {
      await mysqlAdmin.adminPatch(`/admin/subscriber-requests/${encodeURIComponent(editing.row.id)}`, { ...editing.draft, amount: Number(editing.draft.amount) });
      notify('success', 'اتعدّل الحجز');
      setEditing(null);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر التعديل');
    } finally { setBusy(false); }
  };
  const editDraft = (patch: Partial<EditDraft>) => setEditing(current => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));

  const rows = requests.map(row => {
    const branchKey = normalizeBranch(String(row.branch || '').replace(/^branch-/i, '').replace(/-/g, '_'));
    return (
      <tr key={`request-${row.id}`} className="border-b border-gray-100 bg-amber-50/40 transition-colors hover:bg-amber-50/70">
        <td className="px-3 py-2.5 font-mono text-gray-400 border-l border-gray-100 whitespace-nowrap"><span className="text-[9px]">#{row.id.slice(-6)}</span></td>
        <td className="px-3 py-2.5 border-l border-gray-100">
          <span className="text-gray-800 font-semibold text-[11px]">{row.name || '—'}</span>
          {row.phone && <div className="text-[10px] text-gray-400" dir="ltr">{row.phone}</div>}
        </td>
        <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] whitespace-nowrap">
          <span className="rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{branchKey ? BRANCH_LABELS_AR[branchKey] : '—'}</span>
        </td>
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
          <div className="flex flex-col items-center gap-1">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${row.payment.bundleId ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.payment.bundleId ? 'مسار' : 'كورس'}</span>
            <ClientAgeBadge isNew />
          </div>
        </td>
        <td className="px-3 py-2.5 border-l border-gray-100 text-center">
          <span className="font-extrabold text-emerald-700 text-[12px]">{Number(row.amount).toLocaleString('ar-EG-u-nu-latn')}</span>
          <span className="text-[9px] text-gray-400 mr-0.5">{row.currency || 'EGP'}</span>
        </td>
        <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-600">{paymentMethodLabel(row.payment.paymentMethod) || 'بدون وسيلة'}</td>
        <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500">{row.requestedByName || '—'}</td>
        <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[11px] font-bold text-gray-800 whitespace-nowrap" dir="ltr">{cairoStamp(row.createdAt) || row.createdAt || '—'}</td>
        <td className="px-3 py-2.5 border-l border-gray-100 text-center">
          <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">⏳ انتظار</span>
        </td>
        <td className="px-3 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1">
            {/* Whoever accepts a payment outright accepts this one; cash has no transfer to tie it to. Everybody else has «ربط». */}
            {(canAcceptDirectly || isCashBox(row.payment.paymentMethod || '')) && (
              <button type="button" disabled={busy} onClick={() => void approve(row, null)}
                className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded-lg font-bold transition disabled:opacity-50">✓ قبول</button>
            )}
            <button type="button" onClick={() => void reject(row)}
              className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold transition">✕ رفض</button>
            <button type="button" onClick={() => setTarget(row)} title="ربط بتحويل وتأكيد"
              className="text-[10px] bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded-lg font-bold transition">🔗 ربط</button>
            <button type="button" onClick={() => startEdit(row)} title="تعديل الحجز" aria-label="تعديل الحجز"
              className="text-indigo-400 hover:text-indigo-600 p-1 rounded-md hover:bg-indigo-50 transition"><Pencil size={11} /></button>
          </div>
        </td>
      </tr>
    );
  });

  const dialog = (
    <>
      {target && (
        <LinkTransferDialog
          title={`${target.name} — عميل جديد`}
          customerName={target.name}
          amount={target.amount}
          currency={target.currency}
          method={target.payment.paymentMethod}
          reference={target.payment.transactionId}
          date={target.payment.date}
          busy={busy}
          onConfirm={link => void approve(target, link)}
          onClose={() => setTarget(null)}
        />
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`تعديل حجز ${editing.row.name}`}>
          <div className="space-y-3" dir="rtl">
            <p className="text-xs text-gray-500">بيتعدّل المبلغ وبيانات التحويل بس. العميل والكورس زي ما اتبعتوا؛ لو غلط ارفض الحجز وخلّي المسئول يبعته تاني.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-bold text-gray-600">المبلغ ({editing.row.currency || 'EGP'})
                <input type="number" min={1} step="0.01" dir="ltr" className={`${field} mt-1`} value={editing.draft.amount} onChange={event => editDraft({ amount: event.target.value })} />
              </label>
              <label className="text-xs font-bold text-gray-600">تاريخ الدفعة
                <input type="date" max={cairoDateOnly(new Date())} className={`${field} mt-1`} value={editing.draft.date} onChange={event => editDraft({ date: event.target.value })} />
              </label>
              <label className="text-xs font-bold text-gray-600">وسيلة الدفع
                <select className={`${field} mt-1`} value={editing.draft.paymentMethod} onChange={event => editDraft({ paymentMethod: event.target.value })}>
                  <option value="">بدون وسيلة</option>
                  {[...new Set([editing.draft.paymentMethod, ...paymentBoxes].filter(Boolean))].map(method => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">رقم العملية
                <input dir="ltr" className={`${field} mt-1`} value={editing.draft.transactionId} onChange={event => editDraft({ transactionId: event.target.value })} />
              </label>
              <label className="text-xs font-bold text-gray-600">اسم المحوِّل
                <input className={`${field} mt-1`} value={editing.draft.senderName} onChange={event => editDraft({ senderName: event.target.value })} />
              </label>
              <label className="text-xs font-bold text-gray-600">رقم المحوِّل
                <input dir="ltr" className={`${field} mt-1`} value={editing.draft.fromAccountNumber} onChange={event => editDraft({ fromAccountNumber: event.target.value })} />
              </label>
            </div>
            <label className="block text-xs font-bold text-gray-600">ملاحظة
              <input className={`${field} mt-1`} value={editing.draft.note} onChange={event => editDraft({ note: event.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-700">إلغاء</button>
              <button type="button" disabled={busy} onClick={() => void saveEdit()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'بيحفظ…' : 'حفظ'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );

  return { count: requests.length, rows, dialog };
}

/** «عميل جديد» / «عميل قديم» beside the kind of payment: new on a row when the client had paid for nothing before that row's day. */
export function ClientAgeBadge({ isNew }: { isNew: boolean | null | undefined }) {
  if (isNew == null) return null;
  return isNew
    ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">عميل جديد</span>
    : <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">عميل قديم</span>;
}
