/**
 * Imported sheets name a course as free text ("دبلومة التربية الخاصة"), and
 * that text often matches no course in the catalogue — the course may be
 * retired, misspelled, or simply not created yet. Burying it in the notes
 * loses it: the desk asked for the course to show in the *course* column.
 *
 * So an unmatched name is stored in `interestedCourseIds` behind a `raw:`
 * prefix, alongside the existing `bundle:` convention. It renders as a course
 * badge, survives a round-trip, and can be swapped for a real course later —
 * but every place that needs an actual course id must filter it out first.
 */
export const RAW_COURSE_PREFIX = 'raw:';

export const isRawCourse = (id: string): boolean =>
  typeof id === 'string' && id.startsWith(RAW_COURSE_PREFIX);

export const rawCourseText = (id: string): string =>
  isRawCourse(id) ? id.slice(RAW_COURSE_PREFIX.length) : id;

export const toRawCourse = (text: string): string =>
  `${RAW_COURSE_PREFIX}${String(text || '').trim()}`;

/** Drop free-text entries — use wherever a real course id is required. */
export const realCourseIds = (ids: readonly string[] | undefined | null): string[] =>
  (ids || []).filter(id => !isRawCourse(id));

/**
 * Aggressive Arabic normalisation for matching a sheet's free-text course name
 * against the catalogue. A real export says "علم نفس متكامل"; the catalogue
 * calls the same thing "دبلومة علم النفس المتكامل". Plain lowercase-and-strip
 * matching sees two different strings, so 2,044 rows imported with no course
 * link at all. This folds the differences that never carry meaning here:
 * alef/ya/ta-marbuta variants, diacritics, the definite article, and the
 * packaging words (دبلومة / كورس / دورة …) that a course may or may not carry.
 */
const FILLER_WORDS = ['دبلومه', 'دبلوم', 'كورس', 'دوره', 'برنامج', 'شهاده', 'اعداد', 'احتراف'];

export function normalizeCourseName(value: string): string {
  let s = String(value || '')
    .replace(/^﻿/, '')
    .replace(/[ً-ْـ]/g, '')      // diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .toLowerCase();
  for (const word of FILLER_WORDS) s = s.split(word).join(' ');
  // Strip the definite article per token. A regex like /\bال/ cannot do this:
  // JS word boundaries are defined on [A-Za-z0-9_], so \b never fires between
  // two Arabic letters and "النفس" kept its article while "نفس" did not —
  // which is exactly why "علم نفس متكامل" failed to match the catalogue's
  // "دبلومة علم النفس المتكامل".
  return s
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => (token.length > 3 && token.startsWith('ال') ? token.slice(2) : token))
    .join('');
}

/**
 * Free-text course name → a real course id, a `bundle:` id, or null.
 * Bundles are searched too: the desk's sheets name packages as often as they
 * name single courses, and a bundle is a perfectly good thing to be interested in.
 */
export function matchCourseOrBundle(
  raw: string,
  courses: { id: string; title: string }[],
  bundles: { id: string; title: string }[] = [],
): string | null {
  const needle = normalizeCourseName(raw);
  if (needle.length < 3) return null;

  const exactCourse = courses.find(c => normalizeCourseName(c.title) === needle);
  if (exactCourse) return exactCourse.id;
  const exactBundle = bundles.find(b => normalizeCourseName(b.title) === needle);
  if (exactBundle) return `bundle:${exactBundle.id}`;

  const contains = (title: string) => {
    const hay = normalizeCourseName(title);
    return hay.length > 3 && (hay.includes(needle) || needle.includes(hay));
  };
  const partialCourse = courses.find(c => contains(c.title));
  if (partialCourse) return partialCourse.id;
  const partialBundle = bundles.find(b => contains(b.title));
  return partialBundle ? `bundle:${partialBundle.id}` : null;
}

/** Display label for any entry in `interestedCourseIds`. */
export function courseBadgeLabel(
  id: string,
  courses: { id: string; title: string }[],
  bundles: { id: string; title: string }[],
): string {
  if (isRawCourse(id)) return rawCourseText(id);
  if (id.startsWith('bundle:')) {
    const bundleId = id.replace('bundle:', '');
    return bundles.find(b => b.id === bundleId)?.title || bundles.find(b => b.id === id)?.title || id;
  }
  return courses.find(c => c.id === id)?.title || bundles.find(b => b.id === id)?.title || id;
}
