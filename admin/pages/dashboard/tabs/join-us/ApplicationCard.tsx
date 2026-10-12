import React, { useState } from 'react';
import {
  Building2, CalendarCheck, Check, ChevronDown, ChevronUp, Clock, ExternalLink, GraduationCap,
  History, Mail, MessageCircle, NotebookPen, Phone, PhoneCall, Star, Trash2, X,
} from 'lucide-react';
import type { JoinUsApplication } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { waLink, toDisplay } from '../../../../lib/whatsappLink';
import { cairoDay } from '../../../../../shared/cairoDate';
import { branchLabel, fmtDateTime, yearsLabel } from '../hr-sections/applicantLabels';
import {
  KIND, KindBadge, RatingStars, STAGE_LABEL, STATUS, type Status, YesNoBadge, kindOf, statusOf,
} from './joinUsUi';

type Note = { id: string; kind: string; body: string; author_name: string | null; created_at: string };

const NOTE_KIND: Record<string, string> = {
  contact: 'تواصل', evaluation: 'قرار', first_call: 'أول مكالمة', note: 'ملاحظة',
};

/**
 * What the posting an application is attached to is called. Applications that
 * did not come from a listing sit on an internal "talent pool" job, which must
 * not read as a vacancy someone applied for.
 */
export function jobLabel(app: JoinUsApplication): string {
  if (!app.jobId) return '';
  if (app.jobId.startsWith('talent-')) return 'طلب عام — مش على وظيفة محددة';
  return app.jobTitle || 'وظيفة محذوفة';
}

export interface CardActions {
  onContact: (app: JoinUsApplication) => void;
  onFirstCall: (app: JoinUsApplication) => void;
  onMoveToInterview: (app: JoinUsApplication) => void;
  onAccept: (app: JoinUsApplication) => void;
  onReject: (app: JoinUsApplication) => void;
  onNote: (app: JoinUsApplication) => void;
  onStatus: (app: JoinUsApplication, status: Status) => void;
  onDelete?: (app: JoinUsApplication) => void;
}

/**
 * One application, read top to bottom in the order the desk works it.
 *
 * «محتاجين تحسين لتصميم كارت طلب الانضمام بشكل اقوي» (12 Oct 2026). Who it is and
 * what they applied as; how to reach them; where they stand; what they answered;
 * how the calls went; and the next thing to do — with the kind's colour down the
 * card's edge so a lecturer and an employee cannot be mistaken at a glance.
 */
const ApplicationCard: React.FC<{
  app: JoinUsApplication;
  busy: boolean;
  moved: boolean;
  actions: CardActions;
}> = ({ app, busy, moved, actions }) => {
  const kind = kindOf(app);
  const status = statusOf(app.status);
  const [history, setHistory] = useState<Note[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    try {
      setHistoryError('');
      setHistory(await mysqlAdmin.listRecruitmentNotes('join_us', app.id));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'تعذّر تحميل السجل');
    }
  };

  const wa = waLink(app.phone, `أهلاً ${app.name}، معاك فريق الموارد البشرية في معهد الدراسات النفسية بخصوص طلب الانضمام.`);
  const shownPhone = toDisplay(app.phone) || app.phone;
  const inInterview = app.applicantStage === 'interview' || app.applicantStage === 'offer' || moved;
  const decided = status === 'accepted' || status === 'rejected';
  const job = jobLabel(app);
  const hasAnswers = (kind !== 'staff' && (app.lecturedBefore != null || app.sessionsBefore != null
    || (app.programs?.length || 0) > 0 || Boolean(app.programsOther)))
    || Boolean(app.experienceYears || app.education || app.experiencePlaces || app.message);

  return (
    <article className={`overflow-hidden rounded-2xl border border-gray-200 border-r-[6px] ${KIND[kind].accent} bg-white shadow-sm`} data-kind={kind}>
      {/* 1. Who, as what, where — and where they stand. */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black leading-tight text-gray-900">{app.name}</h3>
            <KindBadge kind={kind} size="md" />
            {app.applicantBranch && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-bold text-white">
                <Building2 size={11} /> {branchLabel(app.applicantBranch)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-bold text-gray-600">
            {app.specialty}
            {job && <span className="font-normal text-gray-400"> · {job}</span>}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-400"><Clock size={11} /> قدّم {cairoDay(app.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${STATUS[status].className}`}>{STATUS[status].label}</span>
          {(app.applicantStage || moved) && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${inInterview ? 'bg-violet-100 text-violet-800' : 'bg-gray-100 text-gray-600'}`}>
              المرحلة: {moved && app.applicantStage !== 'offer' ? STAGE_LABEL.interview : STAGE_LABEL[app.applicantStage || 'applied']}
            </span>
          )}
        </div>
      </header>

      {/* 2. How to reach them. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 px-4">
        {app.phone && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 py-1 pl-1 pr-2.5 text-sm font-bold text-gray-800">
            <Phone size={13} className="text-gray-500" />
            <span dir="ltr">{shownPhone}</span>
            <a href={`tel:${app.phone}`} title="اتصال"
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-700">
              <PhoneCall size={11} /> اتصال
            </a>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" title="واتساب"
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700">
                <MessageCircle size={11} /> واتساب
              </a>
            )}
          </span>
        )}
        {app.email && (
          <a href={`mailto:${app.email}`} className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50" dir="ltr">
            <Mail size={12} /> {app.email}
          </a>
        )}
        {app.linkedin && (
          <a href={app.linkedin} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100">
            <ExternalLink size={12} /> LinkedIn / الموقع
          </a>
        )}
      </div>

      {/* 3. What they answered — nothing drawn when the form asked nothing. */}
      {hasAnswers && (
      <div className="mx-4 mt-3 space-y-2 rounded-xl bg-gray-50/80 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {kind !== 'staff' && (
            <>
              <YesNoBadge label="اشتغل محاضر قبل كده" value={app.lecturedBefore} />
              <YesNoBadge label="جلسات نفسية مع عملاء" value={app.sessionsBefore} />
            </>
          )}
          {app.experienceYears && (
            <span className="rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700">الخبرة: {yearsLabel(app.experienceYears)}</span>
          )}
          {app.education && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700">
              <GraduationCap size={11} /> {app.education}
            </span>
          )}
        </div>
        {kind !== 'staff' && ((app.programs?.length || 0) > 0 || app.programsOther) && (
          <div>
            <p className="mb-1 text-[11px] font-black text-gray-500">البرامج اللي يقدر يقدّمها</p>
            <div className="flex flex-wrap gap-1">
              {(app.programs || []).map(program => (
                <span key={program.id || program.title} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${KIND[kind].soft}`}>{program.title}</span>
              ))}
            </div>
            {app.programsOther && (
              <p className="mt-1 text-[11px] text-gray-600"><span className="font-bold">برامج تانية:</span> {app.programsOther}</p>
            )}
          </div>
        )}
        {app.experiencePlaces && <p title={app.experiencePlaces} className="line-clamp-2 text-[11px] text-gray-600"><span className="font-bold">اشتغل قبل كده:</span> {app.experiencePlaces}</p>}
        {app.message && <p title={app.message} className="line-clamp-2 whitespace-pre-line text-[11px] text-gray-500">{app.message}</p>}
      </div>
      )}

      {/* 4. The calls and the plan. */}
      <div className="mt-2 grid gap-2 px-4 sm:grid-cols-2">
        {app.firstCallRating ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <div className="flex flex-wrap items-center gap-2 font-black">
              تقييم أول مكالمة <RatingStars value={app.firstCallRating} /> <span>{app.firstCallRating}/5</span>
            </div>
            {(app.firstCallTags?.length || 0) > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {app.firstCallTags!.map(tag => <span key={tag} className="rounded-full bg-white px-2 py-0.5 font-bold text-amber-800">{tag}</span>)}
              </div>
            )}
            {app.firstCallNotes && <p className="mt-1 whitespace-pre-line">{app.firstCallNotes}</p>}
            <p className="mt-0.5 text-[10px] text-amber-700">{app.firstCallByName ? `بواسطة ${app.firstCallByName} · ` : ''}<span>{fmtDateTime(app.firstCallAt)}</span></p>
          </div>
        ) : null}
        <div className={`rounded-xl border px-3 py-2 text-[11px] ${app.contactedAt ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-dashed border-gray-200 text-gray-400'}`}>
          {app.contactedAt ? (
            <>
              <div className="flex flex-wrap items-center gap-x-2 font-black">
                <Phone size={11} /> آخر تواصل
                <span className="text-[10px] font-normal text-sky-700">{fmtDateTime(app.contactNoteAt || app.contactedAt)}</span>
                {app.contactedByName && <span className="font-normal text-sky-700">بواسطة {app.contactedByName}</span>}
              </div>
              {app.contactNote && <p title={app.contactNote} className="mt-1 line-clamp-2 whitespace-pre-line">{app.contactNote}</p>}
            </>
          ) : 'لسه محدش اتواصل معاه'}
        </div>
        {app.interviewAt && (
          <div className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-bold text-violet-800">
            <CalendarCheck size={12} /> ميعاد الانترفيو: <span>{fmtDateTime(app.interviewAt)}</span>
          </div>
        )}
        {app.adminNote && (
          <p title={app.adminNote} className="line-clamp-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-[11px] text-yellow-900">
            <span className="font-black">ملاحظة HR:</span> {app.adminNote}
          </p>
        )}
      </div>

      {/* 5. The next thing to do. */}
      <footer className="mt-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button disabled={busy} onClick={() => actions.onContact(app)}
            className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40">
            <Phone size={13} /> {app.contactedAt ? 'تسجيل تواصل تاني' : 'تسجيل تواصل'}
          </button>
          <button disabled={busy} onClick={() => actions.onFirstCall(app)}
            className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-40">
            <Star size={13} /> {app.firstCallRating ? 'تعديل تقييم أول مكالمة' : 'تقييم أول مكالمة'}
          </button>
          <button disabled={busy} onClick={() => actions.onMoveToInterview(app)}
            title={inInterview ? 'في الانترفيوهات — اضغط لتعديل الميعاد' : 'تحديد ميعاد ونقل لصفحة الانترفيوهات'}
            className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40 ${
              inInterview ? 'border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>
            <CalendarCheck size={13} /> {inInterview ? 'تعديل ميعاد الانترفيو' : 'نقل للانترفيو'}
          </button>
          {!decided && (
            <>
              <button disabled={busy} onClick={() => actions.onAccept(app)}
                className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                <Check size={13} /> قبول
              </button>
              <button disabled={busy} onClick={() => actions.onReject(app)}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                <X size={13} /> رفض
              </button>
            </>
          )}
          <span className="mr-auto flex flex-wrap items-center gap-1.5">
            <select value={status} disabled={busy} aria-label="الحالة"
              onChange={event => actions.onStatus(app, event.target.value as Status)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-600">
              {(Object.keys(STATUS) as Status[]).map(key => <option key={key} value={key}>{STATUS[key].label}</option>)}
            </select>
            <button onClick={() => actions.onNote(app)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-white">
              <NotebookPen size={12} /> ملاحظة
            </button>
            <button onClick={() => { void toggleHistory(); }} aria-expanded={historyOpen}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-white">
              <History size={12} /> السجل {historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {actions.onDelete && (
              <button disabled={busy} onClick={() => actions.onDelete!(app)} title="حذف الطلب"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                <Trash2 size={12} />
              </button>
            )}
          </span>
        </div>
        {historyOpen && (
          <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2">
            {historyError ? <p className="text-[11px] text-rose-600">{historyError}</p>
              : history === null ? <p className="text-[11px] text-gray-400">جاري التحميل…</p>
                : history.length === 0 ? <p className="text-[11px] text-gray-400">مفيش حاجة متسجّلة لسه.</p> : (
                  <ol className="space-y-1.5">
                    {history.map(note => (
                      <li key={note.id} className="flex gap-2 text-[11px]">
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 font-bold text-gray-600">{NOTE_KIND[note.kind] || note.kind}</span>
                        <span className="min-w-0 flex-1 whitespace-pre-line text-gray-700">{note.body}</span>
                        <span className="shrink-0 text-[10px] text-gray-400">{note.author_name || '—'} · <span>{fmtDateTime(note.created_at)}</span></span>
                      </li>
                    ))}
                  </ol>
                )}
          </div>
        )}
      </footer>
    </article>
  );
};

export default ApplicationCard;
