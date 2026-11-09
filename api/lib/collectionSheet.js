'use strict';

// The collection employees' monthly sheet («التحصيل 10.xlsx», 9 Nov 2026), read: one tab per employee, one row per payment they collected. Like the sales sheet
// (lib/salesSheet.js) it has no headings and every tab has its own columns, so they are found by what they HOLD:
//
//   date     an Excel serial (far outside the month too: an old payment is still a row), or text «d\m\yyyy»
//   phones   digit runs of 8–15 digits, with +20 / +249 / +966, spaces inside a number, two numbers in a cell, a note around the number; the invisible direction
//            marks the sheet carries are dropped. The leftmost such column is the client's; the others are the sender's. A column that says the same number in
//            nearly every row is the wallet the money came into, and is not a client.
//   name     the text column whose values differ most from each other and from the other tabs' (a type or a course repeats across tabs, a name does not)
//   type     every other text column, joined: «قسط / حجز / تكمله حجز / شهادة / كارنيه / كتب / تجديد …» and the course — read as the kinds of money it names
//   amount   the numeric column of amounts; where three numeric columns are total, paid and left (total − paid = left), the amount is the PAID one
//   method   a word of «فودافون كاش، انستا باي، حساب بنكي، الحساب الداخلي …» in any cell of the row
//
// A tab with no phone column at all (name, date, type, amount) is read as it is: the client is found by name.
// Pure: reads a workbook's rows, touches nothing. The sheet holds real clients and phones: it stays off the repository, and so does what this returns.

const { readXlsx } = require('./xlsxRead');
const { normalizeArabicName } = require('./linkSiteAccounts');
const { parsePhones, parseDayMonth, serialToDay, monthOf } = require('./salesSheet');

// the invisible direction marks (LRM, RLM, embeddings and isolates, the Arabic letter mark, the BOM) the sheet carries around its numbers
const BIDI = new RegExp(`[${[[0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0x061c, 0x061c], [0xfeff, 0xfeff]].map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g');
const latin = value => String(value ?? '')
  .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
const isBlank = value => value == null || (typeof value === 'string' && value.trim() === '');
const hasLetters = value => typeof value === 'string' && /\p{L}/u.test(value);
const clean = value => (typeof value === 'string' ? value.replace(BIDI, '').replace(/\s+/g, ' ').trim() : value);

const TOTAL = /^(?:ال)?(?:اجمالي|إجمالي|مجموع|المجموع|total)/i;
const METHOD = /(?:فودافون|انستا|instapay|vodafone|كاش|حساب بنك|الحساب الداخلي|فوري|فيزا|تحويل بنك)/i;

/** The kinds of money a row's text names: COURSE (an instalment, a booking, a completion, a renewal), CERTIFICATE, CARNEH, BOOK, CONSULTATION. */
function moneyKinds(text) {
  const folded = normalizeArabicName(text);
  const squeezed = folded.replace(/\s+/g, '');
  const has = re => re.test(folded) || re.test(squeezed);
  const kinds = new Set();
  if (has(/شهاد|بورد|خارجي|ازهر|خبره|جامعه/)) kinds.add('CERTIFICATE');
  if (has(/كارني/)) kinds.add('CARNEH');
  if (has(/كتاب|كتب/)) kinds.add('BOOK');
  if (has(/استشار/)) kinds.add('CONSULTATION');
  if (has(/قسط|حجز|تكمل|بقيت/) || !kinds.size) kinds.add('COURSE');
  return [...kinds];
}

/** A number cell, or a text one that is a number with a currency word («790 ريال»): { value, note }; null for anything else. */
function amountOf(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? { value: cell, note: null } : null;
  if (typeof cell !== 'string') return null;
  const match = latin(cell).replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*([^\d\s].*)?$/);
  return match ? { value: Number(match[1]), note: match[2] ? match[2].trim() : null } : null;
}

/** A date cell as a day: an Excel serial in a wide window around the month (an old payment is still a row), or «d\m\yyyy». */
function readDate(cell, bounds) {
  if (typeof cell === 'number' && cell >= bounds.firstSerial - 400 && cell <= bounds.lastSerial + 60 && Number.isInteger(Math.floor(cell))) {
    const day = serialToDay(cell);
    return { day, inMonth: day >= bounds.first && day <= bounds.last };
  }
  const parsed = typeof cell === 'string' ? parseDayMonth(cell, bounds.year) : null;
  if (!parsed) return null;
  const day = `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
  return { day, inMonth: day >= bounds.first && day <= bounds.last };
}

function findColumns(rows, bounds, foreign) {
  const width = Math.max(0, ...rows.map(row => row.length));
  const columns = Array.from({ length: width }, (_, index) => {
    const cells = rows.map(row => row[index]).filter(cell => !isBlank(cell));
    return { index, cells, count: cells.length };
  }).filter(column => column.count);
  const share = (column, test) => column.cells.filter(test).length / column.count;
  const taken = new Set();
  const claim = column => { if (column) taken.add(column.index); return column ? column.index : -1; };
  const free = () => columns.filter(column => !taken.has(column.index));

  const date = claim(free().map(column => ({ column, score: share(column, cell => readDate(cell, bounds) != null) })).filter(item => item.score >= 0.6)
    .sort((a, b) => b.score - a.score || a.column.index - b.column.index)[0]?.column);

  // Phone columns: most cells hold a number of 8–15 digits. The one that says the same number nearly everywhere is the wallet the money came into.
  const phoneColumns = free().filter(column => share(column, cell => parsePhones(cell).length > 0) >= 0.4);
  const wallets = []; const phones = [];
  for (const column of phoneColumns) {
    const counts = new Map();
    for (const cell of column.cells) { const key = parsePhones(cell)[0]; if (key) counts.set(key, (counts.get(key) || 0) + 1); }
    const top = Math.max(0, ...counts.values());
    if (top / column.count >= 0.7 && column.count >= 5) wallets.push(column.index); else phones.push(column.index);
    taken.add(column.index);
  }

  // Text columns. The method column (words of payment methods) is neither a name nor a type.
  const method = free().filter(column => share(column, cell => typeof cell === 'string' && METHOD.test(cell)) >= 0.5);
  for (const column of method) taken.add(column.index);
  const textColumns = free().filter(column => share(column, cell => hasLetters(cell)) >= 0.6);
  const distinct = column => new Set(column.cells.map(cell => normalizeArabicName(cell))).size / column.count;
  const words = column => column.cells.reduce((sum, cell) => sum + String(cell).split(' ').length, 0) / column.count;
  const common = column => (foreign ? column.cells.filter(cell => foreign.has(normalizeArabicName(cell))).length / column.count : 0);
  const score = column => distinct(column) + (words(column) >= 2 ? 0.2 : 0) - common(column);
  const name = [...textColumns].sort((a, b) => score(b) - score(a) || a.index - b.index)[0];
  if (name) taken.add(name.index);
  const types = textColumns.filter(column => column !== name).map(column => column.index);
  for (const index of types) taken.add(index);

  // Amounts: numeric columns left. Three that read total − paid = left give the PAID one.
  // (a «left» column is mostly zeros, so a zero counts as a number here)
  const numeric = free().filter(column => share(column, cell => { const a = amountOf(cell); return a != null && a.value >= 0 && a.value <= 200000; }) >= 0.6);
  let amount = -1; let total = -1; let left = -1;
  const triple = (() => {
    for (const a of numeric) for (const b of numeric) for (const c of numeric) {
      if (a === b || b === c || a === c) continue;
      const rowsOf = rows.map(row => [amountOf(row[a.index]), amountOf(row[b.index]), amountOf(row[c.index])]).filter(parts => parts.every(Boolean));
      if (rowsOf.length >= 3 && rowsOf.filter(([x, y, z]) => Math.abs(x.value - y.value - z.value) < 0.5).length / rowsOf.length >= 0.5) return [a, b, c];
    }
    return null;
  })();
  if (triple) { [total, amount, left] = triple.map(column => column.index); } else {
    const best = numeric.filter(column => share(column, cell => amountOf(cell)?.value > 0) >= 0.6).sort((a, b) => share(b, cell => amountOf(cell)?.value > 0) - share(a, cell => amountOf(cell)?.value > 0) || a.index - b.index)[0];
    amount = best ? best.index : -1;
  }
  return { name: name ? name.index : -1, date, phones, wallets, types, method: method.map(column => column.index), amount, total, left };
}

function readTab(tab, bounds, foreign) {
  const numbered = tab.rows.map((cells, index) => ({ cells: cells.map(clean), rowNumber: index + 1 }));
  const columns = findColumns(numbered.map(item => item.cells), bounds, foreign);
  const out = { tab: clean(tab.name), columns, rows: [], skipped: [], unreadable: [] };
  const cell = (item, index) => (index >= 0 ? item.cells[index] : null);

  numbered.forEach((item, position) => {
    const { cells, rowNumber } = item;
    if (!cells.some(value => !isBlank(value))) return;
    const name = clean(cell(item, columns.name)) || '';
    const paid = amountOf(cell(item, columns.amount));
    if (TOTAL.test(name) || cells.some(value => typeof value === 'string' && TOTAL.test(value))) { out.skipped.push({ rowNumber, reason: 'total' }); return; }
    if (!cells.some(value => typeof value === 'number' || /\d/.test(latin(value)))) {
      if (position === 0) out.skipped.push({ rowNumber, reason: 'header' }); else out.unreadable.push({ rowNumber, reason: 'نص بدون أي رقم', cells: cells.map(value => String(value ?? '')) });
      return;
    }
    if (!name) { out.unreadable.push({ rowNumber, reason: 'مفيش اسم عميل', cells: cells.map(value => String(value ?? '')) }); return; }
    if (!paid || !(paid.value > 0)) { out.unreadable.push({ rowNumber, reason: 'مفيش مبلغ', cells: cells.map(value => String(value ?? '')) }); return; }

    const dateRead = columns.date >= 0 ? readDate(cell(item, columns.date), bounds) : null;
    const phoneCells = columns.phones.map(index => parsePhones(cells[index]));
    const text = columns.types.map(index => cells[index]).filter(value => typeof value === 'string' && value).join(' ');
    const method = cells.map(value => (typeof value === 'string' && METHOD.test(value) ? value : null)).find(Boolean) || null;
    const total = amountOf(cell(item, columns.total));
    const left = amountOf(cell(item, columns.left));
    const problems = [];
    if (!phoneCells.some(list => list.length)) problems.push('مفيش رقم تليفون');
    if (!dateRead) problems.push('مفيش تاريخ'); else if (!dateRead.inMonth) problems.push('التاريخ خارج الشهر');
    if (paid.note) problems.push(`المبلغ مكتوب بعملة: ${paid.note}`);
    out.rows.push({
      tab: out.tab, rowNumber, name,
      // the client's numbers (the leftmost phone column) and the sender's (the other columns)
      phones: phoneCells[0] || [], senderPhones: phoneCells.slice(1).flat().filter(phone => !(phoneCells[0] || []).includes(phone)),
      text, kinds: moneyKinds(text), amount: paid.value, total: total ? total.value : null, left: left ? left.value : null,
      day: dateRead ? dateRead.day : null, inMonth: dateRead ? dateRead.inMonth : null, method: method ? method.replace(/\s+/g, ' ') : null, problems,
    });
  });
  return out;
}

/** The whole workbook: every tab as one collection employee. `month` is «2026-10». */
function parseCollectionSheet(tabs, { month }) {
  const bounds = monthOf(month);
  const texts = tabs.map(tab => new Set(tab.rows.flat().filter(cell => typeof cell === 'string' && hasLetters(cell)).map(cell => normalizeArabicName(clean(cell)))));
  const collectors = tabs.map((tab, index) => {
    const foreign = new Set(texts.filter((_, other) => other !== index).flatMap(set => [...set]));
    return readTab(tab, bounds, tabs.length > 1 ? foreign : null);
  }).filter(tab => tab.rows.length || tab.unreadable.length);
  return {
    month, from: bounds.first, to: bounds.last, collectors,
    rows: collectors.reduce((sum, tab) => sum + tab.rows.length, 0),
    unreadable: collectors.flatMap(tab => tab.unreadable.map(item => ({ tab: tab.tab, ...item }))),
  };
}

function readCollectionSheet(buffer, options) {
  return parseCollectionSheet(readXlsx(buffer), options);
}

module.exports = { readCollectionSheet, parseCollectionSheet, moneyKinds, amountOf };
