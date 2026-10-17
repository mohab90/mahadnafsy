import React, { useState } from 'react';
import {
  Briefcase, Building2, CalendarClock, Clock, GraduationCap, Mail, MessageCircle, Phone, PhoneCall,
  Trash2, UserCheck, XCircle,
} from 'lucide-react';
import { waLink, toDisplay } from '../../../../lib/whatsappLink';
import { PHONE_RESULTS, branchLabel, fmtDateTime, yearsLabel } from '../hr-sections/applicantLabels';
import { KIND, KindBadge, YesNoBadge, kindOfApplicant } from '../join-us/joinUsUi';
import { isPastInterview } from './InterviewFilters';

export type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
export const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W'] as const;
export type Grade = typeof GRADES[number];

export const GRADE_TINT: Record<Grade, string> = {
  'A+': 'bg-emerald-50 text-emerald-700', A: 'bg-emerald-50 text-emerald-600',
  'B+': 'bg-sky-50 text-sky-700', B: 'bg-sky-50 text-sky-600',
  'C+': 'bg-amber-50 text-amber-700', C: 'bg-amber-50 text-amber-600',
  R: 'bg-red-50 text-red-600', W: 'bg-gray-100 text-gray-500',
};

export const GRADE_STYLE: Record<Grade, string> = {
  'A+': 'bg-emerald-600 text-white',
  A: 'bg-emerald-500 text-white',
  'B+': 'bg-sky-600 text-white',
  B: 'bg-sky-500 text-white',
  'C+': 'bg-amber-500 text-white',
  C: 'bg-amber-400 text-white',
  R: 'bg-red-600 text-white',
  W: 'bg-gray-500 text-white',
};

export interface JobApplicant {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage: Stage;
  stage_notes: string | null;
  interview_grade: Grade | null;
  second_interview_grade: Grade | null;
  interviewed_by_name: string | null;
  second_interviewed_by_name: string | null;
  interviewed_at: string | null;
  second_interviewed_at: string | null;
  source: string;
  specialty: string | null;
  applicant_type: string | null;
  job_title: string;
  job_branch: string | null;
  hired_staff_id: string | null;
  created_at: string;
  updated_at: string;
  /** From the application form — see migration 204. */
  applicant_branch: string | null;
  education: string | null;
  experience_years: string | null;
  experience_places: string | null;
  phone_interview_result: 'passed' | 'failed' | 'no_answer' | null;
  phone_interview_at: string | null;
  interview_at: string | null;
  /** From the website application, when there is one (12 Oct 2026). */
  source_form: 'teaching' | 'staff' | null;
  lectured_before: number | null;
  sessions_before: number | null;
  first_call_rating: number | null;
  /** The latest call from either screen, with who made it. */
  last_contact_note: string | null;
  last_contact_by: string | null;
  last_contact_at: string | null;
}

/** Held = graded: an interview with a grade has happened, whatever its date. */
export const gradedRow = (row: JobApplicant) => Boolean(row.interview_grade || row.second_interview_grade);

export interface InterviewActions {
  onGrade: (row: JobApplicant, grade: Grade, round: 1 | 2) => void;
  onSaveNote: (row: JobApplicant, note: string) => Promise<void>;
  onContact: (row: JobApplicant) => void;
  onOffer: (row: JobApplicant) => void;
  onHire: (row: JobApplicant) => void;
  onReject: (row: JobApplicant) => void;
  onRemove: (row: JobApplicant) => void;
}

/**
 * One candidate at the interview or offer stage, laid out like an application in
 * طلبات الانضمام: who and as what, how to reach them, what they answered, how the
 * interviews went and the next thing to do — with the kind's colour down the edge.
 *
 * «خلي تصميم الانترفيو شبه طلب الانضمام» (17 Oct 2026).
 */
const InterviewCard: React.FC<{ row: JobApplicant; busy: boolean; actions: InterviewActions }> = ({ row, busy, actions }) => {
  const kind = kindOfApplicant(row.applicant_type, row.source_form);
  const scheduled = fmtDateTime(row.interview_at);
  const phoneResult = row.phone_interview_result ? PHONE_RESULTS[row.phone_interview_result] : null;
  const branch = row.applicant_branch || row.job_branch;
  const offer = row.stage === 'offer';
  const graded = gradedRow(row);
  const dayGone = !graded && isPastInterview(row.interview_at);
  const [note, setNote] = useState<string | null>(null);
  const wa = waLink(row.phone, `أهلاً ${row.name}، معاك فريق الموارد البشرية في معهد الدراسات النفسية بخصوص المقابلة.`);
  const shownPhone = toDisplay(row.phone) || row.phone;
  const answers = row.lectured_before !== null || row.sessions_before !== null || row.first_call_rating;

  return (
    <article className={`overflow-hidden rounded-2xl border border-gray-200 border-r-[6px] ${KIND[kind].accent} bg-white shadow-sm`} data-kind={kind}>
      {/* 1. Who, as what, where — and where they stand. */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black leading-tight text-gray-900">{row.name}</h3>
            <KindBadge kind={kind} size="md" />
            {branch && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-bold text-white">
                <Building2 size={11} /> {branchLabel(branch)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-bold text-gray-600">
            {row.specialty || row.applicant_type || ''}
            {row.job_title && <span className="font-normal text-gray-400"> · {row.job_title}</span>}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-400"><Clock size={11} /> أُضيف {fmtDateTime(row.created_at) || '—'}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${offer ? 'bg-amber-100 text-amber-800' : 'bg-violet-100 text-violet-800'}`}>
            {offer ? 'مقبول للتدريب' : 'مقابلة'}
          </span>
          {phoneResult && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${phoneResult.tone}`}>{phoneResult.label}</span>}
          {row.source === 'website' && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">من الموقع</span>}
        </div>
      </header>

      {/* 2. How to reach them. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 px-4">
        {row.phone && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 py-1 pl-1 pr-2.5 text-sm font-bold text-gray-800">
            <Phone size={13} className="text-gray-500" />
            <span dir="ltr">{shownPhone}</span>
            <a href={`tel:${row.phone}`} title="اتصال"
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 md:px-2 md:py-1 md:text-[11px]">
              <PhoneCall size={11} /> اتصال
            </a>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" title="واتساب"
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 md:px-2 md:py-1 md:text-[11px]">
                <MessageCircle size={11} /> واتساب
              </a>
            )}
          </span>
        )}
        {row.email && (
          <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50" dir="ltr">
            <Mail size={12} /> {row.email}
          </a>
        )}
      </div>

      {/* 3. What the application said. */}
      <div className="mx-4 mt-3 space-y-2 rounded-xl bg-gray-50/80 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700">
            <Briefcase size={11} /> {yearsLabel(row.experience_years)}
          </span>
          {row.education && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700">
              <GraduationCap size={11} /> {row.education}
            </span>
          )}
          {answers && (
            <>
              <YesNoBadge label="اشتغل محاضر قبل كده" value={row.lectured_before} />
              <YesNoBadge label="جلسات نفسية مع عملاء" value={row.sessions_before} />
              {row.first_call_rating ? <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">أول مكالمة {row.first_call_rating}/5</span> : null}
            </>
          )}
        </div>
        {row.experience_places && <p title={row.experience_places} className="line-clamp-2 text-[11px] text-gray-600"><span className="font-bold">اشتغل قبل كده:</span> {row.experience_places}</p>}
      </div>

      {/* 4. The appointment, the grades and the calls. */}
      <div className="mt-2 grid gap-2 px-4">
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${
          scheduled ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-dashed border-gray-200 text-gray-400'}`}>
          <CalendarClock size={12} />
          {scheduled ? <>ميعاد الانترفيو: <span>{scheduled}</span></> : 'لسه من غير ميعاد'}
          {dayGone && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">عدّى ميعاده ولسه متقيّمش</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
          {([1, 2] as const).map(round => {
            const current = round === 1 ? row.interview_grade : row.second_interview_grade;
            const by = round === 1 ? row.interviewed_by_name : row.second_interviewed_by_name;
            const at = round === 1 ? row.interviewed_at : row.second_interviewed_at;
            return (
              <label key={round} className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-500">{round === 1 ? 'المقابلة الأولى' : 'المقابلة الثانية'}</span>
                <select
                  disabled={busy}
                  value={current || ''}
                  onChange={event => { const grade = event.target.value; if (grade) actions.onGrade(row, grade as Grade, round); }}
                  title={by ? `${by}${at ? ` · ${String(at).slice(0, 16).replace('T', ' ')}` : ''}` : 'لم يُقيَّم بعد'}
                  className={`h-7 cursor-pointer rounded-md border-0 px-1.5 text-xs font-black outline-none ${
                    current ? GRADE_STYLE[current] : 'bg-gray-100 text-gray-500'}`}
                >
                  <option value="">—</option>
                  {GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}
                </select>
                {by && <span className="text-[10px] text-gray-400">{by}</span>}
              </label>
            );
          })}
        </div>
        {row.last_contact_at && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
            <span className="font-black">آخر تواصل</span>
            <span className="mx-1 text-[10px] text-sky-700">{fmtDateTime(row.last_contact_at)}</span>
            {row.last_contact_by && <span className="text-sky-700">بواسطة {row.last_contact_by}</span>}
            {row.last_contact_note && <span title={row.last_contact_note} className="mt-1 line-clamp-2 block">{row.last_contact_note}</span>}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            value={note ?? row.stage_notes ?? ''}
            onChange={event => setNote(event.target.value)}
            placeholder="ملاحظات المقابلة..."
            className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-sm"
          />
          <button
            disabled={busy || note === null}
            onClick={() => { void actions.onSaveNote(row, note ?? '').then(() => setNote(null)); }}
            className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-40"
          >
            حفظ
          </button>
        </div>
      </div>

      {/* 5. The next thing to do. */}
      <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
        <button disabled={busy} onClick={() => actions.onContact(row)}
          className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40">
          <Phone size={13} /> تواصل
        </button>
        {!offer && (
          <button disabled={busy} onClick={() => actions.onOffer(row)}
            className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-40">
            عرض وظيفي
          </button>
        )}
        {offer && (
          <button disabled={busy} onClick={() => actions.onHire(row)}
            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
            <UserCheck size={13} /> تعيين
          </button>
        )}
        <button disabled={busy} onClick={() => actions.onReject(row)}
          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40">
          <XCircle size={13} /> رفض
        </button>
        <button disabled={busy} onClick={() => actions.onRemove(row)} title="حذف نهائي من الانترفيوهات"
          className="mr-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
          <Trash2 size={12} /> حذف
        </button>
      </footer>
    </article>
  );
};

// A list draws many of these; with stable `actions` only the card that changed redraws.
export default React.memo(InterviewCard);
