import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Link2 } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly, cairoDay } from '../../../../../shared/cairoDate';
import { isCashBox } from '../../../../../shared/paymentMethods';
import { foldText } from '../../../../../shared/sheetImport';
import { transferMatch } from '../../../../../shared/transferSheet';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { usePaymentBoxes } from '../../../../lib/paymentMethods';
import { useStaticData } from '../../../../context/siteDataSlices';

export type TransferLink =
  | { transferId: string }
  | { amount: number; currency: string; method: string; reference: string; receivedOn: string; senderName?: string; senderPhone?: string; note?: string };

type LedgerTransfer = {
  id: string; amount: number; currency: string; method: string; reference: string | null;
  senderName: string | null; senderPhone: string | null; note: string | null; receivedOn: string; createdAt: string;
};

/**
 * «ربطه بتحويل» — the transfer that brought this money: one the manager has
 * already put on the ledger, or the one they are looking at in the wallet now
 * (recorded as it is linked). The server refuses a transfer that already
 * confirmed another payment, and an operation number used twice on one box.
 */
export function LinkTransferDialog({ title, customerName, amount, currency, method, reference, date, busy, onConfirm, onClose }: {
  title: string; customerName?: string | null; amount: number; currency: string; method?: string | null; reference?: string | null; date?: string | null;
  busy: boolean; onConfirm: (link: TransferLink | null) => void; onClose: () => void;
}) {
  const { content } = useStaticData();
  const boxes = usePaymentBoxes(content['finance.payment_methods']);
  const [mode, setMode] = useState<'new' | 'ledger'>('new');
  const [ledger, setLedger] = useState<LedgerTransfer[]>([]);
  const [picked, setPicked] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({
    amount: String(amount || ''), currency: currency || 'EGP', method: method || '', reference: reference || '',
    receivedOn: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : cairoDateOnly(), senderName: '', senderPhone: '', note: '',
  });

  useEffect(() => {
    mysqlAdmin.adminGet<LedgerTransfer[]>('/admin/incoming-transfers?unlinked=1')
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setLedger(list);
        if (list.length) setMode('ledger');
        // The payment's own operation number on the ledger is the one.
        const typed = String(reference || '').replace(/\s+/g, '');
        const same = typed ? list.find(transfer => transfer.reference === typed) : undefined;
        if (same) setPicked(same.id);
      })
      .catch(() => setLedger([]));
  }, [reference]);

  // The likeliest first — its operation number, the amount, the customer the
  // accounts sheet names, the box, the day — and the person's search over the rest.
  const sorted = useMemo(() => {
    const words = foldText(query).split(' ').filter(Boolean);
    const payment = { amount, currency, method, reference, customerName, date };
    return ledger
      .filter(transfer => !words.length || words.every(word => foldText([transfer.reference, transfer.senderName, transfer.senderPhone, transfer.note, transfer.amount].join(' ')).includes(word)))
      .map(transfer => ({ transfer, ...transferMatch(payment, transfer) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }, [ledger, query, amount, currency, method, reference, customerName, date]);
  const cash = isCashBox(method);
  const ready = mode === 'ledger' ? !!picked
    : Number(draft.amount) > 0 && !!draft.method.trim() && !!draft.reference.trim();

  return (
    <Modal open onClose={onClose} size="sm" title="ربط بتحويل واعتماد" icon={<Link2 size={16} />} subtitle={title}>
      <div className="space-y-3 text-sm">
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
          {([['ledger', `تحويل متسجل (${ledger.length})`], ['new', 'تحويل وصل دلوقتي']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setMode(key)}
              className={`flex-1 rounded-lg px-3 py-1.5 transition ${mode === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
          ))}
        </div>

        {mode === 'ledger' ? (
          ledger.length === 0 ? (
            <p className="rounded-xl bg-gray-50 py-6 text-center text-xs text-gray-400">مفيش تحويلات متسجلة لسه — سجّل اللي وصل من «تحويل وصل دلوقتي».</p>
          ) : (
            <div className="space-y-1.5">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="بحث برقم العملية أو المحوِّل أو الاسم أو المبلغ…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200" />
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {sorted.length === 0 && <p className="py-4 text-center text-xs text-gray-400">مفيش تحويل بالبحث ده</p>}
              {sorted.map(({ transfer, reasons }) => (
                <label key={transfer.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition ${picked === transfer.id ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300'}`}>
                  <input type="radio" name="transfer" checked={picked === transfer.id} onChange={() => setPicked(transfer.id)} className="accent-violet-600" />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-gray-800">{Number(transfer.amount).toLocaleString('ar-EG-u-nu-latn')} {transfer.currency} · {transfer.method}</div>
                    <div className="truncate text-[11px] text-gray-500" dir="ltr">#{transfer.reference || '—'} · {cairoDay(transfer.receivedOn)}{transfer.senderName || transfer.senderPhone ? ` · ${transfer.senderName || transfer.senderPhone}` : ''}</div>
                    {transfer.note && <div className="truncate text-[10px] text-gray-400">{transfer.note}</div>}
                  </div>
                  {reasons.length > 0 && (
                    <div className="flex flex-col items-end gap-0.5">
                      {reasons.map(reason => <span key={reason} className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{reason}</span>)}
                    </div>
                  )}
                </label>
              ))}
            </div>
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">المبلغ اللي وصل</span>
              <input type="number" dir="ltr" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2" /></label>
            <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">العملة</span>
              <select value={draft.currency} onChange={e => setDraft(d => ({ ...d, currency: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2">
                {['EGP', 'SAR', 'USD'].map(code => <option key={code} value={code}>{code}</option>)}
              </select></label>
            <label className="col-span-2 block"><span className="mb-1 block text-xs font-bold text-gray-600">وصل على حساب</span>
              <select value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2">
                <option value="">اختار…</option>
                {[...new Set([...(method ? [method] : []), ...boxes])].map(box => <option key={box} value={box}>{box}</option>)}
              </select></label>
            <label className="col-span-2 block"><span className="mb-1 block text-xs font-bold text-gray-600">رقم العملية</span>
              <input dir="ltr" value={draft.reference} onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 font-mono" /></label>
            <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">تاريخ الوصول</span>
              <input type="date" value={draft.receivedOn} onChange={e => setDraft(d => ({ ...d, receivedOn: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2" /></label>
            <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">اسم المحوِّل</span>
              <input value={draft.senderName} onChange={e => setDraft(d => ({ ...d, senderName: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2" /></label>
            {Number(draft.amount) > 0 && Number(draft.amount) !== amount && (
              <p className="col-span-2 flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                <ArrowLeftRight size={12} /> المبلغ اللي وصل غير الدفعة ({amount.toLocaleString('ar-EG-u-nu-latn')} {currency}) — اتأكد قبل الاعتماد.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={busy || !ready}
            onClick={() => onConfirm(mode === 'ledger'
              ? { transferId: picked }
              : { ...draft, amount: Number(draft.amount), senderName: draft.senderName || undefined, senderPhone: draft.senderPhone || undefined, note: draft.note || undefined })}
            className="flex-1 rounded-xl bg-violet-600 py-2.5 font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            {busy ? 'جارٍ الاعتماد…' : 'ربط واعتماد'}
          </button>
          {cash && (
            <button type="button" disabled={busy} onClick={() => onConfirm(null)}
              className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">اعتماد نقدي بدون تحويل</button>
          )}
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-100 px-4 py-2.5 font-bold text-gray-600 hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}
