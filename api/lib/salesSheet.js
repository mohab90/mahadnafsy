'use strict';

// The owner's monthly sales target sheet («مبيعات شهر 10.xlsx», 9 Nov 2026), read: one tab per rep, one row per booking. Every tab has its own column
// layout and no headings, so the columns are found by what they HOLD, never by position:
//
//   date      Excel serial numbers inside the month, or text «d\m» («13\10»; the month is the one asked for)
//   id        14-digit national numbers (a column that holds them is not a phone column)
//   phone     digit runs of 8–15 digits; a cell can hold two numbers («٠١٠…\٠١١…» or «a / b») and keeps both; spaces inside one number are kept as one
//   discount  text with «خصم»
//   branch    text of branch words (اونلاين / اون لاين محلي / الدقي / دقي); the leftmost such column
//   payment   a column of «فودافون / انستا …» is neither
//   name      the text column whose values are the most different from each other
//   course    the other text column, the one that repeats most
//   amounts   numeric columns: the price is the one with the larger values, the deposit is the one that stays under it row by row; a column of small codes
//             (720, 7722 …) that goes over the price is neither
//
// A row reading «النص التانى» splits the tab into the first and the second round of the month (the targets are paid per half month). The round by that row
// and the round by the booking's own date can disagree (a row sits after the marker but is dated the 13th): both are kept, `roundConflict` says so.
//
// Pure: reads a workbook's rows, touches nothing. The sheet holds real clients and phones: it stays off the repository, and so does what this returns.

const { readXlsx } = require('./xlsxRead');
const { normalizeArabicName } = require('./linkSiteAccounts');

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

const latin = value => String(value ?? '')
  .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
const text = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const digitsOf = value => latin(value).replace(/\D/g, '');
const isBlank = value => value == null || (typeof value === 'string' && value.trim() === '');
const hasLetters = value => typeof value === 'string' && /\p{L}/u.test(value);

const serialToDay = serial => new Date(EXCEL_EPOCH + Math.floor(Number(serial)) * DAY_MS).toISOString().slice(0, 10);
const dayToSerial = day => Math.round((Date.parse(`${day}T00:00:00Z`) - EXCEL_EPOCH) / DAY_MS);

const MARKER = /النص(?:ف)?\s*(?:ال)?تان(?:ي)/;
const isMarker = row => row.some(cell => typeof cell === 'string' && MARKER.test(normalizeArabicName(cell).replace(/\s+/g, ' ')));
const TOTAL = /^(?:ال)?(?:اجمالي|إجمالي|مجموع|المجموع|total)/i;
const BRANCH_WORDS = /(?:اون\s*لاين|online|دقي|محلي)/;
const PAYMENT_WORDS = /(?:فودافون|انستا|instapay|vodafone|كاش|فيزا|تحويل)/i;

/** The phone numbers one cell holds, each as the digits it was written with (a number cell lost its leading zero). */
function parsePhones(cell) {
  if (isBlank(cell)) return [];
  const raw = typeof cell === 'number' ? (Number.isInteger(cell) ? String(cell) : '') : latin(cell);
  const out = [];
  // «01558282609-010509054780»: a dash between two numbers is a separator; inside one number («+20 10-9414446») it is not.
  const parts = raw.split(/[\\/،,;|\n]|\s+و\s+/).flatMap(part => {
    const pieces = part.split(/\s*-\s*/);
    return pieces.length > 1 && pieces.every(piece => digitsOf(piece).length >= 9) ? pieces : [part];
  });
  for (const part of parts) {
    const groups = part.trim().split(/\s+/).filter(Boolean);
    // «01284450882 01112071194» are two numbers; «0 11 42682000» is one written in pieces.
    const pieces = groups.length > 1 && groups.every(group => digitsOf(group).length >= 9) ? groups : [part];
    for (const piece of pieces) {
      const digits = digitsOf(piece);
      if (digits.length >= 8 && digits.length <= 15 && !out.includes(digits)) out.push(digits);
    }
  }
  return out;
}

/** «13\10» → { day, month } (the year is the one given); null when the cell is not a day-and-month. */
function parseDayMonth(cell, year) {
  const match = latin(cell).trim().match(/^(\d{1,2})\s*[\\/.\-]\s*(\d{1,2})(?:\s*[\\/.\-]\s*(\d{2,4}))?$/);
  if (!match) return null;
  const day = Number(match[1]); const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const yearOf = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : year;
  return { day, month, year: yearOf };
}

function monthOf(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw Object.assign(new Error('الشهر لازم يكون بالشكل 2026-10'), { statusCode: 400 });
  const year = Number(match[1]);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextFirst = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const last = serialToDay(dayToSerial(nextFirst) - 1);
  return { year, month, first, last, firstSerial: dayToSerial(first), lastSerial: dayToSerial(last) };
}

/** What a date cell says, as a day of the month asked for: { day: 'YYYY-MM-DD', inMonth } — null when the cell holds no date. */
function readDate(cell, bounds) {
  if (typeof cell === 'number' && Number.isInteger(Math.floor(cell)) && cell >= bounds.firstSerial - 40 && cell <= bounds.lastSerial + 40) {
    const day = serialToDay(cell);
    return { day, inMonth: day >= bounds.first && day <= bounds.last };
  }
  const parsed = typeof cell === 'string' ? parseDayMonth(cell, bounds.year) : null;
  if (!parsed) return null;
  const day = `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
  return { day, inMonth: day >= bounds.first && day <= bounds.last };
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };

/** Which column holds what, in one tab's data rows. Any of them can be -1 (not there). */
function findColumns(rows, bounds, foreign = null) {
  const width = Math.max(0, ...rows.map(row => row.length));
  const columns = Array.from({ length: width }, (_, index) => {
    const cells = rows.map(row => row[index]).filter(cell => !isBlank(cell));
    return { index, cells, count: cells.length };
  });
  const share = (column, test) => (column.count ? column.cells.filter(test).length / column.count : 0);
  const taken = new Set();
  const best = (test, minShare, order = (a, b) => b.score - a.score || a.index - b.index) => {
    const scored = columns.filter(column => !taken.has(column.index) && column.count)
      .map(column => ({ ...column, score: share(column, test) })).filter(column => column.score >= minShare).sort(order);
    return scored[0] || null;
  };
  const claim = column => { if (column) taken.add(column.index); return column ? column.index : -1; };

  const date = claim(best(cell => readDate(cell, bounds) != null, 0.6));
  const nationalId = claim(best(cell => /^[23]\d{13}$/.test(digitsOf(cell)) && (typeof cell === 'number' || /^\s*\d+\s*$/.test(latin(cell))), 0.5));
  const phone = claim(best(cell => parsePhones(cell).length > 0, 0.6));
  const discount = claim(best(cell => typeof cell === 'string' && /خصم/.test(cell), 0.5));
  // The branch column: the leftmost one of branch words. A payment-method column that now and then says «الدقي» is not one.
  const branch = claim(best(cell => typeof cell === 'string' && BRANCH_WORDS.test(normalizeArabicName(cell)), 0.6, (a, b) => a.index - b.index));
  // A second column of branch words (the sheet writes it twice) and a payment-method column are neither a name nor a course.
  for (const column of columns) {
    if (!taken.has(column.index) && column.count && share(column, cell => typeof cell === 'string' && BRANCH_WORDS.test(normalizeArabicName(cell))) >= 0.6) taken.add(column.index);
  }
  while (claim(best(cell => typeof cell === 'string' && PAYMENT_WORDS.test(cell), 0.5)) >= 0);

  const textColumns = columns.filter(column => !taken.has(column.index) && column.count && share(column, cell => hasLetters(cell)) >= 0.6);
  const distinct = column => new Set(column.cells.map(cell => normalizeArabicName(cell))).size / column.count;
  const words = column => column.cells.reduce((sum, cell) => sum + text(cell).split(' ').length, 0) / column.count;
  // A course is written the same in every rep's tab and a client's name is not: the share of a column's values found in the other tabs says which is which.
  const common = column => (foreign ? column.cells.filter(cell => foreign.has(normalizeArabicName(cell))).length / column.count : 0);
  const names = [...textColumns].sort((a, b) => (distinct(b) + (words(b) >= 2 ? 0.2 : 0) - common(b)) - (distinct(a) + (words(a) >= 2 ? 0.2 : 0) - common(a)) || a.index - b.index);
  const name = names[0] ? names[0].index : -1;
  taken.add(name);
  const course = (() => {
    const others = textColumns.filter(column => column.index !== name)
      .sort((a, b) => common(b) - common(a) || distinct(a) - distinct(b) || Math.abs(a.index - name) - Math.abs(b.index - name));
    return others[0] ? others[0].index : -1;
  })();
  if (course >= 0) taken.add(course);

  // Amounts: numeric columns left. The price has the larger values; the deposit is the one that stays under it, row by row.
  const numeric = columns.filter(column => !taken.has(column.index) && column.count && share(column, cell => typeof cell === 'number' && cell > 0) >= 0.6);
  // How often column a stays at or under column b, row by row.
  const under = (a, b) => {
    const pairs = rows.map(row => [row[a.index], row[b.index]]).filter(([x, y]) => typeof x === 'number' && typeof y === 'number');
    return pairs.length ? pairs.filter(([x, y]) => x <= y).length / pairs.length : 0;
  };
  const dominated = column => numeric.filter(other => other.index !== column.index && under(other, column) >= 0.85 && under(column, other) < 0.85).length;
  const numbersOf = column => column.cells.filter(cell => typeof cell === 'number');
  const price = [...numeric].sort((a, b) => dominated(b) - dominated(a) || median(numbersOf(b)) - median(numbersOf(a)) || a.index - b.index)[0];
  let deposit = -1;
  if (price) {
    const candidates = numeric.filter(column => column.index !== price.index && under(column, price) >= 0.85)
      .sort((a, b) => new Set(b.cells).size - new Set(a.cells).size || a.index - b.index);
    if (candidates[0]) deposit = candidates[0].index;
  }
  return { name, phone, course, date, price: price ? price.index : -1, deposit, branch, discount, nationalId };
}

const branchOf = cell => {
  const folded = normalizeArabicName(cell);
  if (/دقي/.test(folded)) return 'DOKKI';
  if (/اون\s*لاين|online|محلي/.test(folded)) return 'ONLINE';
  return null;
};

/**
 * One tab read as one rep's rows.
 * @returns {{ tab, rep, columns, rows: object[], skipped: {rowNumber, reason}[], unreadable: {rowNumber, reason, cells}[], marker: number|null }}
 */
function readTab(tab, bounds, foreign) {
  const numbered = tab.rows.map((cells, index) => ({ cells, rowNumber: index + 1 }));
  const markerRow = numbered.find(item => isMarker(item.cells));
  const data = numbered.filter(item => item !== markerRow);
  const columns = findColumns(data.map(item => item.cells), bounds, foreign);
  const out = { tab: text(tab.name), rep: text(tab.name), columns, rows: [], skipped: [], unreadable: [], marker: markerRow ? markerRow.rowNumber : null };
  const cell = (item, index) => (index >= 0 ? item.cells[index] : null);

  data.forEach((item, position) => {
    const { cells, rowNumber } = item;
    const name = text(cell(item, columns.name));
    const phones = columns.phone >= 0 ? parsePhones(cell(item, columns.phone)) : [];
    const priceCell = cell(item, columns.price);
    const price = typeof priceCell === 'number' ? priceCell : Number(latin(priceCell).replace(/[, ]/g, ''));
    const course = text(cell(item, columns.course));
    const hasNumbers = cells.some(value => typeof value === 'number');
    if (!cells.some(value => !isBlank(value))) return;
    if (TOTAL.test(name) || cells.some(value => typeof value === 'string' && TOTAL.test(value.trim()))) { out.skipped.push({ rowNumber, reason: 'total' }); return; }
    if (!hasNumbers && !cells.some(value => /\d/.test(latin(value)))) {
      if (position === 0) out.skipped.push({ rowNumber, reason: 'header' }); else out.unreadable.push({ rowNumber, reason: 'نص بدون أي رقم', cells: cells.map(text) });
      return;
    }
    if (!name && !phones.length && !course) { out.skipped.push({ rowNumber, reason: 'total' }); return; }
    if (!name) { out.unreadable.push({ rowNumber, reason: 'مفيش اسم عميل', cells: cells.map(text) }); return; }
    if (!(price > 0)) { out.unreadable.push({ rowNumber, reason: 'مفيش سعر', cells: cells.map(text) }); return; }

    const dateRead = columns.date >= 0 ? readDate(cell(item, columns.date), bounds) : null;
    const roundByMarker = markerRow ? (rowNumber > markerRow.rowNumber ? 2 : 1) : null;
    const roundByDate = dateRead ? (Number(dateRead.day.slice(8, 10)) <= 15 ? 1 : 2) : null;
    const depositCell = cell(item, columns.deposit);
    const idDigits = columns.nationalId >= 0 ? digitsOf(cell(item, columns.nationalId)) : '';
    const problems = [];
    if (!phones.length) problems.push('مفيش رقم تليفون');
    if (!dateRead) problems.push('مفيش تاريخ');
    else if (!dateRead.inMonth) problems.push('التاريخ خارج الشهر');
    if (!course) problems.push('مفيش كورس');
    out.rows.push({
      tab: out.tab, rowNumber, name, phones, course, day: dateRead ? dateRead.day : null, price,
      deposit: typeof depositCell === 'number' ? depositCell : null,
      branch: columns.branch >= 0 ? branchOf(cell(item, columns.branch)) : null,
      discount: columns.discount >= 0 ? text(cell(item, columns.discount)) || null : null,
      nationalId: idDigits.length >= 8 ? idDigits : null,
      round: roundByMarker ?? roundByDate, roundByMarker, roundByDate,
      roundConflict: roundByMarker != null && roundByDate != null && roundByMarker !== roundByDate,
      problems,
    });
  });
  return out;
}

/**
 * The whole workbook: every tab as one rep. `month` is «2026-10».
 * @param {{name: string, rows: any[][]}[]} tabs  what readXlsx returns
 */
function parseSalesSheet(tabs, { month }) {
  const bounds = monthOf(month);
  const texts = tabs.map(tab => new Set(tab.rows.flat().filter(cell => typeof cell === 'string' && hasLetters(cell)).map(cell => normalizeArabicName(cell))));
  const reps = tabs.map((tab, index) => {
    const foreign = new Set(texts.filter((_, other) => other !== index).flatMap(set => [...set]));
    return readTab(tab, bounds, tabs.length > 1 ? foreign : null);
  }).filter(rep => rep.rows.length || rep.unreadable.length);
  return {
    month, from: bounds.first, to: bounds.last, reps,
    rows: reps.reduce((sum, rep) => sum + rep.rows.length, 0),
    unreadable: reps.flatMap(rep => rep.unreadable.map(item => ({ tab: rep.tab, ...item }))),
  };
}

/**
 * Where a rep's second round starts, from their tab: the first date at or after the «النص التانى» row (9 Nov 2026: the owner's marker, not the 16th, is the rep's
 * round). `day` is null when the tab has no marker, no dated row after it, or that date is outside what a split can be (2–28). `overlap` counts the rows BEFORE the
 * marker dated on or after the split day — dates on both sides of the line, which by date would be in the second round.
 * @param rows a tab's rows as readTab returns them
 */
function suggestRoundSplit(rows) {
  const dayOf = row => (row.day ? Number(row.day.slice(8, 10)) : null);
  const hasMarker = rows.some(row => row.roundByMarker != null);
  const after = rows.filter(row => row.roundByMarker === 2).map(dayOf).filter(day => day != null);
  const before = rows.filter(row => row.roundByMarker === 1).map(dayOf).filter(day => day != null);
  if (!hasMarker) return { day: null, overlap: 0, note: 'مفيش فاصل «النص التانى» في التاب: الروند التاني من يوم 16' };
  if (!after.length) return { day: null, overlap: 0, note: 'مفيش صفوف بتاريخ بعد الفاصل: الروند التاني من يوم 16' };
  const first = Math.min(...after);
  if (first < 2 || first > 28) return { day: null, overlap: 0, note: `أول تاريخ بعد الفاصل يوم ${first} (التقسيم من يوم 2 لـ28): الروند التاني من يوم 16` };
  const overlap = before.filter(day => day >= first).length;
  return {
    day: first, overlap,
    note: overlap ? `${overlap} صف قبل الفاصل بتاريخ يوم ${first} أو بعده: التواريخ على الجهتين متداخلة` : null,
  };
}

/** Reads an .xlsx buffer. */
function readSalesSheet(buffer, options) {
  return parseSalesSheet(readXlsx(buffer), options);
}

// A course as the words it is known by: the sheet writes «متكامل», «معالج سنه», «صحه», the catalogue «علم النفس المتكامل». «ال», «علم», «دبلومة» and the
// like are dropped, the spellings of «نفس» are one word, and the rest decides.
const COURSE_STOP = new Set(['علم', 'دبلومه', 'دبلوم', 'دوره', 'كورس', 'برنامج', 'مسار', 'في', 'و', 'من', 'ال']);
// Each word is kept as its consonants («كوتشينج» and «كوتشنج», «ايجابي» and «الايجابيه» are one word): the sheet's spellings are the rep's own.
function courseWords(value) {
  const words = normalizeArabicName(value).split(' ').filter(Boolean)
    .map(word => word.replace(/^و(?=.{4})/, '').replace(/^ال(?=.{3})/, ''))
    .map(word => (/^نفس(?:ي|يه)?$/.test(word) ? 'نفس' : word))
    .filter(word => !COURSE_STOP.has(word))
    .map(word => (word.length >= 4 ? word[0] + word.slice(1).replace(/[هي]+$/, '').replace(/[اوي]/g, '') : word));
  return [...new Set(words)];
}

/** 0–1: how much two course names are the same course — every word of the shorter one is in the other (1), or the share of words they have in common. */
function courseSimilarity(a, b) {
  const first = courseWords(a); const second = courseWords(b);
  if (!first.length || !second.length) return 0;
  const strong = word => word !== 'نفس';
  const shared = first.filter(word => second.includes(word));
  if (!shared.some(strong)) return shared.length && first.every(word => second.includes(word)) && second.every(word => first.includes(word)) ? 1 : 0;
  const shorter = first.length <= second.length ? first : second; const longer = shorter === first ? second : first;
  if (shorter.every(word => longer.includes(word))) return 1;
  return shared.length / new Set([...first, ...second]).size;
}

module.exports = { suggestRoundSplit, readSalesSheet, parseSalesSheet, parsePhones, parseDayMonth, serialToDay, dayToSerial, monthOf, courseWords, courseSimilarity, branchOf };
