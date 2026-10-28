import { useEffect, useState } from 'react';
import { Link2, UserRound } from 'lucide-react';
import { mysqlAdmin } from '../lib/mysqlapi';
import { toDialable } from '../lib/whatsappLink';

// «العميل بيجيب صاحبه ومش بيوصلنا بصاحبه وعاوزنا نتعامل معاه هو، فبيبقى نفس رقم التليفون لحسابين، واحنا
// مانعين نكرر رقم التليفون» (15 Oct 2026). A number still belongs to one client. When the number typed is
// already held, this says whose it is, with a way to open that file instead — and, when the person really
// is someone else using the same number, the account can be opened LINKED to the first: a relation and the
// reason are written on both files (api/lib/phoneDuplicates.js sharedPhoneSlot).

export type SharedPhone = { withId: string; relation: string; reason: string };
type Holder = { id: string; name: string; clientCode: string | null };

const RELATIONS: Array<[string, string]> = [['friend', 'صاحب / صاحبة'], ['relative', 'قريب / قريبة'], ['spouse', 'زوج / زوجة'], ['colleague', 'زميل / زميلة'], ['other', 'آخر']];

export function SharedPhonePanel({ phone, branch, value, onChange, onOpenHolder }: {
  phone: string;
  branch?: string;
  value?: SharedPhone | null;
  onChange: (next: SharedPhone | null) => void;
  onOpenHolder?: (holder: Holder) => void;
}) {
  const [holder, setHolder] = useState<Holder | null>(null);
  const [asking, setAsking] = useState(Boolean(value));

  // Who holds the number, a moment after typing stops.
  useEffect(() => {
    if (!toDialable(phone)) { setHolder(null); return undefined; }
    let alive = true;
    const timer = window.setTimeout(() => {
      mysqlAdmin.adminGet<{ holder: Holder | null }>(`/admin/subscribers/phone-holder?phone=${encodeURIComponent(phone)}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`)
        .then(answer => { if (alive) setHolder(answer.holder); }).catch(() => { if (alive) setHolder(null); });
    }, 450);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [phone, branch]);

  // The number changed to one nobody holds: nothing is shared any more. Keyed on the holder alone: value and onChange
  // are this render's, and re-running on them would clear a link the desk is choosing while the lookup is in flight.
  useEffect(() => { if (!holder && value) { onChange(null); setAsking(false); } }, [holder]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!holder) return null;
  const who = `${holder.name || 'عميل'}${holder.clientCode ? ` (${holder.clientCode})` : ''}`;
  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-xs">
      <p className="font-bold text-amber-900">⚠️ الرقم ده متسجّل قبل كده للعميل {who}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onOpenHolder && (
          <button type="button" onClick={() => onOpenHolder(holder)} className="inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold text-amber-900 hover:bg-amber-100">
            <UserRound size={13} /> افتح ملفه
          </button>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-1.5 font-bold text-sky-900">
          <input type="checkbox" checked={asking} className="h-4 w-4"
            onChange={event => { setAsking(event.target.checked); onChange(event.target.checked ? { withId: holder.id, relation: value?.relation || '', reason: value?.reason || '' } : null); }} />
          <Link2 size={13} /> ده شخص تاني بيستخدم نفس الرقم
        </label>
      </div>
      {asking && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block font-bold text-gray-700">صلته بصاحب الرقم
            <select value={value?.relation || ''} onChange={event => onChange({ withId: holder.id, relation: event.target.value, reason: value?.reason || '' })}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">— اختار —</option>
              {RELATIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="block font-bold text-gray-700">السبب <span className="text-red-500">*</span>
            <input value={value?.reason || ''} onChange={event => onChange({ withId: holder.id, relation: value?.relation || '', reason: event.target.value })}
              placeholder="مثلاً: صاحبه بيستخدم نفس الرقم ومش عاوز يتعامل عن طريقه"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <p className="text-[11px] text-sky-800 sm:col-span-2">بيتفتح حساب مرتبط بحساب {who}؛ الصلة والسبب بيتسجلوا في ملف الاتنين. رسائل الرقم ده بتروح للرقم نفسه.</p>
        </div>
      )}
    </div>
  );
}
