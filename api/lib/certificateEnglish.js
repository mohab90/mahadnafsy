'use strict';

// The institute's certificate carries the client's name and the course's name in
// ENGLISH ONLY — «اسم العميل واسم الكورس بالانجليزي فقط مينفعش بالعربي في الشهادة
// دي» (13 Oct 2026). The printable certificate fell back to the Arabic name (and
// the Arabic course title) when the English one was missing, and printed it.
//
// Now a certificate with no English name, or whose course has no English title,
// is not printed: it says which one is missing and where to add it.

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
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

module.exports = { isEnglish, certificateName, certificateCourse, missingForCertificate };
