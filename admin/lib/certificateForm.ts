/**
 * Printing the institute certificate onto the institute's pre-printed paper:
 * only the client's name, the course with its training hours under it and the
 * code are written, at set distances from the top of the A4 sheet — «مكان
 * الطباعة على النموذج الجاهز … تثبيت بمقاسات معينة تبقى الصح وتطبع على كله».
 * The measurements are saved once for the institute on the server
 * (certificate_form_layout) and every print on every computer reads them there.
 */
import { mysqlAdmin } from './mysqlapi';

export type FormLayout = { nameTop: number; courseTop: number; hoursTop: number; codeTop: number };
export const LAYOUT_RANGE = { min: 3, max: 28 };

export const LAYOUT_FIELDS: { key: keyof FormLayout; label: string }[] = [
  { key: 'nameTop', label: 'اسم العميل' },
  { key: 'courseTop', label: 'اسم الكورس' },
  { key: 'hoursTop', label: 'الساعات التدريبية' },
  { key: 'codeTop', label: 'رقم الشهادة' },
];

// The site serves the printable certificate; the desk's own opens are marked so
// they are not read as the client downloading it.
export const SITE = 'https://mahadnafsy.com';

export const certificateUrl = (code: string, staff = false) =>
  `${SITE}/api/completions/${encodeURIComponent(code)}/certificate${staff ? '?staff=1' : ''}`;

export async function loadFormLayout(): Promise<{ layout: FormLayout; defaults: FormLayout; saved: boolean }> {
  return mysqlAdmin.adminGet<{ layout: FormLayout; defaults: FormLayout; saved: boolean }>('/admin/institute-certificates/layout');
}

export async function saveFormLayout(layout: FormLayout): Promise<FormLayout> {
  const result = await mysqlAdmin.adminPut<{ layout: FormLayout }>('/admin/institute-certificates/layout', layout);
  return result.layout;
}

/**
 * The page that prints a certificate onto the form (the server draws it, at the
 * saved measurements; `trial` tries other ones without saving them).
 */
export function formPrintUrl(site: string, code: string, print = false, trial?: Partial<FormLayout>): string {
  const query = new URLSearchParams({ mode: 'form', staff: '1' });
  for (const { key } of LAYOUT_FIELDS) if (trial?.[key] != null) query.set(key, String(trial[key]));
  if (print) query.set('print', '1');
  return `${site}/api/completions/${encodeURIComponent(code)}/certificate?${query.toString()}`;
}
