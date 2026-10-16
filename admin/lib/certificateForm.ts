/**
 * Printing the institute certificate onto the institute's pre-printed paper:
 * only the client's name and the course with its duration are written, at set
 * distances from the top of the A4 sheet — «اسم العميل على بعد حوالي 17 سم واسم
 * الكورس على بعد 22 سم». The paper in the printer may sit a little differently,
 * so the two distances can be nudged and are remembered on this computer.
 */
export const FORM_DEFAULTS = { nameTop: 16, courseTop: 22.6 };
// v2: the name rose 1 cm and the course sank a little (15 Oct 2026) — distances nudged on the old ones are dropped.
const KEY = 'psy.certificateForm.offsets.v2';

export type FormOffsets = { nameTop: number; courseTop: number };

const inRange = (value: unknown, fallback: number) => {
  const cm = Number(value);
  return Number.isFinite(cm) && cm >= 3 && cm <= 28 ? cm : fallback;
};

export function loadFormOffsets(): FormOffsets {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<FormOffsets>;
    return { nameTop: inRange(saved.nameTop, FORM_DEFAULTS.nameTop), courseTop: inRange(saved.courseTop, FORM_DEFAULTS.courseTop) };
  } catch { return { ...FORM_DEFAULTS }; }
}

export function saveFormOffsets(offsets: FormOffsets): FormOffsets {
  const clean = { nameTop: inRange(offsets.nameTop, FORM_DEFAULTS.nameTop), courseTop: inRange(offsets.courseTop, FORM_DEFAULTS.courseTop) };
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* private window: this print only */ }
  return clean;
}

/** The page that prints a certificate onto the form (the server draws it). */
export function formPrintUrl(site: string, code: string, offsets: FormOffsets, print = false): string {
  const query = new URLSearchParams({ mode: 'form', staff: '1', nameTop: String(offsets.nameTop), courseTop: String(offsets.courseTop) });
  if (print) query.set('print', '1');
  return `${site}/api/completions/${encodeURIComponent(code)}/certificate?${query.toString()}`;
}
