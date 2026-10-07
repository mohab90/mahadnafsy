/**
 * One search for every list of people — «البحث في السيستم كله محتاجه يكون اكبر
 * شوية وافضل لانه اوقات بيطلع نتايج مختلفة في العملاء المحتملين وقاعده العملاء
 * والاونلاين والدقي … لما اكتب اول حرفين يظهر» (7 Oct 2026).
 *
 * Each screen matched its own fields by its own rules: the online and Dokki
 * lists and the leads never matched a client code, none read «احمد» as «أحمد»,
 * and a number typed with its 0 («0101…») missed the «101…» the leads are
 * stored as. The server's searches read it the same way (api/lib/searchText.js).
 */

export const SEARCH_MIN_CHARS = 2;

const LETTER_FOLDS: Array<[RegExp, string]> = [
  [/[أإآٱ]/g, 'ا'], [/ى/g, 'ي'], [/ة/g, 'ه'], [/ؤ/g, 'و'], [/ئ/g, 'ي'],
];

/** Lower case, Arabic letters in one spelling, Arabic-Indic digits as 0–9, no diacritics or tatweel. */
export function foldText(value: unknown): string {
  let text = String(value ?? '')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '');
  for (const [pattern, letter] of LETTER_FOLDS) text = text.replace(pattern, letter);
  return text.replace(/\s+/g, ' ').trim();
}

const digitsOf = (value: unknown) => foldText(value).replace(/\D/g, '');

export interface SearchFields {
  name?: string | null;
  phone?: string | null;
  phones?: Array<string | null | undefined>;
  email?: string | null;
  code?: string | null;
  nationalId?: string | null;
  /** Anything else the list lets one find a person by (notes, a course title). */
  extra?: Array<string | null | undefined>;
}

/** Does this person answer the search box? Under two characters every row does. */
export function matchesSearch(query: string, fields: SearchFields): boolean {
  const q = foldText(query);
  if (q.length < SEARCH_MIN_CHARS) return true;
  if ([fields.name, fields.email, fields.code, ...(fields.extra || [])].some(value => foldText(value).includes(q))) return true;
  // A number: matched on digits, with or without the 0 it was typed with.
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3 || digits.length !== q.replace(/[\s+\-()]/g, '').length) return false;
  const core = digits.replace(/^0+/, '') || digits;
  return [fields.phone, ...(fields.phones || []), fields.nationalId, fields.code]
    .some(value => { const stored = digitsOf(value); return Boolean(stored) && (stored.includes(digits) || stored.includes(core)); });
}
