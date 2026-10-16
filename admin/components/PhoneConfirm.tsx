import React, { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { latinDigits } from '../../shared/latinDigits';
import { arabicReason } from '../lib/apiErrorText';
import { mysqlAdmin } from '../lib/mysqlapi';

// «أكّدت رقم التليفون مع العميل … محتاجين يبقى فى امكانية تعديل الرقم او اضافة رقم اخر».
// The confirmation line of a booking, with the two things a desk needs when the client
// says «الرقم ده غلط» or «كلمنى على رقم تانى»: change the number, add a second one.
// A new client's numbers ride in the draft (the server refuses a number another client
// holds); an existing client's are saved at once, with the same refusal.

interface Props {
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  phone: string;
  phone2: string;
  /** Existing client: save here. Without it the numbers are the draft's own. */
  saveFor?: { id: string; name: string };
  onChange: (phone: string, phone2: string) => void;
}

export const PhoneConfirm: React.FC<Props> = ({ confirmed, onConfirmed, phone, phone2, saveFor, onChange }) => {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(phone);
  const [second, setSecond] = useState(phone2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = async () => {
    const a = latinDigits(first).trim();
    const b = latinDigits(second).trim();
    if (!a) { setError('اكتب رقم التليفون'); return; }
    setError('');
    if (saveFor) {
      setBusy(true);
      try {
        await mysqlAdmin.saveSubscriber({ id: saveFor.id, name: saveFor.name, phone: a, phone2: b, changedFields: ['phone', 'phone2'] });
      } catch (e) {
        setError(arabicReason(e) || 'تعذر حفظ الرقم');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    onChange(a, b);
    onConfirmed(false);
    setOpen(false);
  };

  return (
    <div className={`rounded-xl border-2 px-3 py-2 ${confirmed ? 'border-emerald-300 bg-white' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <input type="checkbox" checked={confirmed} onChange={e => onConfirmed(e.target.checked)} className="h-4 w-4" />
          <span className="text-xs font-bold text-gray-700">
            أكّدت رقم التليفون مع العميل
            <span dir="ltr" className="mr-1 font-mono text-gray-900">{phone || '—'}</span>
            {phone2 && <span dir="ltr" className="mr-1 font-mono text-gray-600">/ {phone2}</span>}
          </span>
        </label>
        <button type="button" onClick={() => { setFirst(phone); setSecond(phone2); setOpen(o => !o); }}
          className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-50">
          {phone2 ? <Pencil size={12} /> : <Plus size={12} />} {phone2 ? 'تعديل الأرقام' : 'تعديل / رقم تاني'}
        </button>
      </div>
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-600">الرقم الأساسي</span>
            <input type="tel" dir="ltr" inputMode="tel" value={first} onChange={e => setFirst(latinDigits(e.target.value))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-600">رقم تاني (اختياري)</span>
            <input type="tel" dir="ltr" inputMode="tel" value={second} onChange={e => setSecond(latinDigits(e.target.value))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-sm" />
          </label>
          {error && <p className="text-[11px] font-bold text-red-600 sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy} onClick={apply}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'جارى الحفظ…' : saveFor ? 'حفظ الأرقام' : 'تمام'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
};
