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
 * @param {string} raw            the name as written in the sheet
 * @param {Array<{id: string, title: string}>} courses  the catalogue
 * @returns {string|null} the course id, or null when nothing matches well enough
 */
function matchCourseId(raw, courses) {
  if (!raw || !Array.isArray(courses) || !courses.length) return null;
  const query = normalizeCourseTitle(raw);
  if (!query) return null;

  const exact = courses.find(course => normalizeCourseTitle(course.title) === query);
  if (exact) return exact.id;

  // Containment, but only for titles long enough that containing one is a real
  // signal. A three-letter title inside a long sentence is a coincidence.
  const contained = courses.find(course => {
    const title = normalizeCourseTitle(course.title);
    return title.length >= 6 && (title.includes(query) || query.includes(title));
  });
  if (contained) return contained.id;

  const queryWords = identifyingWords(raw);
  if (!queryWords.length) return null;

  let bestId = null;
  let bestOverlap = 0;
  let bestTitleWords = 0;
  for (const course of courses) {
    const titleWords = identifyingWords(course.title);
    if (!titleWords.length) continue;
    const overlap = queryWords.filter(
      word => titleWords.some(titleWord => titleWord.includes(word) || word.includes(titleWord))
    ).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestId = course.id;
      bestTitleWords = titleWords.length;
    }
  }

  // Both directions, so neither a long query nor a long title can swallow the
  // other on one shared word.
  const needFromQuery = Math.max(2, Math.ceil(queryWords.length * 0.5));
  const needFromTitle = Math.max(2, Math.ceil(bestTitleWords * 0.5));
  return (bestOverlap >= needFromQuery && bestOverlap >= needFromTitle) ? bestId : null;
}

module.exports = { matchCourseId, normalizeCourseTitle, identifyingWords, GENERIC_WORDS };
