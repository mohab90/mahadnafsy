import { BookOpen, CreditCard, ExternalLink, MessageSquare, Phone, Trash2, UserPlus } from 'lucide-react';
import { cairoDay } from '../../../../../shared/cairoDate';

export type ClientDbCardRow = {
  id: string;
  clientCode: string;
  name: string;
  phone: string;
  email: string;
  createdAt: string;
  totalPaid: number;
  courseNames: string;
};

const round = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-gray-50 text-gray-500 transition hover:bg-white hover:shadow-sm active:scale-95 disabled:opacity-50';

/**
 * One person of «قاعدة العملاء» as a quiet card on a phone: who, what they are, what they paid, and the icons.
 * The table above 768 px is unchanged; stacked by the generic table rule each row was a 470 px card of ten
 * label/value lines, so thirty people were fourteen thousand pixels of scrolling. The handlers are the table's.
 */
export function ClientDbCard({
  row, selected, onToggle, typeLabel, typeColor, branch, wa, isRegistration, canArchive, busy,
  onOpen, onConvert, onBook, onArchive,
}: {
  row: ClientDbCardRow;
  selected: boolean;
  onToggle: () => void;
  typeLabel: string;
  typeColor: string;
  branch: string;
  /** The wa.me address, or null for a number WhatsApp cannot take. */
  wa: string | null;
  isRegistration: boolean;
  canArchive: boolean;
  busy: boolean;
  onOpen: () => void;
  onConvert: () => void;
  onBook: () => void;
  onArchive: () => void;
}) {
  const email = row.email && !row.email.endsWith('@lead.local') ? row.email : '';
  const facts = [branch, row.createdAt ? cairoDay(row.createdAt) : ''].filter(Boolean).join(' · ');
  return (
    <article className={`overflow-hidden rounded-xl border border-gray-100 border-r-4 ${selected ? 'border-r-indigo-400 bg-indigo-50/40' : 'border-r-gray-200 bg-white'} shadow-[0_1px_2px_rgb(0_0_0/0.04)]`} dir="rtl">
      <header className="flex items-start gap-2 px-3 pt-2.5">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label="تحديد العميل" className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-indigo-600" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={isRegistration ? undefined : onOpen} className="line-clamp-2 text-right text-[13px] font-bold leading-snug text-indigo-700 [overflow-wrap:anywhere]">
            {row.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
            <span className="tabular-nums" dir="ltr">{row.phone || '—'}</span>
            <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${typeColor}`}>{typeLabel}</span>
            {row.clientCode && <span className="rounded bg-indigo-50 px-1 font-mono text-[10px] text-indigo-500">#{row.clientCode}</span>}
          </div>
        </div>
      </header>

      <div className="mt-1.5 space-y-0.5 px-3 text-[11px] text-gray-500">
        {facts && <p className="truncate" title={facts}>{facts}</p>}
        {email && <p className="truncate text-gray-400" title={email}>{email}</p>}
        {row.courseNames && <p className="flex items-center gap-1 truncate text-gray-400" title={row.courseNames}><BookOpen size={11} className="shrink-0" /> <span className="truncate">{row.courseNames}</span></p>}
        {row.totalPaid > 0 && <p>مدفوع <b className="text-emerald-700">{row.totalPaid.toLocaleString('ar-EG-u-nu-latn')} ج</b></p>}
      </div>

      <footer className="mt-2 flex items-center justify-between gap-1 border-t border-gray-50 px-2 py-2">
        {row.phone ? <a href={`tel:${row.phone}`} title="اتصال" aria-label="اتصال" className={`${round} hover:text-sky-600`}><Phone size={16} /></a> : <span aria-label="مفيش رقم" className={`${round} opacity-40`}><Phone size={16} /></span>}
        {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" title="واتس أب" aria-label="واتس أب" className={`${round} hover:text-emerald-600`}><MessageSquare size={16} /></a> : <span aria-label="الرقم غير صالح للواتساب" className={`${round} opacity-40`}><MessageSquare size={16} /></span>}
        {isRegistration
          ? <button type="button" onClick={onConvert} disabled={busy} title="تحويل لعميل محتمل" aria-label="تحويل لعميل محتمل" className={`${round} text-amber-600`}><UserPlus size={16} /></button>
          : <button type="button" onClick={onOpen} title="فتح ملف العميل" aria-label="فتح ملف العميل" className={`${round} hover:text-indigo-600`}><ExternalLink size={16} /></button>}
        <button type="button" onClick={onBook} title="حجز / دفعة" aria-label="حجز / دفعة" className={`${round} hover:text-emerald-600`}><CreditCard size={16} /></button>
        {canArchive && !isRegistration && <button type="button" onClick={onArchive} disabled={busy} title="حذف (أرشفة)" aria-label="حذف (أرشفة)" className={`${round} hover:text-rose-600`}><Trash2 size={16} /></button>}
      </footer>
    </article>
  );
}
