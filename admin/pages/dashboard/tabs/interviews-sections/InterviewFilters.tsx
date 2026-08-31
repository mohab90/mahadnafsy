import React from 'react';
import { Filter, RotateCcw } from 'lucide-react';

import { EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel } from '../hr-sections/applicantLabels';

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

/** Has this interview already happened? Undated means it has not. */
export const isPastInterview = (interviewAt: string | null | undefined, now = Date.now()): boolean => {
  if (!interviewAt) return false;
  const at = new Date(String(interviewAt).replace(' ', 'T')).getTime();
  return Number.isFinite(at) && at < now;
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
    { key: 'upcoming', label: 'القادم', hint: 'مقابلات لسه هتحصل، ومرشحون بدون موعد', count: timelineCounts.upcoming },
    { key: 'past', label: 'السابق', hint: 'المقابلات اللي اتعملت بالفعل', count: timelineCounts.past },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-3" dir="rtl">
      {/* Two tabs, above the filters and styled as tabs rather than chips: this
          splits the screen into two working lists, where everything below it
          narrows whichever list is open. */}
      <div className="flex items-center gap-1 border-b border-gray-200 -mx-3 px-3">
        {timelines.map(t => (
          <button
            key={t.key}
            onClick={() => set({ timeline: t.key })}
            title={t.hint}
            aria-current={value.timeline === t.key ? 'page' : undefined}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-bold transition ${
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600">
          <Filter size={14} className="text-violet-600" /> فلترة
        </span>
        {views.map(v => (
          <button
            key={v.key}
            onClick={() => set({ view: v.key })}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              value.view === v.key ? v.tone : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {v.label} ({v.count})
          </button>
        ))}
        {active && (
          <button
            onClick={() => onChange(emptyInterviewFilters())}
            className="mr-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-gray-500 hover:bg-gray-100"
          >
            <RotateCcw size={12} /> إلغاء الفلاتر
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-gray-500">الوظيفة</span>
          <select
            value={value.jobId}
            onChange={e => set({ jobId: e.target.value })}
            className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="">كل الوظائف</option>
            {jobs.map(j => (
              <option key={j.value} value={j.value}>{j.label} ({j.count})</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-gray-500">الخبرة (حد أدنى)</span>
          <select
            value={value.minExperience}
            onChange={e => set({ minExperience: e.target.value })}
            className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="">أي خبرة</option>
            {/* Fresh graduates are a deliberate search, not the bottom of a
                range, so they get their own option instead of being the
                minimum that matches everyone. */}
            <option value="only_none">بدون خبرة فقط</option>
            {EXPERIENCE_ORDER.filter(key => key !== 'none').map(key => (
              <option key={key} value={key}>{EXPERIENCE_YEARS[key]} فأكثر</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-gray-500">الفرع</span>
          <select
            value={value.branch}
            onChange={e => set({ branch: e.target.value })}
            className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="">كل الفروع</option>
            {branches.map(b => (
              <option key={b.value} value={b.value}>{branchLabel(b.value)} ({b.count})</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-gray-500">بحث بالاسم أو الهاتف</span>
          <input
            value={value.query}
            onChange={e => set({ query: e.target.value })}
            placeholder="اكتب اسم أو رقم..."
            className="w-full rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs"
          />
        </label>
        {extra}
      </div>

      {active && (
        <p className="text-[11px] font-bold text-gray-500">
          ظاهر {shown} من {counts.all} مرشح
        </p>
      )}
    </div>
  );
};

export default InterviewFilters;
