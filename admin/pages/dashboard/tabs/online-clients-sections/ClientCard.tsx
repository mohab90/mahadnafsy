import React, { useState } from 'react';
import { CalendarClock, Clock, Home, MoreHorizontal, Phone } from 'lucide-react';
import type { SubscriberItem } from '../../../../types';
import { waLink } from '../../../../lib/whatsappLink';
import { WhatsAppIcon } from '../../../../components/WhatsAppIcon';
import { SUB_STATUS_CFG, type SubStatus } from '../../dashboardShared';

export type ClientCardAction = {
  key: string;
  /** Not drawn: the title of an icon-only button and its label for a screen reader. */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'good' | 'info' | 'danger';
};

export type ClientCardCourse = { id: string; label: string; expected: number; paid: number; remaining: number; currency: string };

const HOVER: Record<NonNullable<ClientCardAction['tone']>, string> = {
  default: 'hover:text-gray-800',
  good: 'hover:text-emerald-600',
  info: 'hover:text-sky-600',
  danger: 'hover:text-rose-600',
};

const round = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-gray-50 text-gray-500 transition hover:bg-white hover:shadow-sm active:scale-95';

const money = (value: number, currency: string) =>
  `${Math.round(value).toLocaleString('ar-EG-u-nu-latn')} ${currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج.م'}`;

const TONE_BADGE = {
  overdue: 'bg-red-50 text-red-600', today: 'bg-amber-50 text-amber-700', soon: 'bg-yellow-50 text-yellow-700', later: 'bg-gray-50 text-gray-500',
} as const;

/** The courses shown before «+N كورس». */
const COURSES_SHOWN = 3;

/**
 * One client as a card that says what the desk needs without opening anything.
 *
 * «تصميم كارت العميل ضعيف لازم نظهر اسماء الكورسات اللي حجزها ودفع كام في كل كورس وباقي كام، ولو في شهادة، ولو موعد
 * متابعة، او في الدقي تسكين» (19 Oct 2026). The quiet version of 18 Oct kept only the totals and put the courses
 * behind «⋯»; now each course is a line of its own — its name, what was paid of its price, what is left and a thin
 * bar — with the certificate, the follow-up date, the next instalment and the Dokki round as chips under them. The
 * call is a plain call (a `tel:` link): it used to open the contact log too, which is a thing the person chooses
 * to do from «⋯». The cells and the handlers are the table's own, so a card and its row can never disagree.
 */
export default function ClientCard({
  row, clientCode, selected, onToggle, onOpen, place, createdAt, courses, statusCell, salesCell, housingCell, housing,
  nextInstallment, lastLine, followUp, primary, secondary, onWhats, certificates,
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
  /** The Dokki round the client sits in («روند 3002»), «غير مسكّن» for none, null away from the Dokki screens. */
  housing: { text: string; housed: boolean } | null;
  nextInstallment: { text: string; tone: keyof typeof TONE_BADGE } | null;
  lastLine: string;
  followUp: { text: string; tone: keyof typeof TONE_BADGE } | null;
  /** The icons always shown, after the call and WhatsApp. */
  primary: ClientCardAction[];
  /** The icons behind «⋯». */
  secondary: ClientCardAction[];
  onWhats: () => void;
  certificates: React.ReactNode;
}) {
  const [more, setMore] = useState(false);
  const [allCourses, setAllCourses] = useState(false);
  const wa = waLink(row.phone);
  const paid = courses.reduce((sum, course) => sum + course.paid, 0);
  const owed = courses.reduce((sum, course) => sum + Math.max(0, course.remaining), 0);
  const currency = courses[0]?.currency || 'EGP';
  const status = SUB_STATUS_CFG[(row.status || 'active') as SubStatus] || SUB_STATUS_CFG.active;
  const paused = row.clientStatus && row.clientStatus !== 'active';
  const edge = selected ? 'border-r-blue-400' : owed > 0 ? 'border-r-amber-300' : 'border-r-emerald-400';
  const shown = allCourses ? courses : courses.slice(0, COURSES_SHOWN);

  const icon = (action: ClientCardAction) => (
    <button key={action.key} type="button" title={action.label} aria-label={action.label} onClick={action.onClick}
      className={`${round} ${HOVER[action.tone || 'default']}`}>
      {action.icon}
    </button>
  );

  return (
    <article className={`overflow-hidden rounded-xl border border-gray-100 border-r-4 ${edge} bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:shadow-md`} dir="rtl" data-client={clientCode}>
      <header className="flex items-start gap-2 px-3 pt-2.5">
        <input type="checkbox" checked={selected} onChange={event => onToggle(event.target.checked)} aria-label="تحديد العميل"
          className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onOpen} className="line-clamp-2 text-right text-[13px] font-bold leading-snug text-gray-900 [overflow-wrap:anywhere] hover:text-primary-700">
              {row.name || 'بدون اسم'}
            </button>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${status.cls}`}>{status.label}</span>
              {paused && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-600">{row.clientStatus === 'finished' ? 'منتهي' : row.clientStatus === 'paused' ? 'متوقف' : row.clientStatus === 'refunded' ? 'مسترد' : row.clientStatus === 'refund_pending' ? 'استرداد معلق' : row.clientStatus}</span>}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
            {row.phone
              ? <a href={`tel:${row.phone}`} className="tabular-nums hover:text-sky-600" dir="ltr">{row.phone}</a>
              : <span className="font-bold leading-none text-red-400" title="مفيش رقم" aria-label="مفيش رقم">—</span>}
            <span className="truncate" title={[place, createdAt].filter(Boolean).join(' · ')}>{[place, createdAt].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      </header>

      {/* Each course: its name, what was paid of its price, what is left. */}
      <div className="mx-3 mt-2 space-y-1.5 rounded-lg bg-gray-50/80 px-2 py-1.5">
        {courses.length === 0 && <p className="text-[11px] text-gray-400">لسه محجزش كورس</p>}
        {shown.map(course => {
          const done = course.remaining <= 0;
          const percent = course.expected > 0 ? Math.min(100, Math.round((course.paid / course.expected) * 100)) : done ? 100 : 0;
          return (
            <div key={course.id}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="line-clamp-1 text-[11px] font-bold text-gray-700 [overflow-wrap:anywhere]" title={course.label}>{course.label}</p>
                {done
                  ? <span className="shrink-0 text-[10px] font-bold text-emerald-600">✓ مسدّد</span>
                  : <span className="shrink-0 text-[10px] font-bold text-red-600">باقي {money(course.remaining, course.currency)}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${percent}%` }} /></div>
                <span className="shrink-0 text-[10px] tabular-nums text-gray-500">دفع {money(course.paid, course.currency)}{course.expected > 0 ? ` من ${money(course.expected, course.currency)}` : ''}</span>
              </div>
            </div>
          );
        })}
        {courses.length > COURSES_SHOWN && (
          <button type="button" onClick={() => setAllCourses(value => !value)} className="text-[10px] font-bold text-sky-600 hover:underline">
            {allCourses ? 'إخفاء' : `+${(courses.length - COURSES_SHOWN).toLocaleString('ar-EG-u-nu-latn')} كورس تاني`}
          </button>
        )}
        {courses.length > 1 && (
          <p className="border-t border-gray-200 pt-1 text-[10px] text-gray-500">
            الإجمالي: دفع <b className="text-emerald-700">{money(paid, currency)}</b>{owed > 0 ? <> · باقي <b className="text-red-600">{money(owed, currency)}</b></> : <b className="text-emerald-600"> · ✓ مسدّد</b>}
          </p>
        )}
      </div>

      {/* The rest the desk acts on: the Dokki round, the follow-up, the next instalment and the certificate. */}
      {(housing || followUp || nextInstallment || certificates) && (
        <div className="mx-3 mt-1.5 flex flex-wrap items-center gap-1">
          {housing && (
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${housing.housed ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}><Home size={9} /> {housing.text}</span>
          )}
          {followUp && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${TONE_BADGE[followUp.tone]}`}><Clock size={9} /> {followUp.text}</span>}
          {nextInstallment && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${TONE_BADGE[nextInstallment.tone]}`}><CalendarClock size={9} /> {nextInstallment.text}</span>}
          {certificates}
        </div>
      )}
      {lastLine && <p className="mx-3 mt-1 flex items-center gap-1 truncate text-[11px] text-gray-400" title={lastLine}><Clock size={10} className="shrink-0" /> <span className="truncate">{lastLine}</span></p>}

      <footer className="mt-2 border-t border-gray-50 px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">
          {row.phone ? (
            <a href={`tel:${row.phone}`} title="اتصال" aria-label="اتصال" className={`${round} hover:text-sky-600`}><Phone size={16} /></a>
          ) : <span title="مفيش رقم" aria-label="مفيش رقم" className={`${round} opacity-40`}><Phone size={16} /></span>}
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" onClick={onWhats} title="واتساب" aria-label="واتساب" className={`${round} hover:text-emerald-600`}><WhatsAppIcon size={16} /></a>
          ) : <span title="الرقم غير صالح للواتساب" aria-label="الرقم غير صالح للواتساب" className={`${round} opacity-40`}><WhatsAppIcon size={16} /></span>}
          {primary.map(icon)}
          <button type="button" title="المزيد" aria-label="المزيد" aria-expanded={more} onClick={() => setMore(value => !value)}
            className={`${round} ${more ? 'bg-white text-gray-800 shadow-sm' : ''}`}><MoreHorizontal size={16} /></button>
        </div>

        {more && (
          <div className="mt-2 space-y-2 border-t border-gray-50 pt-2 text-[11px]">
            {!wa && row.phone && <p className="font-bold text-red-600">⚠ الرقم غير صالح — عدّله قبل تسجيل أي دفعة</p>}
            <div className="flex flex-wrap gap-1.5">{secondary.map(icon)}</div>
            <div>{statusCell}</div>
            <div className="flex items-start gap-1.5 text-gray-600"><div className="min-w-0 flex-1">{salesCell}</div>{housingCell && <div className="shrink-0">{housingCell}</div>}</div>
          </div>
        )}
      </footer>
    </article>
  );
}
