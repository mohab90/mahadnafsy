import { useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Account = { code: string; name: string; type: string; is_active: number | boolean };
type Partner = { key: string; name: string };

/**
 * «سحب من الرصيد» — money out of one box, and where it went (the accounting direction): a partner's personal drawing, an expense, any
 * account of the chart, or a transfer to another box. api/lib/boxWithdrawals.js posts one entry (the account against cash 1100); a
 * transfer posts nothing. A withdrawal larger than the box asks to be confirmed.
 */
export function BoxWithdrawDialog({ box, currency, balance, boxes, partners, onClose, onDone }: {
  box: string; currency: string; balance: number; boxes: string[]; partners: Partner[]; onClose: () => void; onDone: () => void;
}) {
  const [direction, setDirection] = useState<string>(partners[0] ? `partner:${partners[0].key}` : 'expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(cairoDateOnly());
  const [accountCode, setAccountCode] = useState('');
  const [toMethod, setToMethod] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);

  useEffect(() => {
    mysqlAdmin.adminGet<Account[]>('/admin/accounting/chart-of-accounts').then(list => setAccounts(list.filter(account => account.is_active)), () => setAccounts([]));
  }, []);

  const kind = direction.startsWith('partner:') ? 'partner' : direction;
  const value = Number(String(amount).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[,،\s]/g, ''));
  const pool = kind === 'expense' ? accounts.filter(account => account.type === 'expense') : accounts.filter(account => account.code !== '1100');
  const ready = value > 0 && (kind !== 'expense' && kind !== 'other' ? true : Boolean(accountCode)) && (kind !== 'transfer' || Boolean(toMethod));

  const submit = async (force = false) => {
    setBusy(true);
    setError('');
    try {
      await mysqlAdmin.adminPost('/admin/finance/boxes/withdraw', {
        method: box, currency, amount: value, kind, date, note, force,
        ...(kind === 'partner' ? { partner: direction.slice('partner:'.length) } : {}),
        ...(kind === 'expense' || kind === 'other' ? { accountCode } : {}),
        ...(kind === 'transfer' ? { toMethod } : {}),
      });
      onDone();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر السحب';
      if (/الرصيد/.test(message) && /أقل من/.test(message)) setNeedsConfirm(true);
      setError(message);
    } finally { setBusy(false); }
  };

  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm';
  return (
    <Modal open onClose={onClose} size="md" title="سحب من الرصيد" subtitle={`${box} — الرصيد ${balance.toLocaleString('ar-EG-u-nu-latn')} ${currency === 'EGP' ? 'ج.م' : currency}`} icon={<Wallet size={16} />}>
      <div className="space-y-3 text-sm" dir="rtl">
        <label className="block text-xs font-bold text-gray-600">التوجيه المحاسبي (السحب ده رايح فين؟)
          <select value={direction} onChange={event => { setDirection(event.target.value); setAccountCode(''); setNeedsConfirm(false); }} className={`${field} mt-1 bg-white`}>
            {partners.map(partner => <option key={partner.key} value={`partner:${partner.key}`}>سحب شخصي — {partner.name}</option>)}
            <option value="expense">مصروف</option>
            <option value="transfer">تحويل لخزنة تانية</option>
            <option value="other">حساب آخر من دليل الحسابات</option>
          </select>
        </label>
        {(kind === 'expense' || kind === 'other') && (
          <label className="block text-xs font-bold text-gray-600">{kind === 'expense' ? 'حساب المصروف' : 'الحساب'}
            <select value={accountCode} onChange={event => setAccountCode(event.target.value)} className={`${field} mt-1 bg-white`}>
              <option value="">— اختار الحساب —</option>
              {pool.map(account => <option key={account.code} value={account.code}>{account.code} — {account.name}</option>)}
            </select>
          </label>
        )}
        {kind === 'transfer' && (
          <label className="block text-xs font-bold text-gray-600">الخزنة اللي هتدخلها الفلوس
            <select value={toMethod} onChange={event => setToMethod(event.target.value)} className={`${field} mt-1 bg-white`}>
              <option value="">— اختار الخزنة —</option>
              {boxes.filter(name => name !== box).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        {kind === 'partner' && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">بيتسجل قيد: مدين «مسحوبات شخصية» الشريك / دائن نقدية وبنوك (1100).</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-bold text-gray-600">المبلغ ({currency === 'EGP' ? 'ج.م' : currency})
            <input value={amount} onChange={event => { setAmount(event.target.value); setNeedsConfirm(false); }} inputMode="decimal" dir="ltr" className={`${field} mt-1 font-mono`} />
          </label>
          <label className="block text-xs font-bold text-gray-600">التاريخ
            <input type="date" value={date} onChange={event => setDate(event.target.value)} className={`${field} mt-1`} />
          </label>
        </div>
        <label className="block text-xs font-bold text-gray-600">ملاحظة (اختياري)
          <input value={note} onChange={event => setNote(event.target.value)} className={`${field} mt-1`} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={busy || !ready} onClick={() => void submit(needsConfirm)}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            {busy && <Loader2 size={12} className="animate-spin" />}{needsConfirm ? 'أكّد السحب برضه' : 'سجّل السحب'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-xs text-gray-600">إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}
