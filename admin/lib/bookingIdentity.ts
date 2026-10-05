// The client's real name at the booking desk — the browser mirror of
// api/lib/bookingIdentity.js, so the dialog says what is wrong before the
// server refuses it.

const ARABIC_WORD = /^[ء-ي٠-٩ٱ-ۓۺ-ۿ]+$/;
const LATIN_NAME = /^[A-Za-z][A-Za-z .'-]*$/;

const clean = (value: string | null | undefined) => String(value ?? '')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** '' when the name is a full Arabic triple name, else what is wrong with it. */
export function arabicNameProblem(raw: string | null | undefined): string {
  const name = clean(raw);
  if (!name) return 'اسم العميل بالعربي (ثلاثي) مطلوب';
  const words = name.split(' ');
  if (!words.every(word => ARABIC_WORD.test(word))) return 'الاسم بالعربي لازم يكون حروف عربي بس';
  const names: string[] = [];
  for (const word of words) {
    if (names.length && /^(عبد|ابو|أبو)$/.test(names[names.length - 1])) names[names.length - 1] += ` ${word}`;
    else names.push(word);
  }
  if (names.length < 3) return 'الاسم بالعربي لازم يكون ثلاثي (الاسم واسم الأب واسم الجد)';
  if (names.some(part => part.replace(/\s/g, '').length < 2)) return 'في جزء من الاسم حرف واحد بس — اكتب الاسم كامل';
  return '';
}

export function englishNameProblem(raw: string | null | undefined): string {
  const name = clean(raw);
  if (!name) return '';
  if (!LATIN_NAME.test(name)) return 'الاسم بالإنجليزي لازم يكون حروف إنجليزي بس';
  if (name.split(' ').length < 2) return 'اكتب الاسم بالإنجليزي كامل';
  return '';
}

export function nationalIdProblem(raw: string | null | undefined, egyptian = true): string {
  const value = String(raw ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, '');
  if (!value) return '';
  if (!egyptian) return /^[A-Za-z0-9]{5,20}$/.test(value) ? '' : 'رقم الهوية/الجواز من 5 لـ 20 حرف أو رقم';
  if (!/^\d{14}$/.test(value)) return 'الرقم القومي 14 رقم';
  const century = value[0] === '2' ? 1900 : value[0] === '3' ? 2000 : null;
  const year = century == null ? NaN : century + Number(value.slice(1, 3));
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (century == null || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date > new Date()) {
    return 'الرقم القومي ده مش صحيح';
  }
  return '';
}

/** The fields a tier-priced booking sends with its main payment (api routes/subscriber-payments.js). */
export function bookingTierFields(draft: {
  priceTier?: string; useDiscount?: boolean; nameAr?: string; nameEn?: string;
  nationalId?: string; phoneConfirmed?: boolean;
}): Record<string, unknown> {
  if (!draft.priceTier) return {};
  return {
    priceTier: draft.priceTier,
    useDiscount: Boolean(draft.useDiscount),
    client: {
      nameAr: clean(draft.nameAr),
      nameEn: clean(draft.nameEn) || null,
      nationalId: String(draft.nationalId || '').trim() || null,
      phoneConfirmed: draft.phoneConfirmed === true,
    },
  };
}
