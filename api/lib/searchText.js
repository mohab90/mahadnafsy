'use strict';

// A search box, read the way the panel reads it (admin/lib/clientSearch.ts):
// Arabic letters in one spelling, Arabic-Indic digits as 0–9, a number matched
// with or without the 0 it was typed with. «احمد» did not find «أحمد», and
// «0101…» did not find a lead stored as «101…» — «اوقات بيطلع نتايج مختلفة»
// (7 Oct 2026).

const SEARCH_MIN_CHARS = 2;
const LETTER_FOLDS = [['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ٱ', 'ا'], ['ى', 'ي'], ['ة', 'ه'], ['ؤ', 'و'], ['ئ', 'ي']];

function foldText(value) {
  let text = String(value ?? '')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '');
  for (const [from, to] of LETTER_FOLDS) text = text.split(from).join(to);
  return text.replace(/\s+/g, ' ').trim();
}

/** The column, lower-cased with its Arabic letters in the one spelling — for LIKE against foldText(q). */
function foldedSql(column) {
  return LETTER_FOLDS.reduce((sql, [from, to]) => `REPLACE(${sql}, '${from}', '${to}')`, `LOWER(COALESCE(${column}, ''))`);
}

/** The digits of a query that is a number (three or more), and the same without its leading zeros; else null. */
function searchNumber(query) {
  const text = foldText(query);
  const digits = text.replace(/\D/g, '');
  if (digits.length < 3 || digits.length !== text.replace(/[\s+\-()]/g, '').length) return null;
  return { digits, core: digits.replace(/^0+/, '') || digits };
}

module.exports = { SEARCH_MIN_CHARS, foldText, foldedSql, searchNumber };
