'use strict';

// The institute's certificate carries the client's name and the course's name in
// ENGLISH ONLY — «اسم العميل واسم الكورس بالانجليزي فقط مينفعش بالعربي في الشهادة
// دي» (13 Oct 2026). The printable certificate fell back to the Arabic name (and
// the Arabic course title) when the English one was missing, and printed it.
//
// Now a certificate with no English name, or whose course has no English title,
// is not printed: it says which one is missing and where to add it.

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const HAS_LETTER = /[A-Za-z]/;

/** English text: it has Latin letters and no Arabic ones. */
function isEnglish(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 && HAS_LETTER.test(text) && !ARABIC.test(text);
}

/** The client's English name as the certificate prints it (upper case), or null. */
function certificateName(nameEn) {
  return isEnglish(nameEn) ? String(nameEn).replace(/\s+/g, ' ').trim().toUpperCase() : null;
}

/** The course's English title: the English title, else the main title when it is English; or null. */
function certificateCourse({ title_en: titleEn, title } = {}) {
  if (isEnglish(titleEn)) return String(titleEn).replace(/\s+/g, ' ').trim();
  if (isEnglish(title)) return String(title).replace(/\s+/g, ' ').trim();
  return null;
}

/** What is missing before this certificate can be printed, in Arabic for the desk. */
function missingForCertificate({ nameEn, courseTitleEn, courseTitle }) {
  const missing = [];
  if (!certificateName(nameEn)) missing.push('الاسم بالإنجليزي للعميل');
  if (!certificateCourse({ title_en: courseTitleEn, title: courseTitle })) missing.push('اسم الكورس بالإنجليزي');
  return missing;
}

const squeeze = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** A duration as the certificate prints it: English («60 Hours», «6 Months»), or '' . */
function certificateDuration(value, hours) {
  const typed = squeeze(value);
  if (typed) return typed.length <= 80 && !ARABIC.test(typed) ? typed : '';
  const count = Number(hours);
  return count > 0 ? `${+count.toFixed(2)} Hours` : '';
}

/**
 * What one certificate prints: the desk's own change when there is one, else what the
 * client's file and the course say. `row` carries the course_completions cert_* columns
 * and name_en / course titles / hours / instructor_name. A change that is not English is
 * ignored for the name and the course (the English-only rule holds for edits too).
 */
function effectiveCertificate(row = {}) {
  const name = certificateName(row.cert_name_en) || certificateName(row.name_en);
  const course = certificateCourse({ title_en: row.cert_course_en })
    || certificateCourse({ title_en: row.course_title_en, title: row.course_title });
  return {
    name,
    course,
    duration: certificateDuration(row.cert_duration, row.hours),
    trainer: squeeze(row.cert_trainer) || squeeze(row.instructor_name),
  };
}

module.exports = { isEnglish, certificateName, certificateCourse, missingForCertificate, certificateDuration, effectiveCertificate };
