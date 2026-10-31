'use strict';

// The rules tools/link-site-accounts.cjs matches a site account to a client record by when it has to go by the NAME. Kept here so a test
// can hold them: the sheets and the sign-up form spell the same Arabic name differently (أحمد / احمد, فاطمة / فاطمه, ى / ي, diacritics, a
// stretched letter, two spaces), and a match on the raw text would miss most of them.

/** An Arabic (or Latin) full name reduced to what it says: the same for every spelling a person might give it. */
function normalizeArabicName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '') // diacritics and the stretched letter
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = { normalizeArabicName };
