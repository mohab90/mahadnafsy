'use strict';

// A fingerprint device's export → punches: [{ bioNo, name, date, time }].
//
// Devices and their software export in a few shapes, and the file is whatever
// HR saved from them, so the reader looks at the headings and the values
// rather than expecting one layout:
//   • a row per punch, the time in one cell («2026/10/01 10:58:12») or split
//     into a date cell and a time cell
//   • a row per day with an arrival and a leaving column («Clock In/Out»,
//     «حضور/انصراف»)
//   • the device's own attlog text: no headings, «1  2026-10-01 10:58:12 …»
// Dates come as text in either day/month or month/day order, or as Excel date
// numbers. Where 03/10 could be either, the reading that falls in the month
// being uploaded wins.

const { readXlsx } = require('./xlsxRead');
const { readXls, looksLikeXls, looksLikeMarkupTable } = require('./xlsRead');
const { parseCsv } = require('./csv');
const { latinDigits } = require('./phoneNumber');

const fold = value => latinDigits(String(value ?? '')).trim().toLowerCase().replace(/[_\s.]+/g, ' ').trim();

const HEADS = {
  bio: /^(ac ?-?no|no|id|user ?id|userid|emp(loyee)? ?(no|id|code)|enroll(ment)? ?(no|id|number)|person ?id|badge ?(no|number)|pin|رقم البصمه|رقم البصمة|رقم الموظف|رقم الجهاز|الرقم|رقم|كود|كود الموظف|الكود)$/,
  name: /^(name|employee ?name|full ?name|الاسم|اسم|اسم الموظف)$/,
  dateTime: /^(date ?[\/&-]? ?time|datetime|التاريخ ?\/ ?الوقت|time ?stamp|check ?time|punch ?time|att ?time|التاريخ و ?الوقت|التاريخ والوقت|وقت البصمه|وقت البصمة)$/,
  date: /^(date|day|التاريخ|اليوم)$/,
  time: /^(time|الوقت|الساعه|الساعة)$/,
  in: /^((clock|check|time|sign) ?-?in|on ?duty|in|حضور|الحضور|دخول|وقت الحضور)$/,
  out: /^((clock|check|time|sign) ?-?out|off ?duty|out|انصراف|الانصراف|خروج|وقت الانصراف)$/,
};

const pad = n => String(n).padStart(2, '0');

/** An Excel date number → { date, time }; a fraction alone is a time. */
function fromSerial(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return {};
  const whole = Math.floor(n);
  const minutes = Math.round((n - whole) * 1440);
  const time = minutes > 0 || n < 1 ? `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}` : null;
  if (n < 1) return { time };
  const d = new Date(Date.UTC(1899, 11, 30) + whole * 86400000);
  return { date: d.toISOString().slice(0, 10), time };
}

/** «10:58», «10:58:12», «2:05 PM», «2:05 م» → 'HH:MM'. */
function parseTime(text) {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|ص|م)?/i.exec(latinDigits(String(text || '')));
  if (!m) return null;
  let h = Number(m[1]);
  const suffix = (m[3] || '').toLowerCase();
  if ((suffix === 'pm' || suffix === 'م') && h < 12) h += 12;
  if ((suffix === 'am' || suffix === 'ص') && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${pad(h)}:${m[2]}`;
}

/** A date in text, read in the order that lands in `month` ('YYYY-MM') when it could be either. */
function parseDate(text, month) {
  const m = /(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(latinDigits(String(text || '')));
  if (!m) return null;
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let y, mo, d;
  if (m[1].length === 4) { y = a; mo = b; d = c; }
  else {
    y = c < 100 ? 2000 + c : c;
    const wantMonth = month ? Number(month.slice(5, 7)) : null;
    if (a > 12) { d = a; mo = b; }
    else if (b > 12) { mo = a; d = b; }
    else if (wantMonth && a === wantMonth && b !== wantMonth) { mo = a; d = b; }
    else { d = a; mo = b; } // Egypt writes day first
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** One cell holding a date and/or a time, as text or an Excel number. */
function readStamp(value, month) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value === 'number') return fromSerial(value);
  const text = String(value);
  if (/^\d+(\.\d+)?$/.test(text.trim()) && !text.includes(':')) return fromSerial(Number(text));
  return { date: parseDate(text, month), time: parseTime(text) };
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.slice(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.slice(2)).swap16().toString('utf16le');
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  // Arabic Excel saves CSV as Windows-1256; decoded as UTF-8 the names turn to
  // boxes. Node has no 1256 decoder; TextDecoder does when ICU is full.
  try { return new TextDecoder('windows-1256').decode(buffer); } catch { return utf8; }
}

/** The file's rows: the first .xlsx tab with content, or the text split as CSV/TSV. */
function fileRows(buffer, filename = '') {
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const tabs = readXlsx(buffer).filter(tab => tab.rows.length);
    if (!tabs.length) throw Object.assign(new Error('الملف فاضي'), { statusCode: 400 });
    return tabs.sort((x, y) => y.rows.length - x.rows.length)[0].rows;
  }
  // The device's own .xls (Excel 97–2003), or the HTML/XML table its software
  // saves under that name — refused until 5 Oct 2026 («مش بيقبل»).
  if (looksLikeXls(buffer) || looksLikeMarkupTable(buffer)) {
    const tabs = readXls(buffer).filter(tab => tab.rows.length);
    if (!tabs.length) throw Object.assign(new Error('الملف فاضي'), { statusCode: 400 });
    return tabs.sort((x, y) => y.rows.length - x.rows.length)[0].rows;
  }
  const text = decodeText(buffer);
  // The device's attlog: whitespace-separated, no quotes, no headings.
  if (/\.(dat|txt)$/i.test(filename) || !/[,;\t]/.test(text.split(/\r?\n/)[0] || '')) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      .map(line => {
        const parts = line.split(/\t|\s{2,}/);
        return parts.length > 1 ? parts : line.split(/\s+(?=\d{4}[-/])/);
      });
  }
  return parseCsv(text);
}

/** Which column holds what, from the heading row (or the values, with none). */
function detectLayout(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const heads = (rows[r] || []).map(fold);
    const find = re => heads.findIndex(h => re.test(h));
    const layout = {
      headerRow: r, bio: find(HEADS.bio), name: find(HEADS.name),
      dateTime: find(HEADS.dateTime), date: find(HEADS.date), time: find(HEADS.time),
      in: find(HEADS.in), out: find(HEADS.out),
    };
    const hasWho = layout.bio >= 0 || layout.name >= 0;
    const hasWhen = layout.dateTime >= 0 || layout.time >= 0 || (layout.date >= 0 && (layout.in >= 0 || layout.out >= 0));
    if (hasWho && hasWhen) return layout;
  }
  // No headings: the attlog. The number is the first cell; the stamp is the
  // first cell holding a date and a time.
  const sample = rows.find(row => row.length >= 2) || [];
  const stampCol = sample.findIndex(cell => /\d{4}[-/]\d{1,2}[-/]\d{1,2}.*\d{1,2}:\d{2}/.test(String(cell)));
  if (stampCol > 0) return { headerRow: -1, bio: 0, name: -1, dateTime: stampCol, date: -1, time: -1, in: -1, out: -1 };
  return null;
}

/**
 * @returns {{ punches: {bioNo, name, date, time}[], layout, rowsRead, skipped: {outsideMonth, unreadable} }}
 */
function readDeviceSheet(buffer, { filename = '', month } = {}) {
  const rows = fileRows(buffer, filename);
  const layout = detectLayout(rows);
  if (!layout) {
    throw Object.assign(new Error('مش لاقي في الملف عمود رقم البصمة أو الاسم وعمود الوقت — اتأكد إنه شيت البصمة نفسه'), { statusCode: 400, code: 'SHEET_LAYOUT' });
  }
  const punches = [];
  const skipped = { outsideMonth: 0, unreadable: 0 };
  let carriedDate = null;
  for (const row of rows.slice(layout.headerRow + 1)) {
    const bioNo = layout.bio >= 0 ? fold(row[layout.bio]).replace(/\s+/g, '') : '';
    const name = layout.name >= 0 ? String(row[layout.name] ?? '').trim() : '';
    if (!bioNo && !name) continue;
    const stamps = [];
    if (layout.dateTime >= 0) stamps.push(readStamp(row[layout.dateTime], month));
    else {
      const datePart = layout.date >= 0 ? readStamp(row[layout.date], month).date : null;
      const date = datePart || carriedDate;
      if (datePart) carriedDate = datePart;
      for (const col of [layout.time, layout.in, layout.out]) {
        if (col < 0) continue;
        const cell = readStamp(row[col], month);
        if (cell.time) stamps.push({ date: cell.date || date, time: cell.time });
      }
      if (!stamps.length && (layout.in >= 0 || layout.out >= 0) && date) continue; // a day with no punches: an absence, judged later
    }
    for (const stamp of stamps) {
      if (!stamp.date || !stamp.time) { skipped.unreadable++; continue; }
      if (month && stamp.date.slice(0, 7) !== month) { skipped.outsideMonth++; continue; }
      punches.push({ bioNo, name, date: stamp.date, time: stamp.time });
    }
  }
  return { punches, layout, rowsRead: rows.length - layout.headerRow - 1, skipped };
}

module.exports = { readDeviceSheet, parseDate, parseTime, readStamp, detectLayout, fileRows };
