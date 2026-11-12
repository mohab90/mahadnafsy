/**
 * The Egyptian national ID number, checked in one place.
 *
 * Imported by the browser (to say «الرقم ده مش مظبوط» before a request) and mirrored by
 * api/lib/egyptianNationalId.js for the server, which is the side that decides — the two are kept
 * identical by api/tests/pricingNationalIdParity.test.js.
 *
 * Layout: C YYMMDD GG SSSS X — century digit (2 = 1900s, 3 = 2000s), birth date, governorate of
 * birth, a serial and a check digit. The check digit's rule is not published reliably, so it is NOT
 * checked here and none is invented.
 */

export const GOVERNORATES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'القاهرة', '02': 'الإسكندرية', '03': 'بورسعيد', '04': 'السويس',
  '11': 'دمياط', '12': 'الدقهلية', '13': 'الشرقية', '14': 'القليوبية', '15': 'كفر الشيخ', '16': 'الغربية',
  '17': 'المنوفية', '18': 'البحيرة', '19': 'الإسماعيلية', '21': 'الجيزة', '22': 'بني سويف', '23': 'الفيوم',
  '24': 'المنيا', '25': 'أسيوط', '26': 'سوهاج', '27': 'قنا', '28': 'أسوان', '29': 'الأقصر',
  '31': 'البحر الأحمر', '32': 'الوادي الجديد', '33': 'مطروح', '34': 'شمال سيناء', '35': 'جنوب سيناء',
  '88': 'مولود في الخارج',
});

export type NationalIdProblem = 'EMPTY' | 'LENGTH' | 'CENTURY' | 'BIRTH_DATE' | 'GOVERNORATE' | 'REPEATED';
export type NationalIdResult =
  | { ok: true; value: string; birthDate: string; governorate: string; governorateCode: string }
  | { ok: false; problem: NationalIdProblem };

/** Digits only, Latin: Arabic-Indic and Persian digits become 0-9; spaces and dashes are dropped. */
export function normalizeNationalId(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s-]/g, '');
}

export function checkEgyptianNationalId(raw: unknown, now: Date = new Date()): NationalIdResult {
  const value = normalizeNationalId(raw);
  if (!value) return { ok: false, problem: 'EMPTY' };
  if (!/^\d{14}$/.test(value)) return { ok: false, problem: 'LENGTH' };
  if (/^(\d)\1{13}$/.test(value)) return { ok: false, problem: 'REPEATED' };
  const century = value[0] === '2' ? 1900 : value[0] === '3' ? 2000 : null;
  if (century == null) return { ok: false, problem: 'CENTURY' };
  const year = century + Number(value.slice(1, 3));
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day || born.getTime() > now.getTime()) {
    return { ok: false, problem: 'BIRTH_DATE' };
  }
  const governorateCode = value.slice(7, 9);
  const governorate = GOVERNORATES[governorateCode];
  if (!governorate) return { ok: false, problem: 'GOVERNORATE' };
  return { ok: true, value, birthDate: born.toISOString().slice(0, 10), governorate, governorateCode };
}

/** What a visitor is told, in the checkout's own tone. */
export const NATIONAL_ID_MESSAGES: Readonly<Record<NationalIdProblem, string>> = Object.freeze({
  EMPTY: 'اكتب الرقم القومي',
  LENGTH: 'الرقم القومي لازم يكون 14 رقم',
  CENTURY: 'الرقم القومي ده مش مظبوط — راجعه تاني',
  BIRTH_DATE: 'الرقم القومي ده مش مظبوط — راجعه تاني',
  GOVERNORATE: 'الرقم القومي ده مش مظبوط — راجعه تاني',
  REPEATED: 'الرقم القومي ده مش مظبوط — راجعه تاني',
});

/** «***********123» — the last three digits only. */
export const maskNationalId = (value: string): string => (value.length > 3 ? `${'*'.repeat(value.length - 3)}${value.slice(-3)}` : value);
