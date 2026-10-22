// One lead as a small, quiet card: the name, how to reach them, where they stand, and a row of icon buttons.
//
// «محتاجين نخلي تصميم الكارت أهدى شوية، الأيقونات تبقى بدون كتابة، وننظمه بشكل أفضل … وأزرار مش شغالة اتأكد
// منها» (18 Oct 2026). The first version wrote everything out in a 330 px card with two big coloured buttons;
// four of those fit across a screen only if each says less. Now: the name and score, a grey line for the phone,
// one line of facts, one line for the last contact, and six icon buttons. The status and the one-tap outcomes
// are behind «⋯». Every icon has a title and an accessible label, since there is no text beside it.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across seventeen unrelated exports. It
// still re-exports this, so the files that import from it are untouched.

import React, { useState } from 'react';
import { Clock, ExternalLink, MoreHorizontal, NotebookPen, Phone, UserRound, Wallet } from 'lucide-react';
import { cairoDateOnly, cairoDay } from '../../../../../shared/cairoDate';
import type { LeadItem, LeadStatus, Course, Bundle } from '../../../../types';
import { toDialable } from '../../../../lib/whatsappLink';
import WhatsAppLink from './WhatsAppLink';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  BRANCH_ENUM_LABELS,
  ROTTEN_CFG,
  STALE_BADGES_SHOWN,
  STATUS_CFG,
  getLeadBranchRaw,
  getRottenLevel,
  interestLevelLabel,
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
  new: 'border-r-blue-400', contacted: 'border-r-yellow-400', interested: 'border-r-emerald-400',
  interested_booking: 'border-r-teal-400', interested_followup: 'border-r-cyan-400', postpone_month: 'border-r-orange-400',
  no_answer: 'border-r-gray-300', no_answer_wa: 'border-r-slate-300', no_answer_nowa: 'border-r-slate-400',
  wrong_number: 'border-r-zinc-300', with_colleague: 'border-r-indigo-300', not_interested: 'border-r-red-300',
  not_interested_hidden: 'border-r-rose-300', closed: 'border-r-violet-400', converted: 'border-r-green-400',
  lost: 'border-r-red-200', other: 'border-r-gray-200',
};

const WA_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
);

/** A round icon button: no text, so a title for the mouse and a label for a screen reader. */
const iconButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-gray-50 text-gray-500 transition hover:bg-white hover:shadow-sm active:scale-95';

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
  const [more, setMore] = useState(false);
  const today = cairoDateOnly();
  const isOverdue = !!(lead.nextFollowUpDate && lead.nextFollowUpDate < today);
  const daysOverdue = isOverdue
    ? Math.floor((Date.now() - new Date(lead.nextFollowUpDate!).getTime()) / 86_400_000)
    : 0;
  const lastComm = (lead.communications && lead.communications.length > 0)
    ? [...lead.communications].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const rotLevel = STALE_BADGES_SHOWN ? getRottenLevel(lead) : 0;
  const cfg = STATUS_CFG[lead.status];
  const dialable = toDialable(lead.phone);

  const branchLabel = (() => {
    if (!getLeadBranchRaw(lead)) return '';
    const key = (lead.branch || '').toUpperCase().replace(/[-\s]/g, '_');
    return instituteBranches.find(b => b.id.toUpperCase().replace(/[-\s]/g, '_') === key)?.label
      || BRANCH_ENUM_LABELS[key]
      || getLeadBranchRaw(lead);
  })();

  const courseTitle = (() => {
    for (const id of lead.interestedCourseIds || []) {
      const title = courseBadgeLabel(id, courses, bundles);
      if (title && (isRawCourse(id) || title !== id)) return title;
    }
    return '';
  })();

  const dateLabel = lead.createdAt
    ? new Date(lead.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', timeZone: CAIRO_TIME_ZONE })
    : '';
  const lastLine = lastComm ? (lastComm.outcome || lastComm.notes || '') : '';

  return (
    <article
      className={`overflow-hidden rounded-xl border border-gray-100 border-r-4 ${EDGE[lead.status] || 'border-r-gray-200'} bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:shadow-md`}
      dir="rtl"
      data-status={lead.status}
    >
      {/* Who, and where they stand. A tap on this block opens the lead. */}
      <header className="cursor-pointer px-3 pt-2.5" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-[13px] font-bold leading-snug text-gray-900 [overflow-wrap:anywhere]">{lead.name || 'بدون اسم'}</h3>
          <ScoreBadge score={score} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
          <span className="tabular-nums" dir="ltr">{lead.phone || '—'}</span>
          {cfg && <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>}
          {interestLevelLabel(lead.interestLevel) && <span className="rounded-full bg-gray-50 px-1.5 py-px text-[10px] font-bold text-gray-500">{interestLevelLabel(lead.interestLevel)}</span>}
          {rotLevel > 0 && <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${ROTTEN_CFG[rotLevel].badge}`}>{ROTTEN_CFG[rotLevel].label}</span>}
        </div>
      </header>

      {/* The facts, one quiet line each. */}
      <div className="mt-1.5 space-y-0.5 px-3 text-[11px] text-gray-500">
        <p className="flex items-center gap-1 truncate" title={[lead.assignedSalesName, branchLabel, lead.source].filter(Boolean).join(' · ')}>
          <UserRound size={11} className="shrink-0 text-gray-300" />
          <span className="truncate">{[lead.assignedSalesName || 'غير معيّن', branchLabel, lead.source, dateLabel].filter(Boolean).join(' · ')}</span>
        </p>
        {lead.adSource && <p className="truncate text-indigo-500" title={`جاي من إعلان: ${lead.adSource}`}>إعلان: {lead.adSource}</p>}
        {courseTitle && <p className="truncate text-gray-400" title={courseTitle}>🎓 {courseTitle}</p>}
        {lastLine && <p className="flex items-center gap-1 truncate text-gray-400" title={lastLine}><Clock size={10} className="shrink-0" /> <span className="truncate">{lastLine}</span></p>}
        {lead.nextFollowUpDate && (
          <p className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${isOverdue ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
            <Clock size={9} /> {isOverdue ? `متأخر ${daysOverdue} يوم` : `متابعة ${lead.nextFollowUpDate}`}
          </p>
        )}
      </div>

      {/* The buttons: icons only. */}
      <footer className="mt-2 border-t border-gray-50 px-2 py-2" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-1">
          {lead.phone ? (
            <a href={`tel:${dialable ? `+${dialable}` : lead.phone}`} title="اتصال" aria-label="اتصال"
              onClick={() => { if (canManageLeads && onContact) onContact(lead); }}
              className={`${iconButton} hover:text-sky-600`}>
              <Phone size={16} />
            </a>
          ) : (
            <span title="مفيش رقم" aria-label="مفيش رقم" className={`${iconButton} opacity-40`}><Phone size={16} /></span>
          )}
          <WhatsAppLink leadId={lead.id} phone={lead.phone} title="واتساب" className={`${iconButton} hover:text-emerald-600`}>
            {WA_ICON}
          </WhatsAppLink>
          {canManageLeads && onContact && (
            <button type="button" title="تسجيل تواصل" aria-label="تسجيل تواصل" onClick={() => onContact(lead)} className={`${iconButton} hover:text-indigo-600`}>
              <NotebookPen size={15} />
            </button>
          )}
          {canManageLeads && (
            <button type="button" title="تفاصيل / تعديل" aria-label="تفاصيل وتعديل" onClick={onSelect} className={`${iconButton} hover:text-primary-600`}>
              <ExternalLink size={15} />
            </button>
          )}
          {canManageLeads && onBook && (
            <button type="button" title="حجز ودفع" aria-label="حجز ودفع" onClick={() => onBook(lead)} className={`${iconButton} hover:text-emerald-600`}>
              <Wallet size={15} />
            </button>
          )}
          {canManageLeads && (
            <button type="button" title="الحالة ونتيجة المكالمة" aria-label="الحالة ونتيجة المكالمة" aria-expanded={more}
              onClick={() => setMore(value => !value)}
              className={`${iconButton} ${more ? 'bg-white text-gray-800 shadow-sm' : ''}`}>
              <MoreHorizontal size={16} />
            </button>
          )}
        </div>

        {canManageLeads && more && (
          <div className="mt-2 space-y-1.5 border-t border-gray-50 pt-2">
            <select value={lead.status} onChange={event => onStatusChange(event.target.value as LeadStatus)} aria-label="الحالة"
              className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700">
              {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(status => status !== 'converted').map(status => (
                <option key={status} value={status}>{STATUS_CFG[status].label}</option>
              ))}
            </select>
            {!CLOSED_FOR_OUTCOMES.has(lead.status) && <LeadOutcomeButtons lead={lead} onRecorded={onOutcomeRecorded} compact />}
          </div>
        )}
      </footer>
    </article>
  );
}

// A grid draws many of these and a change to one lead redrew them all.
export const LeadCard = React.memo(LeadCardView);
