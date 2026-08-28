'use strict';

/**
 * Matching a course name written by a human to a course in the catalogue.
 *
 * Two copies of this existed — one in lib/sheets.js and a weaker one in
 * routes/gsheets.js — so the automatic sync and the manual import disagreed
 * about what a lead was interested in. They share this now.
 *
 * What went wrong before: the sheets carry course names with underscores for
 * spaces ("فن_الكلام_والتاثير_للمدربين_والموثرين"). Nothing converted them, so
 * the whole name stayed one token, and the word-overlap fallback needed at
 * least two overlapping words — a bar a single token can never clear. 472 leads
 * carried a course name that never reached interested_course_ids_json.
 *
 * The other half is spelling. The sheets write "والتاثير" where the catalogue
 * has "والتأثير", and "سنه" for "سنة". Arabic hamza forms, ta marbuta and alef
 * maqsura are folded so those meet.
 *
 * Some imported rows carry corrupted bytes (U+FFFD) from an encoding fault
 * upstream; those characters are dropped so a damaged name still matches on the
 * words that survived.
 *
 * The overlap rule is deliberately stricter than what it replaces. The old one
 * asked only that the QUERY be mostly covered, which let any name beginning
 * with "دبلومة" land on "دبلومة اضطراب طيف التوحد والتدخل المبكر" — a wrong
 * course on a lead is worse than an empty field, because nobody goes looking
 * for it. Both sides must now agree, and words that identify nothing are not
 * counted at all.
 */

// Words that carry no identity: every diploma is a "دبلومة".
const GENERIC_WORDS = new Set([
  'دبلومه', 'دوره', 'كورس', 'برنامج', 'المحترف', 'احتراف', 'مستوي', 'اونلاين',
]);

/**
 * Fold a title to the form both sides are compared in.
 * Underscores become spaces because that is what the sheets use as a separator.
 */
function normalizeCourseTitle(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[ً-ٟـ]/g, '')  // diacritics and tatweel
    .replace(/�/g, '')                  // corrupted bytes from the import
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_\-()"'.,،/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words in a title that actually identify it. */
function identifyingWords(value) {
  return normalizeCourseTitle(value)
    .split(/\s+/)
    .filter(word => word.length > 2 && !GENERIC_WORDS.has(word));
}

/**
 * Free-text course name → a course id, a `bundle:<id>`, or null.
 *
 * Bundles are searched as well as courses. The sheets name learning paths as
 * often as single ones — "دبلومة المعالج النفسي المحترف" is a bundle of four —
 * and searching only courses left 208 leads with nothing recorded at all, for a
 * path the catalogue already had. The `bundle:` prefix is the convention
 * interested_course_ids_json already stores and the admin UI already reads.
 *
 * Courses win ties: a name that is both a course title and part of a bundle
 * title is more likely to mean the course.
 *
 * @param {string} raw
 * @param {Array<{id: string, title: string}>} courses
 * @param {Array<{id: string, title: string}>} [bundles]
 * @returns {string|null}
 */
function matchCourseId(raw, courses, bundles = []) {
  const courseList = Array.isArray(courses) ? courses : [];
  const bundleList = Array.isArray(bundles) ? bundles : [];
  if (!raw || (!courseList.length && !bundleList.length)) return null;
  const query = normalizeCourseTitle(raw);
  if (!query) return null;

  const asId = (entry) => (entry.kind === 'bundle' ? `bundle:${entry.item.id}` : entry.item.id);
  const candidates = [
    ...courseList.map(item => ({ item, kind: 'course' })),
    ...bundleList.map(item => ({ item, kind: 'bundle' })),
  ];

  const exact = candidates.find(c => normalizeCourseTitle(c.item.title) === query);
  if (exact) return asId(exact);

  // Containment, but only for titles long enough that containing one is a real
  // signal. A three-letter title inside a long sentence is a coincidence.
  const contained = candidates.find(c => {
    const title = normalizeCourseTitle(c.item.title);
    return title.length >= 6 && (title.includes(query) || query.includes(title));
  });
  if (contained) return asId(contained);

  const queryWords = identifyingWords(raw);
  if (!queryWords.length) return null;

  let best = null;
  let bestOverlap = 0;
  let bestTitleWords = 0;
  // Characters matched, not just words. Two candidates can tie on word count
  // while one of them agreed on the word that actually identifies the thing:
  // "دبلومة اللايف كوتش الايجابي المحترف" overlaps the course "احتراف اللايف
  // كوتشينج" and the bundle "الكوتش الإيجابي المحترف" on two words each, but
  // the bundle is the one that matched الايجابي. Longer words carry more
  // identity, so the tie goes to whichever agreed on more of them.
  let bestChars = 0;
  for (const candidate of candidates) {
    const titleWords = identifyingWords(candidate.item.title);
    if (!titleWords.length) continue;
    const matched = queryWords.filter(
      word => titleWords.some(titleWord => titleWord.includes(word) || word.includes(titleWord))
    );
    const overlap = matched.length;
    const chars = matched.reduce((sum, word) => sum + word.length, 0);
    if (overlap > bestOverlap || (overlap === bestOverlap && chars > bestChars)) {
      bestOverlap = overlap;
      bestChars = chars;
      best = candidate;
      bestTitleWords = titleWords.length;
    }
  }
  if (!best) return null;

  // Both directions, so neither a long query nor a long title can swallow the
  // other on one shared word.
  const needFromQuery = Math.max(2, Math.ceil(queryWords.length * 0.5));
  const needFromTitle = Math.max(2, Math.ceil(bestTitleWords * 0.5));
  return (bestOverlap >= needFromQuery && bestOverlap >= needFromTitle) ? asId(best) : null;
}

module.exports = { matchCourseId, normalizeCourseTitle, identifyingWords, GENERIC_WORDS };
