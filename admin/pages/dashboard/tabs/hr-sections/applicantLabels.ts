// The words for an applicant's stored codes, in one place.
//
// The application form, the job's applicant list and the interviews screen all
// display the same six experience bands, the same branches and the same six
// pipeline stages. Kept as three copies they drift: one screen says "بدون خبرة"
// while another shows a raw `none`, and a filter built on one copy silently
// fails to match rows labelled by another.

/** Must match the options in client/pages/JoinStaff.tsx. */
export const EXPERIENCE_YEARS: Record<string, string> = {
  none: 'بدون خبرة',
  under_1: 'أقل من سنة',
  '1-3': '1 – 3 سنوات',
  '3-5': '3 – 5 سنوات',
  '5-10': '5 – 10 سنوات',
  '10plus': 'أكثر من 10 سنوات',
};

/** Branch keys as stored in `branches.branch_key`. */
export const BRANCH_LABELS: Record<string, string> = {
  daqqi: 'الدقي',
  tagamoa: 'التجمع الخامس',
  tanta_admin: 'طنطا الإداري',
  online_egypt: 'أونلاين',
  online_saudi: 'أونلاين سعودي',
  online_abroad: 'أونلاين دولي',
};

export const STAGE_LABELS: Record<string, { label: string; tone: string }> = {
  applied: { label: 'جديد', tone: 'bg-sky-100 text-sky-700' },
  screening: { label: 'فرز', tone: 'bg-amber-100 text-amber-700' },
  interview: { label: 'مقابلة', tone: 'bg-indigo-100 text-indigo-700' },
  offer: { label: 'مقبول', tone: 'bg-emerald-100 text-emerald-700' },
  hired: { label: 'تم التعيين', tone: 'bg-emerald-600 text-white' },
  rejected: { label: 'مرفوض', tone: 'bg-rose-100 text-rose-700' },
};

export const PHONE_RESULTS: Record<string, { label: string; tone: string }> = {
  passed: { label: 'فون انترفيو ناجح', tone: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'فون انترفيو مرفوض', tone: 'bg-rose-100 text-rose-700' },
  no_answer: { label: 'لم يرد', tone: 'bg-gray-200 text-gray-700' },
};

/**
 * Experience ordered weakest to strongest, so "3 سنوات فأكثر" can mean a range
 * and not a list of checkboxes. Anything unrecognised sorts to the bottom
 * rather than being treated as senior.
 */
export const EXPERIENCE_ORDER = ['none', 'under_1', '1-3', '3-5', '5-10', '10plus'];

export const experienceRank = (value: string | null | undefined): number => {
  const index = EXPERIENCE_ORDER.indexOf(String(value || ''));
  return index === -1 ? -1 : index;
};

export const yearsLabel = (value: string | null | undefined): string =>
  (value && EXPERIENCE_YEARS[value]) || 'خبرة غير محددة';

/**
 * Does this candidate's experience pass the picker's setting?
 *
 * `''` is no filter. `only_none` is the deliberate search for fresh graduates.
 * Anything else is a MINIMUM — "3 سنوات فأكثر" — because that is the question
 * hiring asks, never "exactly the 3–5 band".
 *
 * A candidate whose experience was never recorded fails a minimum rather than
 * passing it: unknown is not senior. Both recruitment screens use this, so the
 * same setting cannot mean two different things depending on where you set it.
 */
export const matchesMinExperience = (
  value: string | null | undefined,
  min: string,
): boolean => {
  if (!min) return true;
  if (min === 'only_none') return value === 'none';
  const rank = experienceRank(value);
  return rank >= 0 && rank >= experienceRank(min);
};

export const branchLabel = (value: string | null | undefined): string =>
  (value && BRANCH_LABELS[value]) || value || '';
