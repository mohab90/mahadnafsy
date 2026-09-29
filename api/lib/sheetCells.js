'use strict';

// A sheet of clients read on the server — a linked Google Sheet, synced every
// half hour — by the same rules the import screens read an uploaded file with
// (shared/sheetImport.ts, where the reasons are written out). The API has no
// TypeScript, so the rules are here twice; api/tests/sheetImport.test.js runs
// both on the same cells and holds them to the same answers.

const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

const latinDigits = value => String(value)
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0));

const foldText = value => latinDigits(String(value ?? ''))
  .replace(DIRECTION_MARKS, '')
  .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064b-\u065f\u0640]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const cellText = value => String(value ?? '').replace(DIRECTION_MARKS, '').replace(/\s+/g, ' ').trim();

const SHEET_FIELDS = [
  ['cert', ['شهاد', 'cert']],
  ['refund', ['مسترد', 'استرداد', 'refund']],
  ['remaining', ['متبقي', 'باقي', 'remaining', 'balance']],
  ['paid', ['محصل', 'مدفوع', 'paid', 'collected']],
  ['expected', ['قيمه', 'سعر', 'اجمالي', 'متوقع', 'المبلغ', 'price', 'total', 'expected', 'amount', 'fee']],
  ['date', ['تاريخ', 'date', 'timestamp', 'time']],
  ['phone', ['تليفون', 'تلفون', 'موبايل', 'موبيل', 'محمول', 'هاتف', 'جوال', 'واتس', 'رقم العميل', 'رقم التواصل', 'رقم الهاتف', 'phone', 'mobile', 'whats', 'tel']],
  ['email', ['ايميل', 'بريد', 'email', 'mail']],
  ['course', ['كورس', 'دوره', 'دبلوم', 'برنامج', 'course', 'program', 'diploma']],
  ['officer', ['مسئول', 'مسؤول', 'officer', 'collector']],
  ['sales', ['مبيعات', 'سيلز', 'sales']],
  ['attendance', ['حضور', 'attend']],
  ['notes', ['ملاحظ', 'تعليق', 'note', 'comment']],
  ['name', ['اسم', 'الايم', 'العميل', 'الطالب', 'name', 'client', 'student', 'customer']],
];

function fieldsOfHeading(heading) {
  const text = foldText(heading);
  if (!text || text.length > 60) return [];
  return SHEET_FIELDS.filter(([, words]) => words.some(word => text.includes(word))).map(([key]) => key);
}

function mapHeadings(headings) {
  const map = {};
  headings.forEach((heading, index) => {
    const field = fieldsOfHeading(heading).find(key => map[key] === undefined);
    if (field) map[field] = index;
  });
  return map;
}

const PLACEHOLDER = /0{6,}$/;

function onePhone(digits) {
  const d = digits.replace(/^00/, '');
  if (PLACEHOLDER.test(d)) return null;
  if (/^201[0125]\d{8}$/.test(d)) return `0${d.slice(2)}`;
  if (/^01[0125]\d{8}$/.test(d)) return d;
  if (/^1[0125]\d{8}$/.test(d)) return `0${d}`;
  if (/^1[2-9]\d{9}$/.test(d) || /^[2-9]\d{10,14}$/.test(d)) return `+${d}`;
  if (/^0[2-9]\d{7,10}$/.test(d)) return d;
  return null;
}

function splitPhones(raw) {
  if (raw === null || raw === undefined || raw === '') return { phones: [], bad: [] };
  const text = typeof raw === 'number' ? String(Math.round(raw)) : latinDigits(String(raw)).replace(DIRECTION_MARKS, '');
  if (/^\s*#/.test(text)) return { phones: [], bad: [text.trim()] };
  const phones = [];
  const bad = [];
  const parts = text.split(/[/\\,،|;\n]+|\s{2,}|\s+-\s+|(?<=\d)-(?=\+?\d{9,})/).map(part => part.trim()).filter(Boolean);
  for (const part of parts) {
    const digits = part.replace(/\D/g, '');
    if (!digits) continue;
    const glued = digits.length >= 20 ? digits.match(/(?:0020|20|0)?1[0125]\d{8}/g) : null;
    const pieces = glued && glued.join('').length >= digits.length - 2 ? glued : [digits];
    for (const piece of pieces) {
      const phone = onePhone(piece);
      if (phone) { if (!phones.includes(phone)) phones.push(phone); } else bad.push(part);
    }
  }
  return { phones, bad };
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = latinDigits(raw).replace(DIRECTION_MARKS, '').replace(/[\u066c,\s]/g, '').replace(/\u066b/g, '.');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

const iso = (year, month, day) => (month >= 1 && month <= 12 && day >= 1 && day <= 31
  ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null);
const isSerial = value => typeof value === 'number' && value > 20000 && value < 80000;
const TEXT_DATE = /(\d{4})[/\-.\\](\d{1,2})[/\-.\\](\d{1,2})|(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{4})/;

function readDateColumn(values) {
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
    if (isSerial(value)) {
      const date = new Date(Math.round((value - 25569) * 86400000));
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

function guessColumns(rows) {
  const sample = rows.slice(0, 300);
  const width = Math.max(0, ...sample.map(row => row.length));
  const stats = Array.from({ length: width }, (_, col) => {
    const cells = sample.map(row => row[col]).filter(cell => cell !== null && cell !== undefined && cellText(cell) !== '');
    const n = cells.length || 1;
    const texts = cells.filter(cell => typeof cell === 'string' && !/^[\d\s+\-/\\.,]+$/.test(latinDigits(cell)));
    return {
      col,
      filled: cells.length / (sample.length || 1),
      phone: cells.filter(cell => splitPhones(cell).phones.length > 0).length / n,
      date: cells.filter(cell => isSerial(cell) || (typeof cell === 'string' && TEXT_DATE.test(latinDigits(cell)))).length / n,
      number: cells.filter(cell => typeof cell === 'number' || /^[\d\s,.\u066c\u066b-]+$/.test(latinDigits(String(cell)))).length / n,
      text: texts.length / n,
      distinct: new Set(texts.map(cell => foldText(cell))).size / (texts.length || 1),
      length: texts.reduce((sum, cell) => sum + String(cell).length, 0) / (texts.length || 1),
    };
  }).filter(stat => stat.filled > 0.3);
  const map = {};
  const taken = new Set();
  const take = (field, stat) => { if (stat) { map[field] = stat.col; taken.add(stat.col); } };
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

function detectLayout(rows) {
  let best = { row: -1, score: 0, columns: {} };
  rows.slice(0, 10).forEach((row, index) => {
    if (row.some(cell => splitPhones(cell).phones.length)) return;
    const columns = mapHeadings(row);
    const score = Object.keys(columns).length;
    if (score > best.score) best = { row: index, score, columns };
  });
  if (best.score >= 2) return { headerRow: best.row, columns: best.columns, guessed: false };
  return { headerRow: -1, columns: guessColumns(rows), guessed: true };
}

const amountText = value => {
  const amount = parseAmount(value);
  return amount === null ? '' : String(amount);
};

function tabClientRows(tab, layout) {
  const { columns } = layout;
  const body = tab.rows.slice(layout.headerRow + 1);
  const at = (row, field) => (columns[field] === undefined ? undefined : row[columns[field]]);
  const dates = columns.date === undefined ? [] : readDateColumn(body.map(row => at(row, 'date')));
  const out = [];
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

function paidBefore(row) {
  const expected = parseAmount(row._expected) || 0;
  const remaining = parseAmount(row._remaining);
  if (remaining !== null && expected > 0) return Math.max(0, expected - Math.max(0, remaining));
  return Math.max(0, parseAmount(row._paid) || 0);
}

module.exports = {
  detectLayout, fieldsOfHeading, foldText, latinDigits, paidBefore, parseAmount, readDateColumn, splitPhones, tabClientRows,
};
