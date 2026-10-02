/**
 * Reading a sheet of clients: an .xlsx with its tabs, or a CSV.
 *
 * «بيقرا الشيت غلط وبيقرا البيانات غلط». What the institute's own sheets
 * (the Dokki workbook and the online collection sheet of 29-30 September
 * 2026) did to the old reader:
 *
 *  - They are .xlsx workbooks of several tabs. The screen took CSV only, and a
 *    CSV saved from Excel is the one tab that happened to be open.
 *  - The headings are «التليفون», «الموبيل», «الباقى», «المتبقى» and, on one
 *    tab, «الايم». None of them matched («موبايل», «باقي»), so the phone column
 *    was never found and the balances read as empty. «اسم الكورس» matched the
 *    name. The online sheet has no heading row at all.
 *  - A cell holds «01558282609-01050954780», «0122377051601201280864» (two
 *    numbers glued), «⁦+20 11 02073626⁩» (direction marks), 1009441632 (the
 *    zero Excel dropped), «01010000000» (a placeholder) or «#ERROR!».
 *  - Dates are form timestamps written month first («12/31/2025 15:56:52»);
 *    Excel turned the ones it could read day first into dates, so «1/8/2026»
 *    (8 January) became 1 August.
 *  - Amounts come as «1,500» or in Arabic digits.
 *
 * The server keeps the same rules for a linked Google Sheet
 * (api/lib/sheetCells.js); api/tests/sheetImport.test.js holds the two to the
 * same answers.
 */
import { parseCsvRows, detectCsvDelimiter } from './csv';

export type SheetCell = string | number | null;
export type SheetTab = { name: string; rows: SheetCell[][] };

// ── text ─────────────────────────────────────────────────────────────────────

const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export const latinDigits = (value: string) => value
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0));

/** A heading as it is compared: one spelling of alef, ya and ta marbuta. */
export const foldText = (value: SheetCell | undefined) => latinDigits(String(value ?? ''))
  .replace(DIRECTION_MARKS, '')
  .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064b-\u065f\u0640]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const cellText = (value: SheetCell | undefined) => String(value ?? '').replace(DIRECTION_MARKS, '').replace(/\s+/g, ' ').trim();

/** A cell as one line of text, direction marks and runs of spaces gone. */
export const sheetCellText = cellText;

// ── columns ──────────────────────────────────────────────────────────────────

export type SheetField = 'date' | 'name' | 'phone' | 'email' | 'course' | 'expected' | 'paid' | 'refund'
  | 'remaining' | 'officer' | 'sales' | 'cert' | 'attendance' | 'notes';

/**
 * In the order a heading is tried: «الشهادة المحصل عنها المبلغ» is a
 * certificate before it is money, «قيمة الكورس» money before a course,
 * «اسم الكورس» a course before a name, «رقم العميل» a phone before a name.
 * A heading whose first field is already taken tries its next one.
 */
export const SHEET_FIELDS: { key: SheetField; label: string; words: string[] }[] = [
  { key: 'cert', label: 'شهادة', words: ['شهاد', 'cert'] },
  { key: 'refund', label: 'المسترد', words: ['مسترد', 'استرداد', 'refund'] },
  { key: 'remaining', label: 'المتبقي', words: ['متبقي', 'باقي', 'remaining', 'balance'] },
  { key: 'paid', label: 'المحصل', words: ['محصل', 'مدفوع', 'paid', 'collected'] },
  { key: 'expected', label: 'سعر الكورس', words: ['قيمه', 'سعر', 'اجمالي', 'متوقع', 'المبلغ', 'price', 'total', 'expected', 'amount', 'fee'] },
  { key: 'date', label: 'التاريخ', words: ['تاريخ', 'date', 'timestamp', 'time'] },
  { key: 'phone', label: 'الموبايل', words: ['تليفون', 'تلفون', 'موبايل', 'موبيل', 'محمول', 'هاتف', 'جوال', 'واتس', 'رقم العميل', 'رقم التواصل', 'رقم الهاتف', 'phone', 'mobile', 'whats', 'tel'] },
  { key: 'email', label: 'الإيميل', words: ['ايميل', 'بريد', 'email', 'mail'] },
  { key: 'course', label: 'الكورس', words: ['كورس', 'دوره', 'دبلوم', 'برنامج', 'course', 'program', 'diploma'] },
  { key: 'officer', label: 'مسئول التحصيل', words: ['مسئول', 'مسؤول', 'officer', 'collector'] },
  { key: 'sales', label: 'المبيعات', words: ['مبيعات', 'سيلز', 'sales'] },
  { key: 'attendance', label: 'الحضور', words: ['حضور', 'attend'] },
  { key: 'notes', label: 'ملاحظات', words: ['ملاحظ', 'تعليق', 'note', 'comment'] },
  { key: 'name', label: 'الاسم', words: ['اسم', 'الايم', 'العميل', 'الطالب', 'name', 'client', 'student', 'customer'] },
];

export type ColumnMap = Partial<Record<SheetField, number>>;

/** The fields a heading could name, most likely first. */
export function fieldsOfHeading(heading: SheetCell | undefined): SheetField[] {
  const text = foldText(heading);
  if (!text || text.length > 60) return [];
  return SHEET_FIELDS.filter(field => field.words.some(word => text.includes(word))).map(field => field.key);
}

function mapHeadings(headings: SheetCell[]): ColumnMap {
  const map: ColumnMap = {};
  headings.forEach((heading, index) => {
    const field = fieldsOfHeading(heading).find(key => map[key] === undefined);
    if (field) map[field] = index;
  });
  return map;
}

// ── phones ───────────────────────────────────────────────────────────────────

const PLACEHOLDER = /0{6,}$/;

/** One number in the form the system stores: 01xxxxxxxxx, or +<country…>. */
function onePhone(digits: string): string | null {
  const d = digits.replace(/^00/, '');
  if (PLACEHOLDER.test(d)) return null;
  if (/^201[0125]\d{8}$/.test(d)) return `0${d.slice(2)}`;
  if (/^01[0125]\d{8}$/.test(d)) return d;
  if (/^1[0125]\d{8}$/.test(d)) return `0${d}`;
  // North America (1 and an area code, never 0 or 1 first), or a country code.
  if (/^1[2-9]\d{9}$/.test(d) || /^[2-9]\d{10,14}$/.test(d)) return `+${d}`;
  // A local number with its trunk zero (a landline, a Gulf mobile): kept as
  // written, since its country cannot be told. An Egyptian mobile is 11 digits.
  if (/^0[2-9]\d{7,10}$/.test(d)) return d;
  return null;
}

/**
 * Every number in a cell: the ones the system can use, and what was there but
 * cannot be used (a digit short, a placeholder, «#ERROR!»), to be said.
 */
export function splitPhones(raw: SheetCell | undefined): { phones: string[]; bad: string[] } {
  if (raw === null || raw === undefined || raw === '') return { phones: [], bad: [] };
  const text = typeof raw === 'number' ? String(Math.round(raw)) : latinDigits(String(raw)).replace(DIRECTION_MARKS, '');
  if (/^\s*#/.test(text)) return { phones: [], bad: [text.trim()] };
  const phones: string[] = [];
  const bad: string[] = [];
  const parts = text.split(/[/\\,،|;\n]+|\s{2,}|\s+-\s+|(?<=\d)-(?=\+?\d{9,})/).map(part => part.trim()).filter(Boolean);
  for (const part of parts) {
    const digits = part.replace(/\D/g, '');
    if (!digits) continue;
    // Two numbers typed into one cell with nothing between them.
    const glued = digits.length >= 20 ? digits.match(/(?:0020|20|0)?1[0125]\d{8}/g) : null;
    const pieces = glued && glued.join('').length >= digits.length - 2 ? glued : [digits];
    for (const piece of pieces) {
      const phone = onePhone(piece);
      if (phone) { if (!phones.includes(phone)) phones.push(phone); } else bad.push(part);
    }
  }
  return { phones, bad };
}

/**
 * The phone of a lead row: what splitPhones can vouch for, and failing that any
 * number that is plausibly one, as written.
 *
 * splitPhones is exact about Egypt and the long international forms, which is what
 * a client sheet needs. A lead sheet is mostly numbers from abroad, and a Saudi
 * mobile written without its country code («501234567», nine digits) is none of
 * those — so every row of an international sheet read as «no phone» and was
 * skipped, which is what «دولي قديم» did with a file that was fine. The server
 * normalises and refuses what it cannot use; rejecting here only hid the rows.
 */
export function leadPhone(raw: SheetCell | undefined): { phone: string; others: string[] } {
  const { phones } = splitPhones(raw);
  if (phones.length) return { phone: phones[0], others: phones.slice(1) };
  if (raw === null || raw === undefined) return { phone: '', others: [] };
  const text = typeof raw === 'number' ? String(Math.round(raw)) : latinDigits(String(raw)).replace(DIRECTION_MARKS, '');
  if (/^\s*#/.test(text)) return { phone: '', others: [] };
  const first = text.split(/[/\\,،|;\n]+|\s{2,}/).map(part => part.trim()).find(part => part.replace(/\D/g, '').length >= 7);
  if (!first) return { phone: '', others: [] };
  const digits = first.replace(/\D/g, '');
  if (digits.length > 15 || PLACEHOLDER.test(digits)) return { phone: '', others: [] };
  return { phone: `${first.trim().startsWith('+') ? '+' : ''}${digits}`, others: [] };
}

// ── amounts and dates ────────────────────────────────────────────────────────

/** «1,500», «١٥٠٠ ج», 1500 → 1500; nothing there → null. */
export function parseAmount(raw: SheetCell | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = latinDigits(raw).replace(DIRECTION_MARKS, '').replace(/[\u066c,\s]/g, '').replace(/\u066b/g, '.');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

const iso = (year: number, month: number, day: number) => (
  month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null);

const SERIAL = (value: SheetCell | undefined) => typeof value === 'number' && value > 20000 && value < 80000;
const TEXT_DATE = /(\d{4})[/\-.\\](\d{1,2})[/\-.\\](\d{1,2})|(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{4})/;

/**
 * A column of dates, read one way for all of it. Text written month first
 * (a second part over 12) says the sheet is month first; Egypt's day first is
 * the default. Serials beside month-first text are read with day and month
 * swapped: Excel converted only the texts it could read day first.
 */
export function readDateColumn(values: (SheetCell | undefined)[]): (string | null)[] {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const m = latinDigits(value).match(TEXT_DATE);
    if (!m || m[1]) continue;
    if (Number(m[4]) > 12) firstOver12 = true;
    if (Number(m[5]) > 12) secondOver12 = true;
  }
  const monthFirst = secondOver12 && !firstOver12;
  return values.map(value => {
    if (SERIAL(value)) {
      const date = new Date(Math.round(((value as number) - 25569) * 86400000));
      const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
      return monthFirst && day <= 12 ? iso(year, day, month) : iso(year, month, day);
    }
    if (typeof value !== 'string') return null;
    const m = latinDigits(value).match(TEXT_DATE);
    if (!m) return null;
    if (m[1]) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
    const [a, b, year] = [Number(m[4]), Number(m[5]), Number(m[6])];
    return monthFirst ? iso(year, a, b) : iso(year, b, a);
  });
}

// ── the layout of a tab ──────────────────────────────────────────────────────

export type TabLayout = {
  /** The heading row, or -1 when the sheet has none and the columns were guessed from what is in them. */
  headerRow: number;
  columns: ColumnMap;
  guessed: boolean;
};

/**
 * Where the headings are — a row among the first ten that names at least
 * two fields and holds no phone number — and which column is which. With no such row, the columns are
 * told apart by their cells: the one of phone numbers, the one of dates, the
 * amounts in order (price, then remaining), and among the words the column
 * that is nearly always different (the client), the long repeated one (the
 * course) and the short repeated ones (the officer, then sales).
 */
export function detectLayout(rows: SheetCell[][]): TabLayout {
  let best = { row: -1, score: 0, columns: {} as ColumnMap };
  rows.slice(0, 10).forEach((row, index) => {
    // A row with a phone number in it is a client, whatever its words say.
    if (row.some(cell => splitPhones(cell).phones.length)) return;
    const columns = mapHeadings(row);
    const score = Object.keys(columns).length;
    if (score > best.score) best = { row: index, score, columns };
  });
  if (best.score >= 2) return { headerRow: best.row, columns: best.columns, guessed: false };
  return { headerRow: -1, columns: guessColumns(rows), guessed: true };
}

function guessColumns(rows: SheetCell[][]): ColumnMap {
  const sample = rows.slice(0, 300);
  const width = Math.max(0, ...sample.map(row => row.length));
  const stats = Array.from({ length: width }, (_, col) => {
    const cells = sample.map(row => row[col]).filter(cell => cell !== null && cell !== undefined && cellText(cell) !== '');
    const n = cells.length || 1;
    const texts = cells.filter((cell): cell is string => typeof cell === 'string' && !/^[\d\s+\-/\\.,]+$/.test(latinDigits(cell)));
    return {
      col,
      filled: cells.length / (sample.length || 1),
      phone: cells.filter(cell => splitPhones(cell).phones.length > 0).length / n,
      date: cells.filter(cell => SERIAL(cell) || (typeof cell === 'string' && TEXT_DATE.test(latinDigits(cell)))).length / n,
      number: cells.filter(cell => typeof cell === 'number' || /^[\d\s,.\u066c\u066b-]+$/.test(latinDigits(String(cell)))).length / n,
      text: texts.length / n,
      distinct: new Set(texts.map(cell => foldText(cell))).size / (texts.length || 1),
      length: texts.reduce((sum, cell) => sum + cell.length, 0) / (texts.length || 1),
    };
  }).filter(stat => stat.filled > 0.3);
  const map: ColumnMap = {};
  const taken = new Set<number>();
  const take = (field: SheetField, stat?: { col: number }) => { if (stat) { map[field] = stat.col; taken.add(stat.col); } };
  const free = () => stats.filter(stat => !taken.has(stat.col));
  take('phone', free().filter(s => s.phone >= 0.5).sort((a, b) => b.phone - a.phone)[0]);
  take('date', free().filter(s => s.date >= 0.5).sort((a, b) => b.date - a.date)[0]);
  const amounts = free().filter(s => s.number >= 0.7).sort((a, b) => a.col - b.col);
  take('expected', amounts[0]);
  take('remaining', amounts[1]);
  const words = free().filter(s => s.text >= 0.6);
  take('name', [...words].sort((a, b) => b.distinct - a.distinct)[0]);
  take('course', free().filter(s => s.text >= 0.6 && s.distinct < 0.5).sort((a, b) => b.length - a.length)[0]);
  const short = free().filter(s => s.text >= 0.6).sort((a, b) => a.distinct - b.distinct);
  take('officer', short[0]);
  take('sales', short[1]);
  return map;
}

// ── rows ─────────────────────────────────────────────────────────────────────

/** One client row, in the shape the import screens send. Amounts as digits, '' when the sheet has none. */
export type SheetClientRow = {
  _id: string;
  _tab: string;
  _row: number;
  _date: string;
  _name: string;
  _phone: string;
  _otherPhones: string;
  _email: string;
  _notes: string;
  _course: string;
  _paid: string;
  _expected: string;
  _refund: string;
  _remaining: string;
  _officer: string;
  _sales: string;
  _cert: string;
  _attendance: string;
  /** What in the row could not be used as it stood. */
  _issues: string[];
};

const amountText = (value: SheetCell | undefined) => {
  const amount = parseAmount(value);
  return amount === null ? '' : String(amount);
};

/** A tab's rows as client rows, by the layout given (detected or corrected on the screen). */
export function tabClientRows(tab: SheetTab, layout: TabLayout): SheetClientRow[] {
  const { columns } = layout;
  const body = tab.rows.slice(layout.headerRow + 1);
  const at = (row: SheetCell[], field: SheetField) => (columns[field] === undefined ? undefined : row[columns[field] as number]);
  const dates = columns.date === undefined ? [] : readDateColumn(body.map(row => at(row, 'date')));
  const out: SheetClientRow[] = [];
  body.forEach((row, index) => {
    const name = cellText(at(row, 'name'));
    const { phones, bad } = splitPhones(at(row, 'phone'));
    if (!name && !phones.length && !bad.length) return;
    const issues = bad.map(value => (/^#/.test(value)
      ? `الرقم في الشيت «${value}»`
      : `رقم مش سليم: ${value}${PLACEHOLDER.test(value.replace(/\D/g, '')) ? ' (شكله مش حقيقي)' : ' (ناقص أو زيادة أرقام)'}`));
    out.push({
      _id: `${tab.name}:${layout.headerRow + 2 + index}`,
      _tab: tab.name,
      _row: layout.headerRow + 2 + index,
      _date: dates[index] || '',
      _name: name,
      _phone: phones[0] || '',
      _otherPhones: phones.slice(1).join(' ، '),
      _email: cellText(at(row, 'email')).toLowerCase(),
      _notes: cellText(at(row, 'notes')),
      _course: cellText(at(row, 'course')),
      _paid: amountText(at(row, 'paid')),
      _expected: amountText(at(row, 'expected')),
      _refund: amountText(at(row, 'refund')),
      _remaining: amountText(at(row, 'remaining')),
      _officer: cellText(at(row, 'officer')),
      _sales: cellText(at(row, 'sales')),
      _cert: cellText(at(row, 'cert')),
      _attendance: cellText(at(row, 'attendance')),
      _issues: issues,
    });
  });
  return out;
}

/**
 * «مدفوع قبل السيستم» for a row: the price less what the sheet says is still
 * owed, when it says; otherwise what it says was collected. The remaining is
 * the figure the desk keeps up to date — a collected column often leaves out
 * a refund or a later instalment.
 */
export function paidBefore(row: Partial<Pick<SheetClientRow, '_expected' | '_paid' | '_remaining'>>): number {
  const expected = parseAmount(row._expected) || 0;
  const remaining = parseAmount(row._remaining);
  if (remaining !== null && expected > 0) return Math.max(0, expected - Math.max(0, remaining));
  return Math.max(0, parseAmount(row._paid) || 0);
}

// ── files ────────────────────────────────────────────────────────────────────

/**
 * The text of a CSV file's bytes.
 *
 * `file.text()` reads UTF-8 and nothing else. Excel on an Arabic Windows saves a
 * CSV as Windows-1256 unless the person picks «CSV UTF-8», and «Unicode Text» is
 * UTF-16: read as UTF-8 both come out as question marks and boxes, no heading
 * matches, and the screen says the file has no names or phones.
 */
export function decodeSheetText(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1256').decode(bytes), encoding: 'windows-1256' };
  }
}

/** CSV or TSV text as one tab. */
export function readCsvTab(text: string, name = 'CSV'): SheetTab {
  const clean = text.replace(/^\ufeff/, '');
  return { name, rows: parseCsvRows(clean, detectCsvDelimiter(clean.split(/\r?\n/)[0] || '')) };
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The parts of a zip, by name — an .xlsx is one. */
async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('الملف مش xlsx سليم');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const parts = new Map<string, string>();
  for (let n = 0; n < count && view.getUint32(offset, true) === 0x02014b50; n++) {
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    parts.set(name, decoder.decode(method === 8 ? await inflateRaw(data) : data));
  }
  return parts;
}

const xmlText = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? xmlText(m[1]) : null;
};

/** The text of an <si> or <is>: its runs, without the phonetic guides. */
const runsText = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
  .map(m => xmlText(m[1])).join('');

const columnIndex = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] || 'A')]
  .reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;

/** Every tab of an .xlsx, in the workbook's order. */
export async function readXlsx(buffer: ArrayBuffer): Promise<SheetTab[]> {
  const parts = await unzip(buffer, name => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
  const workbook = parts.get('xl/workbook.xml');
  if (!workbook) throw new Error('الملف مش xlsx سليم');
  const shared = [...(parts.get('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => runsText(m[1]));
  const targets = new Map([...(parts.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)]
    .map(m => [attr(m[0], 'Id') || '', (attr(m[0], 'Target') || '').replace(/^\/?(xl\/)?/, 'xl/')]));
  const tabs: SheetTab[] = [];
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const xml = parts.get(targets.get(attr(tag, 'r:id') || '') || '');
    if (!xml) continue;
    const rows: SheetCell[][] = [];
    for (const [rowXml] of xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
      const cells: SheetCell[] = [];
      for (const [cellXml] of rowXml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const open = cellXml.match(/^<c\b[^>]*>/)?.[0] || cellXml;
        const type = attr(open, 't');
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value: SheetCell = null;
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? null;
        else if (type === 'inlineStr') value = runsText(cellXml.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
        else if (raw !== undefined) value = type === 'str' || type === 'e' || type === 'b' ? xmlText(raw) : (Number.isFinite(Number(raw)) ? Number(raw) : xmlText(raw));
        cells[columnIndex(attr(open, 'r') || '')] = value;
      }
      const filled = Array.from(cells, cell => (cell === undefined ? null : cell));
      if (filled.some(cell => cell !== null && cell !== '')) rows.push(filled);
    }
    tabs.push({ name: attr(tag, 'name') || `Sheet${tabs.length + 1}`, rows });
  }
  return tabs;
}

/** A file from the upload button as tabs. */
export async function readSheetFile(file: File): Promise<SheetTab[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('الملف بصيغة Excel القديمة (.xls) — احفظه xlsx أو CSV وارفعه تاني');
  return [readCsvTab(decodeSheetText(await file.arrayBuffer()).text, file.name.replace(/\.[^.]+$/, '') || 'CSV')];
}
