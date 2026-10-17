import React from 'react';
import { CalendarDays, MapPin, PhoneCall, UserRound } from 'lucide-react';
import type { SubscriberItem } from '../../../../types';
import { waLink } from '../../../../lib/whatsappLink';
import { WhatsAppIcon } from '../../../../components/WhatsAppIcon';

export type ClientCardAction = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'good' | 'info' | 'danger';
};

export type ClientCardCourse = { id: string; label: string; expected: number; paid: number; remaining: number; currency: string };

const TONE: Record<NonNullable<ClientCardAction['tone']>, string> = {
  default: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  info: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
  danger: 'border-rose-200 bg-white text-rose-600 hover:bg-rose-50',
};

const money = (value: number, currency: string) =>
  `${Math.round(value).toLocaleString('ar-EG-u-nu-latn')} ${currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج.م'}`;

/**
 * One client as a card — the phone's way to read the clients' table.
 *
 * «في صفحة عملاء الأونلاين وعملاء الدقي طريقة عرض أشبه بالبايبلان … وعلى الموبايل تبقى هي الأساسي» (17 Oct 2026).
 * Everything the row says is here, written out and a thumb wide: who, how to reach them (the call and WhatsApp
 * buttons open the contact log, as the table's do), what they hold and owe, the next instalment, the last
 * contact, and the actions as labelled buttons instead of twelve-pixel icons. The cells are the table's own, built
 * once in ClientsTable, so a card and its row can never disagree.
 */
export default function ClientCard({
  row, clientCode, selected, onToggle, onOpen, place, createdAt, courses, statusCell, salesCell, housingCell,
  instCell, hasInstallment, contactCell, actions, onCall, onWhats, certificates,
}: {
  row: SubscriberItem;
  clientCode: string;
  selected: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
  place: string;
  createdAt: string;
  courses: ClientCardCourse[];
  statusCell: React.ReactNode;
  salesCell: React.ReactNode;
  housingCell: React.ReactNode;
  instCell: React.ReactNode;
  hasInstallment: boolean;
  contactCell: React.ReactNode;
  actions: ClientCardAction[];
  onCall: () => void;
  onWhats: () => void;
  certificates: React.ReactNode;
}) {
  const wa = waLink(row.phone);
  const owed = courses.reduce((sum, course) => sum + Math.max(0, course.remaining), 0);
  const currency = courses[0]?.currency || 'EGP';
  const finished = row.clientStatus && row.clientStatus !== 'active';
  return (
    <article
      className={`overflow-hidden rounded-2xl border border-gray-200 border-r-[6px] bg-white shadow-sm ${selected ? 'border-r-blue-500 ring-2 ring-blue-200' : owed > 0 ? 'border-r-amber-400' : 'border-r-emerald-500'}`}
      dir="rtl" data-client={clientCode}
    >
      {/* 1. Who, and where they stand. */}
      <header className="flex items-start gap-2 px-3 pt-3">
        <input type="checkbox" checked={selected} onChange={event => onToggle(event.target.checked)} aria-label="تحديد العميل"
          className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block max-w-full text-right text-base font-black leading-tight text-gray-900 [overflow-wrap:anywhere] hover:text-primary-700">
            {row.name || 'بدون اسم'}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            {place && <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-bold text-gray-600"><MapPin size={10} /> {place}</span>}
            {createdAt && <span className="inline-flex items-center gap-1"><CalendarDays size={10} /> {createdAt}</span>}
            {finished && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">{row.clientStatus === 'finished' ? '✅ منتهي' : row.clientStatus === 'paused' ? '⏸ متوقف' : row.clientStatus === 'refunded' ? '↩️ مسترد' : row.clientStatus === 'refund_pending' ? '⏳ استرداد معلق' : row.clientStatus}</span>}
          </div>
        </div>
        <div className="w-28 shrink-0">{statusCell}</div>
      </header>

      {/* 2. How to reach them — real buttons. */}
      <div className="mt-2.5 px-3">
        <p className="mb-1.5 text-sm font-bold tabular-nums text-gray-700" dir="ltr">{row.phone || '—'}</p>
        {!wa && row.phone && <p className="mb-1.5 text-[11px] font-bold text-red-600">⚠ الرقم غير صالح — عدّله قبل تسجيل أي دفعة</p>}
        <div className="flex gap-1.5">
          {row.phone ? (
            <a href={`tel:${row.phone}`} onClick={onCall}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 text-sm font-bold text-white hover:bg-sky-700 active:bg-sky-700">
              <PhoneCall size={16} /> اتصال
            </a>
          ) : <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-400">مفيش رقم</span>}
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" onClick={onWhats}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 active:bg-emerald-700">
              <WhatsAppIcon size={16} /> واتساب
            </a>
          ) : <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-400">واتساب</span>}
        </div>
      </div>

      {/* 3. What they hold and owe. */}
      <div className="mx-3 mt-2.5 rounded-xl bg-gray-50/80 p-2.5">
        {courses.length === 0 ? <p className="text-[11px] text-gray-400">مفيش كورسات متسجلة.</p> : (
          <ul className="space-y-1.5">
            {courses.map(course => (
              <li key={course.id} className="text-[12px]">
                <p className="font-bold leading-snug text-gray-800 [overflow-wrap:anywhere]">{course.label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-gray-500">
                  <span>القيمة <b className="text-gray-700">{money(course.expected, course.currency)}</b></span>
                  <span>مدفوع <b className="text-emerald-700">{money(course.paid, course.currency)}</b></span>
                  {course.remaining > 0
                    ? <span>متبقي <b className="text-red-600">{money(course.remaining, course.currency)}</b></span>
                    : <span className="font-bold text-emerald-600">✓ مسدّد</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
        {owed > 0 && courses.length > 1 && (
          <p className="mt-2 border-t border-gray-200 pt-1.5 text-[12px] font-black text-red-700">إجمالي المتبقي {money(owed, currency)}</p>
        )}
        {certificates}
      </div>

      {/* 4. The next instalment, the owner, the last contact. */}
      <div className="mx-3 mt-2 grid gap-2">
        {hasInstallment && (
          <div>
            <p className="mb-0.5 text-[11px] font-black text-gray-500">القسط الجاي</p>
            {instCell}
          </div>
        )}
        <div className="flex items-start gap-1.5 text-[11px]">
          <UserRound size={12} className="mt-0.5 shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">{salesCell}</div>
          {housingCell && <div className="shrink-0">{housingCell}</div>}
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-2.5 py-1.5 text-[11px]">
          <p className="mb-0.5 font-black text-sky-900">نتيجة التواصل والمتابعة</p>
          {contactCell}
        </div>
      </div>

      {/* 5. The next thing to do. */}
      <footer className="mt-3 grid grid-cols-2 gap-1.5 border-t border-gray-100 bg-gray-50/60 p-2.5 sm:grid-cols-3">
        {actions.map(action => (
          <button key={action.key} type="button" onClick={action.onClick}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition ${TONE[action.tone || 'default']}`}>
            {action.icon} {action.label}
          </button>
        ))}
      </footer>
    </article>
  );
}
