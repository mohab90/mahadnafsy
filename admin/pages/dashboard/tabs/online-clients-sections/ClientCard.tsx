import React, { useState } from 'react';
import { Clock, MoreHorizontal, Phone } from 'lucide-react';
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
  overdue: 'bg-red-50 text-red-500', today: 'bg-amber-50 text-amber-600', soon: 'bg-yellow-50 text-yellow-700', later: 'bg-gray-50 text-gray-500',
} as const;

/**
 * One client as a small, quiet card — four across on a desk, one on a phone.
 *
 * «كروت … أهدى شوية، الأيقونات بدون كتابة، ٤ أعمدة، بالترتيب» (18 Oct 2026). The first version wrote every
 * course, the instalment, the owner and the contact out in a 330 px card; now the card says who, how much is
 * owed, the next instalment and the last contact in four short lines, and the actions are icons (a title for the
 * mouse, a label for a screen reader). The courses, the status, the owner and the less-used actions are behind
 * «⋯». The cells and the handlers are the table's own, so a card and its row can never disagree.
 */
export default function ClientCard({
  row, clientCode, selected, onToggle, onOpen, place, createdAt, courses, statusCell, salesCell, housingCell,
  nextInstallment, lastLine, followUp, primary, secondary, onCall, onWhats, certificates,
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
  nextInstallment: { text: string; tone: keyof typeof TONE_BADGE } | null;
  lastLine: string;
  followUp: { text: string; tone: keyof typeof TONE_BADGE } | null;
  /** The icons always shown, after the call and WhatsApp. */
  primary: ClientCardAction[];
  /** The icons behind «⋯». */
  secondary: ClientCardAction[];
  onCall: () => void;
  onWhats: () => void;
  certificates: React.ReactNode;
}) {
  const [more, setMore] = useState(false);
  const wa = waLink(row.phone);
  const paid = courses.reduce((sum, course) => sum + course.paid, 0);
  const owed = courses.reduce((sum, course) => sum + Math.max(0, course.remaining), 0);
  const currency = courses[0]?.currency || 'EGP';
  const status = SUB_STATUS_CFG[(row.status || 'active') as SubStatus] || SUB_STATUS_CFG.active;
  const paused = row.clientStatus && row.clientStatus !== 'active';
  const edge = selected ? 'border-r-blue-400' : owed > 0 ? 'border-r-amber-300' : 'border-r-emerald-400';

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
          <button type="button" onClick={onOpen} className="line-clamp-2 text-right text-[13px] font-bold leading-snug text-gray-900 [overflow-wrap:anywhere] hover:text-primary-700">
            {row.name || 'بدون اسم'}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
            <span className="tabular-nums" dir="ltr">{row.phone || '—'}</span>
            <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${status.cls}`}>{status.label}</span>
            {paused && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-600">{row.clientStatus === 'finished' ? 'منتهي' : row.clientStatus === 'paused' ? 'متوقف' : row.clientStatus === 'refunded' ? 'مسترد' : row.clientStatus === 'refund_pending' ? 'استرداد معلق' : row.clientStatus}</span>}
          </div>
        </div>
      </header>

      {/* Four short lines. */}
      <div className="mt-1.5 space-y-0.5 px-3 text-[11px] text-gray-500">
        <p className="truncate" title={[place, createdAt].filter(Boolean).join(' · ')}>{[place, createdAt].filter(Boolean).join(' · ')}{courses.length > 0 && ` · ${courses.length.toLocaleString('ar-EG-u-nu-latn')} كورس`}</p>
        {courses.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2">
            <span>مدفوع <b className="text-emerald-700">{money(paid, currency)}</b></span>
            {owed > 0 ? <span>متبقي <b className="text-red-600">{money(owed, currency)}</b></span> : <span className="font-bold text-emerald-600">✓ مسدّد</span>}
          </p>
        )}
        {(nextInstallment || followUp) && (
          <p className="flex flex-wrap gap-1">
            {nextInstallment && <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${TONE_BADGE[nextInstallment.tone]}`}>{nextInstallment.text}</span>}
            {followUp && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${TONE_BADGE[followUp.tone]}`}><Clock size={9} /> {followUp.text}</span>}
          </p>
        )}
        {lastLine && <p className="flex items-center gap-1 truncate text-gray-400" title={lastLine}><Clock size={10} className="shrink-0" /> <span className="truncate">{lastLine}</span></p>}
      </div>

      <footer className="mt-2 border-t border-gray-50 px-2 py-2">
        <div className="flex items-center justify-between gap-1">
          {row.phone ? (
            <a href={`tel:${row.phone}`} onClick={onCall} title="اتصال" aria-label="اتصال" className={`${round} hover:text-sky-600`}><Phone size={16} /></a>
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
            {courses.length > 0 && (
              <ul className="space-y-1">
                {courses.map(course => (
                  <li key={course.id} className="rounded-lg bg-gray-50 px-2 py-1">
                    <p className="font-bold leading-snug text-gray-700 [overflow-wrap:anywhere]">{course.label}</p>
                    <p className="text-gray-500">{money(course.paid, course.currency)} / {money(course.expected, course.currency)}{course.remaining > 0 && <b className="mr-1 text-red-600">— متبقي {money(course.remaining, course.currency)}</b>}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-start gap-1.5 text-gray-600"><div className="min-w-0 flex-1">{salesCell}</div>{housingCell && <div className="shrink-0">{housingCell}</div>}</div>
            {certificates}
          </div>
        )}
      </footer>
    </article>
  );
}
