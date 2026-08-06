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
