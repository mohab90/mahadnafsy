'use strict';

/**
 * The rules a website join application is read by — kept apart from the routes so
 * they can be pinned by unit tests.
 *
 * «في طلبات الانضمام في الموارد البشرية لازم تبقي عارف ان في طلبات انضمام موظف وفي
 * محاضر لازم تفرق بيينهم بشكل كبير … في صفحه تسجيل محاضر جديد محتاجين نزود سوال صح
 * او غلط هل عملت محاضر من قبل ,, وسوال هل عملت في جلسات نفسيه مع عملاء من قبل ؟؟
 * … محتاجين نخليه يختار اكتر من برنامج … لازم يكون في زر تقييم اول مكالمه»
 * (12 Oct 2026).
 */

const { cairoToday } = require('./dates');

const TYPES = new Set(['INSTRUCTOR', 'CONSULTANT', 'EMPLOYEE']);

/**
 * Which list an application belongs on, from the page it came through.
 *
 * `type` alone was not reliable: anything without a recognised type was filed as
 * INSTRUCTOR, so an employee's application could land among the lecturers. The
 * pages now say which form they are (`form`: 'teaching' for /join, 'staff' for
 * /join-us), and the form wins over the type: the staff page is always EMPLOYEE,
 * the teaching page is never EMPLOYEE. A caller that sends no form (a page cached
 * from before this) is read by its type, and one applying to a posting is staff —
 * only the staff page lists postings.
 */
function resolveApplicationKind({ form, type, jobId } = {}) {
  const sentType = String(type || '').toUpperCase();
  const sentForm = String(form || '').toLowerCase();
  if (sentForm === 'staff') return { type: 'EMPLOYEE', sourceForm: 'staff' };
  if (sentForm === 'teaching') {
    return { type: sentType === 'CONSULTANT' ? 'CONSULTANT' : 'INSTRUCTOR', sourceForm: 'teaching' };
  }
  if (TYPES.has(sentType)) return { type: sentType, sourceForm: sentType === 'EMPLOYEE' ? 'staff' : 'teaching' };
  if (jobId) return { type: 'EMPLOYEE', sourceForm: 'staff' };
  return { type: 'INSTRUCTOR', sourceForm: 'teaching' };
}

/** A yes/no answer as 1/0; anything else (unanswered) is null. */
function parseYesNo(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (['yes', 'true', '1', 'نعم', 'آه', 'اه'].includes(text)) return 1;
  if (['no', 'false', '0', 'لا'].includes(text)) return 0;
  return null;
}

const MAX_PROGRAMS = 80;

/**
 * The programmes a lecturer ticked, as ids. Titles are not taken from the
 * browser: the route reads them back from the tenant's published courses, so a
 * stored programme is one the institute actually offers.
 */
function programIdsFrom(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const ids = [];
  for (const item of list) {
    const id = String((item && typeof item === 'object' ? item.id : item) ?? '').trim().slice(0, 64);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_PROGRAMS) break;
  }
  return ids;
}

/** Stored programmes back as a list — tolerant of an empty or damaged cell. */
function readPrograms(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter(p => p && p.title).map(p => ({ id: p.id ? String(p.id) : null, title: String(p.title) }))
      : [];
  } catch { return []; }
}

/** The quick tags on «تقييم أول مكالمة». */
const FIRST_CALL_TAGS = Object.freeze([
  'الصوت والأسلوب', 'الخبرة', 'الالتزام بالمواعيد', 'الحماس', 'المعرفة العلمية', 'التوقعات المادية مناسبة',
]);

/** Validates a first-call rating; returns { error } or the clean values. */
function parseFirstCall(body = {}) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'التقييم لازم يكون من 1 لـ 5' };
  const tags = (Array.isArray(body.tags) ? body.tags : [])
    .map(tag => String(tag || '').trim())
    .filter((tag, index, all) => FIRST_CALL_TAGS.includes(tag) && all.indexOf(tag) === index);
  const notes = String(body.notes || '').trim().slice(0, 2000);
  return { rating, tags, notes };
}

const INTERVIEW_AT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/;

/**
 * An interview time as the desk enters it (Cairo wall clock, "YYYY-MM-DD HH:MM").
 * Returns { value } normalised for the DATETIME column, or { error }.
 *
 * A day before today is refused: «ليه لما بننقل عميل للانترفيو بيظهر في السابق»
 * (12 Oct 2026) — a date already gone is what put a just-moved candidate under
 * السابق, and scheduling is the only thing this is for.
 */
function parseInterviewAt(raw, now = new Date()) {
  const text = String(raw || '').trim();
  if (!text) return { value: null };
  const match = INTERVIEW_AT.exec(text);
  if (!match) return { error: 'صيغة الموعد لازم تكون YYYY-MM-DD HH:MM' };
  const [, day, hh, mm] = match;
  if (Number(hh) > 23 || Number(mm) > 59 || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())) {
    return { error: 'الموعد غير صالح' };
  }
  if (day < cairoToday(now)) return { error: 'الموعد ده فات — اختار النهارده أو يوم جاي', code: 'INTERVIEW_IN_THE_PAST' };
  return { value: `${day} ${hh}:${mm}:00` };
}

/**
 * The «LinkedIn / الموقع» box. The website takes whatever an anonymous visitor types
 * there and the HR screen opens it in one click, so `javascript:alert(1)` was a script
 * running in the HR officer's session. A bare address ("linkedin.com/in/x") becomes
 * https; any other scheme (javascript:, data:, mailto:, file:) or a `//host` jump is
 * refused. Returns the link, '' when there is none, or null when it is not a web link.
 */
function webAddress(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(raw) || raw.startsWith('/')) return null;
  const withScheme = `https://${raw}`;
  return /^https:\/\/[^\s"'<>]+$/.test(withScheme) ? withScheme : null;
}

module.exports = {
  FIRST_CALL_TAGS, MAX_PROGRAMS,
  parseFirstCall, parseInterviewAt, parseYesNo, programIdsFrom, readPrograms, resolveApplicationKind, webAddress,
};
