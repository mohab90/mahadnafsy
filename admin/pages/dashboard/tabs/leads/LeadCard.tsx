// One lead as a card: who, how to reach them, where they stand, what they asked for and the next thing to do.
//
// «محتاجين نخلي كارت العميل اشبه بكارت طلب الانضمام مكتوب تفاصيل كتر وواضح وزر الاتصال والواتس
// اب شغال ويبقي ريسبونسيف للموبايل بشكل قوي» (17 Oct 2026). It had a 13 px phone icon in a row of
// four, and the number was the only thing to read; now the call and WhatsApp buttons are real,
// full-size buttons, the details are written out, and the status colours the card's edge.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across seventeen unrelated
// exports. It still re-exports this, so the files that import from it are untouched.

import React from 'react';
import { Building2, CalendarClock, Clock, ExternalLink, GraduationCap, Phone, PhoneCall, UserRound, Wallet } from 'lucide-react';
import { cairoDateOnly, cairoDay } from '../../../../../shared/cairoDate';
import type { LeadItem, LeadStatus, Course, Bundle } from '../../../../types';
import { toDialable } from '../../../../lib/whatsappLink';
import WhatsAppLink from './WhatsAppLink';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  interestLevelLabel,
  ROTTEN_CFG,
  STALE_BADGES_SHOWN,
  STATUS_CFG,
  getLeadBranchRaw,
  getRottenLevel,
} from '../leadUtils';
import { ScoreBadge } from './LeadScoreAndTimeline';
import LeadOutcomeButtons from './LeadOutcomeButtons';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';
import { TERMINAL_LEAD_STATUSES } from '../../../../../shared/leadStatuses';

// A lead in one of these is finished; offering "did they answer" on it would
// be inviting a rep to reopen something that is closed.
const CLOSED_FOR_OUTCOMES = TERMINAL_LEAD_STATUSES;

// The card's edge in its status colour. Whole class names, because Tailwind only writes the ones it can read.
const EDGE: Partial<Record<LeadStatus, string>> = {
  new: 'border-r-blue-500', contacted: 'border-r-yellow-500', interested: 'border-r-emerald-500',
  interested_booking: 'border-r-teal-500', interested_followup: 'border-r-cyan-500', postpone_month: 'border-r-orange-500',
  no_answer: 'border-r-gray-400', no_answer_wa: 'border-r-slate-400', no_answer_nowa: 'border-r-slate-500',
  wrong_number: 'border-r-zinc-400', with_colleague: 'border-r-indigo-400', not_interested: 'border-r-red-400',
  not_interested_hidden: 'border-r-rose-400', closed: 'border-r-violet-500', converted: 'border-r-green-500',
  lost: 'border-r-red-300', other: 'border-r-gray-300',
};

const WA_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
);

function LeadCardView({ lead, score, onSelect, onStatusChange, onBook, onContact, onOutcomeRecorded, canManageLeads, instituteBranches, courses, bundles }: {
  lead: LeadItem;
  score: number;
  onSelect: () => void;
  onStatusChange: (status: LeadStatus) => void;
  onBook?: (lead: LeadItem) => void;
  onContact?: (lead: LeadItem) => void;
  /** Refresh once a one-tap outcome has been recorded. */
  onOutcomeRecorded?: () => void;
  canManageLeads: boolean;
  instituteBranches: { id: string; label: string }[];
  courses: Course[];
  bundles: Bundle[];
}) {
  const today = cairoDateOnly();
  const isOverdue = !!(lead.nextFollowUpDate && lead.nextFollowUpDate < today);
  const daysOverdue = isOverdue
    ? Math.floor((Date.now() - new Date(lead.nextFollowUpDate!).getTime()) / 86_400_000)
    : 0;
  const lastComm = (lead.communications && lead.communications.length > 0)
    ? [...lead.communications].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const rotLevel = STALE_BADGES_SHOWN ? getRottenLevel(lead) : 0;
  const rotCfg = ROTTEN_CFG[rotLevel];
  const cfg = STATUS_CFG[lead.status];
  const dialable = toDialable(lead.phone);
  const comms = lead.communicationCount ?? lead.communications?.length ?? 0;

  const branchLabel = (() => {
    if (!getLeadBranchRaw(lead)) return '';
    const key = (lead.branch || '').toUpperCase().replace(/[-\s]/g, '_');
    return instituteBranches.find(b => b.id.toUpperCase().replace(/[-\s]/g, '_') === key)?.label
      || BRANCH_ENUM_LABELS[key]
      || getLeadBranchRaw(lead);
  })();

  const courseChips = (lead.interestedCourseIds || []).map(id => {
    const raw = isRawCourse(id);
    const title = courseBadgeLabel(id, courses, bundles);
    // courseBadgeLabel falls back to the id itself; an unresolvable real id is noise, but a raw name is the point.
    if (!title || (!raw && title === id)) return null;
    return { id, raw, title };
  }).filter((chip): chip is { id: string; raw: boolean; title: string } => chip !== null);

  return (
    <article
      className={`group overflow-hidden rounded-2xl border border-gray-200 border-r-[6px] ${EDGE[lead.status] || 'border-r-gray-300'} bg-white shadow-sm transition hover:shadow-md`}
      dir="rtl"
      data-status={lead.status}
    >
      {rotLevel > 0 && <div className={`h-1 w-full ${rotCfg.bar}`} />}

      {/* 1. Who, and where they stand. A tap anywhere in this block opens the lead. */}
      <header className="cursor-pointer px-3 pt-3" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 text-base font-black leading-tight text-gray-900 [overflow-wrap:anywhere]">{lead.name || 'بدون اسم'}</h3>
          <ScoreBadge score={score} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {cfg && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${cfg.color}`}>{cfg.label}</span>}
          {rotLevel > 0 && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${rotCfg.badge}`}>{rotCfg.label}</span>}
          {lead.interestLevel && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">اهتمام {interestLevelLabel(lead.interestLevel)}</span>}
          {lead.nextFollowUpDate && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${isOverdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
              <Clock size={11} /> {isOverdue ? `متأخر ${daysOverdue} يوم` : `متابعة ${lead.nextFollowUpDate}`}
            </span>
          )}
        </div>
      </header>

      {/* 2. How to reach them — real buttons, a thumb wide. */}
      <div className="mt-2.5 px-3">
        <p className="mb-1.5 text-sm font-bold tabular-nums text-gray-700" dir="ltr">{lead.phone || '—'}</p>
        <div className="flex gap-1.5">
          {lead.phone ? (
            <a href={`tel:${dialable ? `+${dialable}` : lead.phone}`} onClick={event => event.stopPropagation()}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 text-sm font-bold text-white active:bg-sky-700 hover:bg-sky-700">
              <PhoneCall size={16} /> اتصال
            </a>
          ) : (
            <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-400">مفيش رقم</span>
          )}
          <WhatsAppLink leadId={lead.id} phone={lead.phone}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-bold text-white active:bg-emerald-700 hover:bg-emerald-700">
            {WA_ICON} واتساب
          </WhatsAppLink>
          {canManageLeads && onContact && (
            <button type="button" onClick={event => { event.stopPropagation(); onContact(lead); }} title="سجّل إن في مكالمة حصلت"
              className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100">
              <Phone size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 3. The details, written out. */}
      <dl className="mx-3 mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-gray-50/80 p-2.5 text-[11px]">
        <div className="flex items-center gap-1 text-gray-600"><UserRound size={11} className="shrink-0 text-gray-400" /><dt className="sr-only">المسؤول</dt><dd className="truncate font-bold">{lead.assignedSalesName || 'غير معيّن'}</dd></div>
        <div className="flex items-center gap-1 text-gray-600"><Building2 size={11} className="shrink-0 text-gray-400" /><dt className="sr-only">الفرع</dt><dd className="truncate font-bold">{branchLabel || 'بدون فرع'}</dd></div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-gray-500">
          {lead.source && <span>المصدر: <b className="text-gray-700">{lead.source}</b></span>}
          {lead.createdAt && <span>أُضيف: <b className="text-gray-700">{new Date(lead.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', timeZone: CAIRO_TIME_ZONE })}</b></span>}
          {comms > 0 && <span>{comms} تواصل</span>}
          {lead.email && <span className="[overflow-wrap:anywhere]" dir="ltr">{lead.email}</span>}
        </div>
        {courseChips.length > 0 && (
          <div className="col-span-2 flex flex-wrap items-center gap-1">
            <GraduationCap size={11} className="shrink-0 text-gray-400" />
            {courseChips.slice(0, 3).map(chip => (
              <span key={chip.id} className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${chip.raw ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-primary-200 bg-primary-50 text-primary-700'}`}>
                {chip.title.length > 22 ? `${chip.title.slice(0, 22)}…` : chip.title}
              </span>
            ))}
            {courseChips.length > 3 && <span className="text-[10px] text-gray-400">+{courseChips.length - 3}</span>}
          </div>
        )}
      </dl>

      {/* 4. The last contact and the notes. */}
      <div className="mx-3 mt-2 space-y-1.5">
        {lastComm ? (
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-black text-sky-900">
              <span>{COMM_ICON[lastComm.type] || '📋'}</span> آخر تواصل: {COMM_LABEL[lastComm.type] || lastComm.type}
              <span className="mr-auto text-[10px] font-normal text-sky-700" dir="ltr">{cairoDay(lastComm.date)}</span>
            </div>
            {lastComm.notes && <p title={lastComm.notes} className="mt-0.5 line-clamp-2 text-[11px] text-sky-900/80">{lastComm.notes}</p>}
            {lastComm.outcome && <p className="mt-0.5 text-[11px] font-bold text-emerald-700">↩ {lastComm.outcome}</p>}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-400">لسه محدش اتواصل معاه</p>
        )}
        {(lead.internalQuickNote || lead.notes) && (
          <p title={lead.internalQuickNote || lead.notes} className="line-clamp-2 rounded-xl border border-yellow-200 bg-yellow-50 px-2.5 py-1.5 text-[11px] text-yellow-900">
            <b>ملاحظة:</b> {lead.internalQuickNote || lead.notes}
          </p>
        )}
        {(lead.tags?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {(lead.tags || []).slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{tag}</span>)}
            {(lead.tags?.length || 0) > 4 && <span className="text-[10px] text-gray-400">+{(lead.tags?.length || 0) - 4}</span>}
          </div>
        )}
      </div>

      {/* 5. The next thing to do. */}
      <footer className="mt-3 space-y-1.5 border-t border-gray-100 bg-gray-50/60 px-3 py-2.5" onClick={event => event.stopPropagation()}>
        {canManageLeads && (
          <select value={lead.status} onChange={event => onStatusChange(event.target.value as LeadStatus)} aria-label="الحالة"
            className="h-9 w-full rounded-xl border border-gray-200 bg-white px-2 text-xs font-bold text-gray-700">
            {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(status => status !== 'converted').map(status => (
              <option key={status} value={status}>{STATUS_CFG[status].label}</option>
            ))}
          </select>
        )}
        {canManageLeads && !CLOSED_FOR_OUTCOMES.has(lead.status) && <LeadOutcomeButtons lead={lead} onRecorded={onOutcomeRecorded} />}
        {canManageLeads && (
          <div className="flex gap-1.5">
            <button type="button" onClick={onSelect}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50">
              <ExternalLink size={13} /> تفاصيل / تعديل
            </button>
            {onBook && (
              <button type="button" onClick={() => onBook(lead)}
                className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-50 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                <Wallet size={13} /> حجز ودفع
              </button>
            )}
          </div>
        )}
        {lead.updatedAt && !canManageLeads && (
          <p className="flex items-center gap-1 text-[10px] text-gray-400"><CalendarClock size={10} /> آخر تحديث {cairoDay(lead.updatedAt)}</p>
        )}
      </footer>
    </article>
  );
}

// A column draws many of these and a change to one lead redrew them all.
export const LeadCard = React.memo(LeadCardView);
