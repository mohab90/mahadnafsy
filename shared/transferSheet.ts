/**
 * Reading the accounts team's transfers workbook into the transfers ledger.
 *
 * «ملف التحويلات» (September–October 2026) is one tab per account the money
 * arrives on — «1020107711», «1020202954», «انستا باى 01505887720»,
 * «البنك السعودى» — each a row per transfer:
 *
 *   التاريخ | اسم العميل (بيان العملية) | اسم السيلز | الكورس | قسط / جديد |
 *   مكان الحضور | رقم العملية | الرقم المحول منه | <the amount>
 *
 * What it does that a plain reader gets wrong:
 *  - The amount's heading changes per tab: «الايداع», «ايداع», «استلام», or the
 *    account number itself («1020107711 حسابات»). A tab may also carry «السحب»;
 *    a row with a withdrawal is money leaving, not a transfer in.
 *  - «الرقم المحول منه» is a wallet number with its zero dropped (1080676388)
 *    on the wallet tabs and a name («BAYMN GERGES SAIED IBRAHIM») on InstaPay.
 *  - One tab has no date heading; one has a typed «2/9/0206» and one a 2029.
 *    A date that is not this or last year takes the row above's date and says so.
 *  - The Saudi bank tab has no operation number. The server needs one — it is
 *    what stops a transfer being counted twice on one box — so the row gets a
 *    reference built from what it does have, the same one on every upload.
 *  - About a fifth of the rows are a transfer nobody has claimed yet: no
 *    customer, no sales. They are exactly what the ledger is for.
 */
import { foldText, latinDigits, parseAmount, readDateColumn, sheetCellText, type SheetCell, type SheetTab } from './sheetImport';

export type TransferColumn = 'date' | 'customer' | 'sales' | 'course' | 'kind' | 'place' | 'reference' | 'sender' | 'amount' | 'withdrawal';

/** In the order a heading is tried: «رقم العملية» before «الرقم المحول منه». */
const HEADINGS: [TransferColumn, RegExp][] = [
  ['date', /^(التاريخ|تاريخ|date)/],
  ['reference', /رقم (ال)?عمليه|رقم مرجعي|reference/],
  ['sender', /محول منه|المحول|حول الفلوس|المرسل|sender/],
  ['withdrawal', /سحب|صادر/],
  ['amount', /ايداع|استلام|المبلغ|حسابات|وارد|amount/],
  ['customer', /اسم العميل|العميل|بيان/],
  ['sales', /سيلز|المندوب|الموظف/],
  ['course', /كورس|الدبلومه/],
  ['kind', /قسط|جديد|النوع/],
  ['place', /مكان|الحضور|الفرع/],
];

export type TransferLayout = { headerRow: number; columns: Partial<Record<TransferColumn, number>> };

/** The heading row (the first that names an operation number or an amount) and its columns. */
export function detectTransferLayout(rows: SheetCell[][]): TransferLayout | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const columns: Partial<Record<TransferColumn, number>> = {};
    rows[r].forEach((cell, index) => {
      const heading = foldText(cell);
      if (!heading) return;
      const hit = HEADINGS.find(([key, pattern]) => columns[key] === undefined && pattern.test(heading));
      if (hit) columns[hit[0]] = index;
    });
    if (columns.amount === undefined && columns.reference === undefined) continue;
    // A tab whose first column has no heading: it is the date if its cells are.
    if (columns.date === undefined) {
      const used = new Set(Object.values(columns));
      const first = rows[r].findIndex((_, index) => !used.has(index));
      const dated = readDateColumn(rows.slice(r + 1, r + 11).map(row => row[first])).filter(Boolean).length;
      if (first >= 0 && dated >= 3) columns.date = first;
    }
    // «1020107711 حسابات» and the like: the amount is the last numeric column.
    if (columns.amount === undefined) {
      const body = rows.slice(r + 1, r + 21);
      for (let c = rows[r].length - 1; c >= 0; c--) {
        if (Object.values(columns).includes(c)) continue;
        if (body.filter(row => typeof row[c] === 'number').length >= Math.min(3, body.length)) { columns.amount = c; break; }
      }
    }
    return columns.amount === undefined ? null : { headerRow: r, columns };
  }
  return null;
}

export type SheetTransfer = {
  /** 1-based, as Excel numbers it. */
  row: number;
  receivedOn: string;
  amount: number;
  reference: string;
  /** True when the tab had no operation number and one was built. */
  builtReference: boolean;
  senderName: string | null;
  senderPhone: string | null;
  customerName: string | null;
  note: string | null;
  /** What was guessed: a date taken from the row above, a built reference. */
  warnings: string[];
};

export type SkippedRow = { row: number; reason: string };

const clean = (value: SheetCell | undefined) => {
  const text = sheetCellText(value);
  return text || null;
};

/** A wallet number as the institute writes it: 1080676388 → 01080676388. */
function senderOf(raw: SheetCell | undefined): { phone: string | null; name: string | null } {
  const text = latinDigits(sheetCellText(raw));
  if (!text) return { phone: null, name: null };
  const digits = text.replace(/[\s\-+]/g, '');
  if (/^\d{9,15}$/.test(digits)) {
    return { phone: /^1[0125]\d{8}$/.test(digits) ? `0${digits}` : digits, name: null };
  }
  return { phone: null, name: text.slice(0, 255) };
}

/** An operation number as text: Excel holds 23253587161 as a number, sometimes as 2.3e10. */
function referenceOf(raw: SheetCell | undefined): string {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(Math.round(raw)) : '';
  return latinDigits(sheetCellText(raw)).replace(/\s+/g, '');
}

/** A date that can be the day a transfer arrived: not before last year, not after tomorrow. */
function plausible(date: string | null, today: string): boolean {
  if (!date) return false;
  const year = Number(date.slice(0, 4));
  return year >= Number(today.slice(0, 4)) - 1 && date <= nextDay(today);
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The transfers on one tab, and the rows that are not one (with why).
 * `today` is Cairo's date (YYYY-MM-DD).
 */
export function readTransferTab(tab: SheetTab, today: string): { transfers: SheetTransfer[]; skipped: SkippedRow[]; layout: TransferLayout | null } {
  const layout = detectTransferLayout(tab.rows);
  if (!layout) return { transfers: [], skipped: [], layout: null };
  const { columns, headerRow } = layout;
  const body = tab.rows.slice(headerRow + 1);
  const dates = columns.date === undefined ? body.map(() => null) : readDateColumn(body.map(row => row[columns.date as number]));
  const transfers: SheetTransfer[] = [];
  const skipped: SkippedRow[] = [];
  const builtCount = new Map<string, number>();
  let lastDate: string | null = null;

  body.forEach((row, index) => {
    const rowNumber = headerRow + index + 2;
    const at = (key: TransferColumn) => (columns[key] === undefined ? undefined : row[columns[key] as number]);
    const amount = parseAmount(at('amount'));
    const withdrawal = parseAmount(at('withdrawal'));
    if (withdrawal && withdrawal > 0 && !(amount && amount > 0)) { skipped.push({ row: rowNumber, reason: 'سحب — مش تحويل وارد' }); return; }
    if (!amount || amount <= 0) {
      // A row with only its date is a blank line of the ledger; one naming a transfer without an amount is not.
      if ([at('reference'), at('sender'), at('customer')].some(cell => clean(cell))) skipped.push({ row: rowNumber, reason: 'من غير مبلغ' });
      return;
    }
    const warnings: string[] = [];
    let receivedOn = dates[index];
    if (!plausible(receivedOn, today)) {
      const written = clean(at('date'));
      const nearest = lastDate || dates.slice(index + 1).find(date => plausible(date, today)) || null;
      if (!nearest) { skipped.push({ row: rowNumber, reason: `تاريخ مش مقروء${written ? ` («${written}»)` : ''}` }); return; }
      warnings.push(`التاريخ «${written ?? '—'}» مش مقروء — اتاخد تاريخ الصف اللي ${lastDate ? 'فوقه' : 'تحته'}`);
      receivedOn = nearest;
    }
    lastDate = receivedOn as string;

    const sender = senderOf(at('sender'));
    let reference = referenceOf(at('reference'));
    let builtReference = false;
    // One operation number twice on a tab: the same transfer typed twice (same
    // amount — the row that names the customer is kept), or a typo (another
    // amount — the second waits for the sheet to be corrected).
    const earlier = reference ? transfers.findIndex(transfer => transfer.reference === reference) : -1;
    if (earlier >= 0) {
      const first = transfers[earlier];
      if (first.amount !== amount) {
        skipped.push({ row: rowNumber, reason: `رقم العملية ${reference} متكرر (صف ${first.row}) بمبلغ تاني — صحّح الشيت` });
        return;
      }
      const customer = clean(at('customer'));
      skipped.push({ row: customer && !first.customerName ? first.row : rowNumber, reason: `نفس التحويل متكرر (${reference}) — اتاخد مرة واحدة` });
      if (!(customer && !first.customerName)) return;
      transfers.splice(earlier, 1);
    }
    if (!reference) {
      // Same row, same reference on every upload: the date, the amount, who sent it, and its place among identical rows.
      const base = `${(receivedOn as string).replace(/-/g, '')}-${amount}-${foldText(sender.name || sender.phone || clean(at('customer')) || '').replace(/\s+/g, '').slice(0, 40)}`;
      const seen = (builtCount.get(base) || 0) + 1;
      builtCount.set(base, seen);
      reference = `بدون-رقم-${base}${seen > 1 ? `-${seen}` : ''}`.slice(0, 191);
      builtReference = true;
      warnings.push('من غير رقم عملية — اتعمل رقم من التاريخ والمبلغ والمحوِّل');
    }

    const customerName = clean(at('customer'));
    const details: [string, string | null][] = [
      ['العميل', customerName], ['السيلز', clean(at('sales'))], ['الكورس', clean(at('course'))],
      ['النوع', clean(at('kind'))], ['الحضور', clean(at('place'))],
    ];
    const note = details.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ');
    transfers.push({
      row: rowNumber, receivedOn: receivedOn as string, amount, reference, builtReference,
      senderName: sender.name, senderPhone: sender.phone, customerName,
      note: note ? `${note} · من ملف التحويلات «${tab.name}»` : `من ملف التحويلات «${tab.name}»`,
      warnings,
    });
  });
  return { transfers, skipped, layout };
}

/**
 * The box a tab's money arrived on, guessed from its name: the box whose
 * number is in the tab's («فودافون كاش 2020» ↔ «1020202954»), else by word
 * («انستا», «سعود», «بنك»). Null when nothing fits — the person picks.
 */
export function guessBox(tabName: string, boxes: string[]): string | null {
  const tab = foldText(tabName);
  const tabDigits = tab.replace(/\D/g, '');
  const byNumber = boxes
    .map(box => ({ box, groups: (foldText(box).match(/\d{3,}/g) || []) }))
    .filter(({ groups }) => groups.some(group => tabDigits.includes(group)))
    .sort((a, b) => Math.max(...b.groups.map(g => g.length)) - Math.max(...a.groups.map(g => g.length)));
  // A number on another rail («اورانج كاش 7720» for «انستا باى 01505887720»)
  // is not this account: when the tab names its rail, the box must not name a different one.
  const tabRails = railWords(tab);
  const fits = byNumber.filter(({ box }) => {
    const rails = railWords(foldText(box));
    return !tabRails.length || !rails.length || rails.some(word => tabRails.includes(word));
  });
  if (fits.length) return fits[0].box;
  for (const word of railWords(tab)) {
    const hit = boxes.find(box => foldText(box).includes(word));
    if (hit) return hit;
  }
  return null;
}

const RAILS = ['انستا', 'فودافون', 'اورانج', 'وي باي', 'اتصالات', 'سعود', 'بنك'];
const railWords = (text: string) => RAILS.filter(word => text.includes(word));

/** Riyal for a Saudi account, pounds otherwise. */
export const guessCurrency = (tabName: string, box: string | null) =>
  (/سعود|sar|ريال/.test(foldText(`${tabName} ${box || ''}`)) ? 'SAR' : 'EGP');

// ── which transfer is this payment's ──────────────────────────────────────────

export type MatchPayment = { amount: number; currency: string; method?: string | null; reference?: string | null; customerName?: string | null; date?: string | null };
export type MatchTransfer = { amount: number; currency: string; method: string; reference: string | null; senderName: string | null; note: string | null; receivedOn: string };

const nameWords = (text: string | null | undefined) => foldText(text || '').split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3);

/**
 * How sure a ledger transfer is the one behind a payment, with why — for
 * ordering the «ربط» lists: its operation number, the amount, the customer the
 * sheet names, the box, a day close to the payment's.
 */
export function transferMatch(payment: MatchPayment, transfer: MatchTransfer): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const reference = String(payment.reference || '').replace(/\s+/g, '');
  if (reference && transfer.reference && reference === transfer.reference) { score += 100; reasons.push('نفس رقم العملية'); }
  if (Number(payment.amount) === Number(transfer.amount) && payment.currency === transfer.currency) { score += 40; reasons.push('نفس المبلغ'); }
  const wanted = nameWords(payment.customerName);
  if (wanted.length) {
    const have = new Set([...nameWords(transfer.note), ...nameWords(transfer.senderName)]);
    const common = wanted.filter(word => have.has(word)).length;
    if (common >= Math.min(2, wanted.length)) { score += 30 + 5 * common; reasons.push('نفس الاسم'); }
  }
  if (payment.method && foldText(payment.method) === foldText(transfer.method)) { score += 10; reasons.push('نفس الحساب'); }
  if (payment.date && transfer.receivedOn) {
    const days = Math.abs(Date.parse(payment.date.slice(0, 10)) - Date.parse(transfer.receivedOn.slice(0, 10))) / 86400000;
    if (days <= 3) { score += 10 - Math.round(days * 2); }
  }
  return { score, reasons };
}
