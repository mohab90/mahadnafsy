import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Link2, Search } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly, cairoDay } from '../../../../../shared/cairoDate';
import { isCashBox } from '../../../../../shared/paymentMethods';
import { foldText } from '../../../../../shared/sheetImport';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { toEgp } from '../../../../lib/money';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

/** One row of the ledger, GET /api/admin/incoming-transfers (api/routes/core/financepay.js). */
export type IncomingTransfer = {
  id: string; amount: number; currency: string; method: string; reference: string | null;
  senderName: string | null; senderPhone: string | null; receivedOn: string; note: string | null;
  recordedByName: string | null; paymentId: string | null; customerName: string | null; createdAt: string;
};

/**
 * «التحويلات» in الحسابات reads the ledger of money that arrived. It used to
 * write each transfer as an order with type='transfer' — a type the orders
 * table cannot hold — so none was ever saved and «🔗 ربط» could never succeed.
 */
export function useIncomingTransfers(enabled: boolean) {
  const [transfers, setTransfers] = useState<IncomingTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<IncomingTransfer[]>('/admin/incoming-transfers');
      setTransfers(Array.isArray(rows) ? rows : []);
    } catch { setTransfers([]); } finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { transfers, loading, reload };
}

export function IncomingTransfersTable({ transfers, loading, canLink, onLink, onAdd }: {
  transfers: IncomingTransfer[]; loading: boolean; canLink: boolean;
  onLink: (transfer: IncomingTransfer) => void; onAdd: () => void;
}) {
  const linked = transfers.filter(transfer => transfer.paymentId);
  const totalEgp = transfers.reduce((sum, transfer) => sum + toEgp(transfer.amount, transfer.currency), 0);
  const cell = 'px-3 py-2.5 border-l border-gray-100';
  // A month of the accounts team's sheet is hundreds of rows: find one by its
  // number, who sent it, the customer the sheet names, or the amount.
  const [query, setQuery] = useState('');
  const [box, setBox] = useState('');
  const [state, setState] = useState<'' | 'free' | 'linked'>('');
  const boxes = useMemo(() => [...new Set(transfers.map(transfer => transfer.method))], [transfers]);
  const shown = useMemo(() => {
    const words = foldText(query).split(' ').filter(Boolean);
    return transfers.filter(transfer => {
      if (box && transfer.method !== box) return false;
      if (state === 'free' && transfer.paymentId) return false;
      if (state === 'linked' && !transfer.paymentId) return false;
      if (!words.length) return true;
      const text = foldText([transfer.reference, transfer.senderName, transfer.senderPhone, transfer.note, transfer.customerName, transfer.amount].join(' '));
      return words.every(word => text.includes(word));
    });
  }, [transfers, query, box, state]);
  const field = 'rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'إجمالي التحويلات', value: transfers.length, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'مربوطة بدفعة', value: linked.length, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
          { label: 'متاحة للربط', value: transfers.length - linked.length, cls: 'bg-amber-50 border-amber-200 text-amber-700' },
          { label: 'إجمالي الوارد', value: `${Math.round(totalEgp).toLocaleString('ar-EG-u-nu-latn')} ج`, cls: 'bg-violet-50 border-violet-200 text-violet-700' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border px-3 py-3 ${card.cls}`}>
            <div className="mb-1 text-[10px] font-semibold">{card.label}</div>
            <div className="text-xl font-extrabold">{card.value}</div>
          </div>
        ))}
      </div>
      {transfers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="رقم العملية، المحوِّل، اسم العميل، المبلغ…"
              className={`${field} w-full pr-7`} />
          </div>
          <select value={box} onChange={event => setBox(event.target.value)} className={field}>
            <option value="">كل الحسابات</option>
            {boxes.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={state} onChange={event => setState(event.target.value as typeof state)} className={field}>
            <option value="">الكل</option><option value="free">متاح للربط</option><option value="linked">مربوط</option>
          </select>
          <span className="text-[11px] text-gray-500">{shown.length} تحويل{shown.length > 500 ? ' (أول 500 معروضين)' : ''}</span>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gradient-to-l from-blue-50 to-white text-gray-700">
                {['رقم العملية', 'المُحوِّل', 'المبلغ', 'وصل على', 'ملاحظة', 'المُسجِّل', 'تاريخ الوصول', 'الحالة', 'إجراءات'].map(title => (
                  <th key={title} className="border-l border-gray-100 px-3 py-3 text-right font-bold">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 500).map(transfer => (
                <tr key={transfer.id} className={`border-b border-gray-100 transition-colors ${transfer.paymentId ? 'hover:bg-emerald-50/30' : 'bg-amber-50/30 hover:bg-amber-50/60'}`}>
                  <td className={`${cell} font-mono text-[10px] text-blue-600`} dir="ltr">#{transfer.reference || '—'}</td>
                  <td className={cell}>
                    <div className="text-[11px] font-semibold text-gray-800">{transfer.senderName || '—'}</div>
                    {transfer.senderPhone && <div className="font-mono text-[9px] text-gray-400" dir="ltr">{transfer.senderPhone}</div>}
                  </td>
                  <td className={`${cell} text-center`}>
                    <span className="text-[12px] font-extrabold text-blue-700">{Number(transfer.amount).toLocaleString('ar-EG-u-nu-latn')}</span>
                    <span className="mr-0.5 text-[9px] text-gray-400">{transfer.currency}</span>
                  </td>
                  <td className={`${cell} text-[11px] text-gray-700`}>{transfer.method}</td>
                  <td className={`${cell} max-w-[180px]`}><span className="line-clamp-2 text-[10px] text-gray-600">{transfer.note || '—'}</span></td>
                  <td className={`${cell} text-center text-[10px] text-gray-500`}>{transfer.recordedByName || '—'}</td>
                  <td className={`${cell} whitespace-nowrap text-center text-[10px] text-gray-500`}>{cairoDay(transfer.receivedOn)}</td>
                  <td className={`${cell} text-center`}>
                    {transfer.paymentId
                      ? <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✓ مربوط{transfer.customerName ? ` · ${transfer.customerName}` : ''}</span>
                      : <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">متاح للربط</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {canLink && !transfer.paymentId && (
                      <button type="button" onClick={() => onLink(transfer)} title="ربط بدفعة عميل"
                        className="rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-violet-700">🔗 ربط</button>
                    )}
                  </td>
                </tr>
              ))}
              {transfers.length > 0 && shown.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-xs text-gray-400">مفيش تحويل بالبحث ده</td></tr>
              )}
              {transfers.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <ArrowUpRight size={28} className="text-gray-200" />
                      <span className="text-sm">{loading ? 'جاري التحميل…' : 'لا توجد تحويلات مسجّلة بعد'}</span>
                      {!loading && (
                        <button type="button" onClick={onAdd} className="mt-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700">+ إضافة أول تحويل</button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * «إضافة تحويل» — money that arrived, before (or without) the payment it
 * confirms. The operation number is required: it is what stops the same
 * transfer being counted twice on one box.
 */
export function AddTransferModal({ boxes: allBoxes, notify, onClose, onSaved }: {
  boxes: string[]; notify: Notify; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  // Cash is counted in a box, not transferred: it has no operation number.
  const boxes = allBoxes.filter(box => !isCashBox(box));
  const [form, setForm] = useState({
    amount: '', currency: 'EGP', method: boxes[0] || '', reference: '', senderName: '', senderPhone: '', note: '', receivedOn: cairoDateOnly(),
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';
  const label = 'mb-1 block text-xs font-semibold text-gray-700';
  const ready = Number(form.amount) > 0 && !!form.method && !!form.reference.trim();

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/incoming-transfers', { ...form, amount: Number(form.amount) });
      notify('success', `تم تسجيل التحويل (${Number(form.amount).toLocaleString('ar-EG-u-nu-latn')} ${form.currency}) ✓`);
      await onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ التحويل');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm" title="إضافة تحويل وارد" icon={<ArrowUpRight size={16} />}
      subtitle="اللي وصل على حساب من حسابات المعهد — تربطه بدفعة العميل بعدين">
      <div className="space-y-3 text-sm" dir="rtl">
        <div className="flex gap-2">
          <div className="flex-1"><label className={label}>المبلغ *</label>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={e => set({ amount: e.target.value })} placeholder="0.00" className={field} /></div>
          <div className="w-24"><label className={label}>العملة</label>
            <select value={form.currency} onChange={e => set({ currency: e.target.value })} className={field}>
              <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
            </select></div>
        </div>
        <div><label className={label}>وصل على * <span className="text-[10px] font-normal text-blue-500">(من إعدادات الحسابات)</span></label>
          <select value={form.method} onChange={e => set({ method: e.target.value })} className={field}>
            {boxes.map(box => <option key={box} value={box}>{box}</option>)}
          </select></div>
        <div><label className={label}>رقم العملية *</label>
          <input value={form.reference} onChange={e => set({ reference: e.target.value })} dir="ltr" placeholder="مثال: 123456789" className={`${field} font-mono`} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>اسم المُحوِّل</label><input value={form.senderName} onChange={e => set({ senderName: e.target.value })} className={field} /></div>
          <div><label className={label}>رقم المُحوِّل</label><input type="tel" value={form.senderPhone} onChange={e => set({ senderPhone: e.target.value })} dir="ltr" className={`${field} font-mono`} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>تاريخ الوصول</label><input type="date" value={form.receivedOn} onChange={e => set({ receivedOn: e.target.value })} className={field} /></div>
          <div><label className={label}>ملاحظة</label><input value={form.note} onChange={e => set({ note: e.target.value })} className={field} /></div>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">إلغاء</button>
          <button type="button" disabled={!ready || saving} onClick={() => { void save(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">
            <Link2 size={14} /> {saving ? 'جارٍ الحفظ…' : 'حفظ التحويل'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
