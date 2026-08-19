import React from 'react';
import { Filter, RotateCcw } from 'lucide-react';

import { EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel } from '../hr-sections/applicantLabels';

export type InterviewFilterState = {
  jobId: string;
  minExperience: string;
  branch: string;
  view: 'all' | 'interview' | 'offer';
  query: string;
};

export const emptyInterviewFilters = (): InterviewFilterState => ({
  jobId: '', minExperience: '', branch: '', view: 'all', query: '',
});

export const interviewFiltersActive = (f: InterviewFilterState): boolean =>
  Boolean(f.jobId || f.minExperience || f.branch || f.query.trim()) || f.view !== 'all';

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
  shown: number;
}> = ({ value, onChange, jobs, branches, counts, shown }) => {
  const set = (patch: Partial<InterviewFilterState>) => onChange({ ...value, ...patch });
  const active = interviewFiltersActive(value);

  const views: Array<{ key: InterviewFilterState['view']; label: string; count: number; tone: string }> = [
    { key: 'all', label: 'الكل', count: counts.all, tone: 'bg-gray-800 text-white' },
    { key: 'interview', label: 'في المقابلات', count: counts.interview, tone: 'bg-indigo-600 text-white' },
    { key: 'offer', label: 'المقبولون', count: counts.offer, tone: 'bg-emerald-600 text-white' },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-3" dir="rtl">
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
