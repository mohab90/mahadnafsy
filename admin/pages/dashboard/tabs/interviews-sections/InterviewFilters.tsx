import React from 'react';
import { RotateCcw, Search } from 'lucide-react';

import { EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel, cairoDayOf } from '../hr-sections/applicantLabels';
import { cairoDateOnly } from '../../../../../shared/cairoDate';

export type InterviewFilterState = {
  jobId: string;
  minExperience: string;
  branch: string;
  view: 'all' | 'interview' | 'offer';
  /**
   * Before or after the appointment — a different question from `view`.
   *
   * `view` asks what stage someone is at; this asks whether their interview has
   * happened yet. They are independent: a candidate at offer stage still has a
   * past interview, and one at interview stage may be scheduled for next week.
   * Collapsing them into one control would make "المقبولون" unreachable while
   * looking at last week.
   *
   * An undated candidate counts as upcoming. They have not been interviewed, so
   * putting them under السابق — "اللى اتعملت بالفعل" — would be a lie about
   * work that has not been done.
   */
  timeline: 'upcoming' | 'past';
  query: string;
};

export const emptyInterviewFilters = (): InterviewFilterState => ({
  jobId: '', minExperience: '', branch: '', view: 'all', timeline: 'upcoming', query: '',
});

// timeline is deliberately absent: it is a tab, not a filter. Counting it as
// "active" would light up the reset control the moment the screen loads and
// make القادم look like a narrowing someone had applied by accident.
export const interviewFiltersActive = (f: InterviewFilterState): boolean =>
  Boolean(f.jobId || f.minExperience || f.branch || f.query.trim()) || f.view !== 'all';

/**
 * Has this interview already happened? Undated means it has not.
 *
 * «ليه لما بننقل عميل للانترفيو بيظهر في السابق» (12 Oct 2026). This compared the
 * appointment with the current minute, and the times it was given were often
 * already behind it: the job's applicant list booked every interview at a fixed
 * 10:00, the move dialog took a typed 24-hour time (an afternoon «03:00» is three
 * in the morning), and the driver handed Cairo wall-clock times back as UTC. A
 * candidate moved for an interview later today went straight to السابق.
 *
 * An interview is past once it has a grade — it was held — or once its day is
 * over. Today's interviews stay under القادم all day.
 */
export const isPastInterview = (
  interviewAt: string | null | undefined,
  options: { graded?: boolean; now?: Date } = {},
): boolean => {
  if (options.graded) return true;
  if (!interviewAt) return false;
  const day = cairoDayOf(interviewAt);
  return Boolean(day) && day < cairoDateOnly(options.now ?? new Date());
};

type Option = { value: string; label: string; count: number };

/**
 * Narrowing a list of candidates down to the ones this session is about.
 *
 * The screen showed every candidate at interview or offer stage in one flat
 * list, which is the right list to have and the wrong one to sit in front of
 * when you are interviewing for a single role this afternoon. Experience is a
 * minimum rather than an exact match — hiring asks "three years or more", never
 * "exactly the 3–5 band".
 */
export const InterviewFilters: React.FC<{
  value: InterviewFilterState;
  onChange: (next: InterviewFilterState) => void;
  jobs: Option[];
  branches: Option[];
  counts: { all: number; interview: number; offer: number };
  /** Tallies for the القادم / السابق tabs, counted before the other filters. */
  timelineCounts: { upcoming: number; past: number };
  shown: number;
  /** Rendered inline with the other filters — keeps the grade filter in the same bar. */
  extra?: React.ReactNode;
}> = ({ value, onChange, jobs, branches, counts, timelineCounts, shown, extra }) => {
  const set = (patch: Partial<InterviewFilterState>) => onChange({ ...value, ...patch });
  const active = interviewFiltersActive(value);

  const views: Array<{ key: InterviewFilterState['view']; label: string; count: number; tone: string }> = [
    { key: 'all', label: 'الكل', count: counts.all, tone: 'bg-gray-800 text-white' },
    { key: 'interview', label: 'في المقابلات', count: counts.interview, tone: 'bg-indigo-600 text-white' },
    { key: 'offer', label: 'المقبولون', count: counts.offer, tone: 'bg-emerald-600 text-white' },
  ];

  const timelines: Array<{ key: InterviewFilterState['timeline']; label: string; hint: string; count: number }> = [
    { key: 'upcoming', label: 'واخدين ميعاد ولسه موعدهم', hint: 'مقابلات لسه هتحصل، ومرشحون لسه من غير ميعاد', count: timelineCounts.upcoming },
    { key: 'past', label: 'حضروا الانترفيو', hint: 'اتقيّموا، أو عدّى يوم ميعادهم', count: timelineCounts.past },
  ];

  const select = 'h-7 shrink-0 rounded-lg border border-gray-200 bg-white px-2 text-[11px]';
  return (
    <div className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-2" dir="rtl">
      {/* Two tabs, styled as tabs rather than chips: this splits the page into two working lists, where
          everything below narrows whichever list is open. */}
      <div className="no-scrollbar -mx-2 flex items-center gap-1 overflow-x-auto border-b border-gray-200 px-2">
        {timelines.map(t => (
          <button
            key={t.key}
            onClick={() => set({ timeline: t.key })}
            title={t.hint}
            aria-current={value.timeline === t.key ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-bold transition ${
              value.timeline === t.key
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${
              value.timeline === t.key ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Everything that narrows the list, in ONE row (it scrolls sideways on a phone). */}
      <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto md:flex-wrap md:overflow-visible">
        {views.map(v => (
          <button
            key={v.key}
            onClick={() => set({ view: v.key })}
            className={`inline-flex min-h-[32px] shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold md:min-h-0 transition ${
              value.view === v.key ? v.tone : 'bg-gray-50 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'}`}
          >
            {v.label} {v.count}
          </button>
        ))}
        <span className="relative min-w-[130px] flex-1">
          <Search size={12} className="absolute right-2 top-2 text-gray-400" />
          <input
            value={value.query}
            onChange={e => set({ query: e.target.value })}
            aria-label="بحث بالاسم أو الهاتف"
            placeholder="بحث: اسم أو رقم"
            className="h-7 w-full rounded-lg border border-gray-200 pr-7 text-[11px]"
          />
        </span>
        <select value={value.jobId} onChange={e => set({ jobId: e.target.value })} aria-label="الوظيفة" title="الوظيفة" className={`${select} max-w-[150px]`}>
          <option value="">كل الوظائف</option>
          {jobs.map(j => <option key={j.value} value={j.value}>{j.label} ({j.count})</option>)}
        </select>
        <select value={value.branch} onChange={e => set({ branch: e.target.value })} aria-label="الفرع" title="الفرع" className={select}>
          <option value="">كل الفروع</option>
          {branches.map(b => <option key={b.value} value={b.value}>{branchLabel(b.value)} ({b.count})</option>)}
        </select>
        {/* Fresh graduates are a deliberate search, not the bottom of a range, so they get their own option. */}
        <select value={value.minExperience} onChange={e => set({ minExperience: e.target.value })} aria-label="الخبرة (حد أدنى)" title="الخبرة (حد أدنى)" className={select}>
          <option value="">أي خبرة</option>
          <option value="only_none">بدون خبرة فقط</option>
          {EXPERIENCE_ORDER.filter(key => key !== 'none').map(key => (
            <option key={key} value={key}>{EXPERIENCE_YEARS[key]} فأكثر</option>
          ))}
        </select>
        {extra}
        {active && (
          <button onClick={() => onChange({ ...emptyInterviewFilters(), timeline: value.timeline })} title="إلغاء الفلاتر" aria-label="إلغاء الفلاتر"
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><RotateCcw size={13} /></button>
        )}
        {active && <span className="shrink-0 text-[11px] font-bold text-gray-500">{shown} من {counts.all}</span>}
      </div>
    </div>
  );
};

export default InterviewFilters;
