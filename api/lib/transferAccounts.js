'use strict';

/**
 * One account, one name on the transfers ledger.
 *
 * «في صفحة التحويلات في الحسابات في حساب رقم 1010 وحساب 1079 دول حساب واحد ادمجهم على بعض بالحساب
 * المسجل حاليا على السيستم … كمان بيظهر حسابين رقم 4645 ليه؟ ادمجهم في واحد» (16 Oct 2026).
 *
 * The ledger's «وصل على» is free text — the box the manager picked, or the name of the sheet tab the
 * money was imported from — so the same account arrives under several names: a wallet by the first four
 * digits of its number («1010»), by the last four («1079»), by the whole number («1010351079»), with or
 * without the rail in front. This finds those, says which name the system already knows (the one in
 * «طرق الدفع» in the settings) and moves the rest onto it.
 *
 * Two names are one account when they name no different rail and one of their numbers is the other, or
 * its beginning, or its end — or when the money of a single imported sheet sits under both, which is
 * the ledger telling us they were the same sheet. «اورانج كاش 7720» is not «انستا باى 01505887720»
 * although one number ends in the other: two rails.
 */

const RAILS = ['انستا', 'فودافون', 'اورانج', 'وي باي', 'اتصالات', 'سعود', 'بنك'];

const latinDigits = value => String(value ?? '')
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const fold = value => latinDigits(value)
  .replace(/[‎‏‪-‮]/g, '')
  .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[ً-ٟـ]/g, '')
  .replace(/وى باى/g, 'وي باي').replace(/باى/g, 'باي')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const numbersOf = value => (fold(value).match(/\d{4,}/g) || []).map(n => n.replace(/^0+(?=\d{4})/, ''));
const railsOf = value => { const text = fold(value); return RAILS.filter(word => text.includes(word)); };

/** The same number, or one is the start or the end of the other (the shorter at least four digits). */
const numbersRelated = (a, b) => {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && (long.startsWith(short) || long.endsWith(short));
};

/** Two rails are compatible unless both are named and they share none. */
const railsCompatible = (a, b) => !a.length || !b.length || a.some(word => b.includes(word));

const sameAccountName = (a, b) => {
  if (fold(a) === fold(b)) return true;
  if (!railsCompatible(railsOf(a), railsOf(b))) return false;
  const na = numbersOf(a);
  const nb = numbersOf(b);
  return na.some(x => nb.some(y => numbersRelated(x, y)));
};

/** The sheet tab a row was imported from: the «…» in its note. */
const sheetOf = note => {
  const match = /«([^»]{3,60})»/.exec(String(note || ''));
  return match ? fold(match[1]) : '';
};

/**
 * Groups of two or more names that are one account.
 *   accounts    [{ name, rows, total }]            what is on the ledger
 *   sheets      Map<sheetName, Set<accountName>>   the accounts one imported sheet's rows landed on
 *   registered  [name]                              the boxes in the settings
 * → [{ target, members: [{ name, rows, total, registered }], why }] — the target is the registered
 * name when the group has one, else the name with most rows.
 */
function groupAccounts(accounts, { sheets = new Map(), registered = [] } = {}) {
  const list = accounts.filter(account => account.name);
  const parent = list.map((_, index) => index);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map();
  const join = (i, j, why) => {
    const a = find(i); const b = find(j);
    if (a === b) return;
    // A group never takes in two different rails, however the pair got there.
    const railsA = list.filter((_, k) => find(k) === a).flatMap(account => railsOf(account.name));
    const railsB = list.filter((_, k) => find(k) === b).flatMap(account => railsOf(account.name));
    if (!railsCompatible([...new Set(railsA)], [...new Set(railsB)])) return;
    parent[b] = a;
    reasons.set(a, why);
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (sameAccountName(list[i].name, list[j].name)) join(i, j, 'نفس رقم الحساب');
    }
  }
  const indexOf = new Map(list.map((account, index) => [account.name, index]));
  for (const [, names] of sheets) {
    const present = [...names].filter(name => indexOf.has(name));
    for (let k = 1; k < present.length; k++) join(indexOf.get(present[0]), indexOf.get(present[k]), 'نفس ملف التحويلات');
  }
  const registeredFolded = registered.map(fold);
  const buckets = new Map();
  list.forEach((account, index) => {
    const root = find(index);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(account);
  });
  return [...buckets.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const marked = members.map(member => ({ ...member, registered: registeredFolded.includes(fold(member.name)) }));
      const target = marked.find(member => member.registered)
        // Else the name that says what it is («فودافون كاش 4645» over «1094124645»), then the busiest.
        || [...marked].sort((a, b) => (railsOf(b.name).length - railsOf(a.name).length) || b.rows - a.rows || b.name.length - a.name.length)[0];
      return { target: target.name, members: marked, why: reasons.get(root) || 'نفس رقم الحساب' };
    });
}

/** The ledger's accounts and the sheets they came from, ready for groupAccounts. */
async function loadAccounts(db, tenantId) {
  const [rows] = await db.query(
    `SELECT method, COUNT(*) AS rows_n, SUM(amount) AS total FROM incoming_transfers
      WHERE tenant_id=? GROUP BY method`, [tenantId]);
  const accounts = rows.map(row => ({ name: row.method, rows: Number(row.rows_n) || 0, total: Number(row.total) || 0 }));
  const [noted] = await db.query(
    `SELECT method, note FROM incoming_transfers WHERE tenant_id=? AND note LIKE '%من ملف التحويلات%'`, [tenantId]);
  const sheets = new Map();
  for (const row of noted) {
    const sheet = sheetOf(row.note);
    if (!sheet) continue;
    if (!sheets.has(sheet)) sheets.set(sheet, new Set());
    sheets.get(sheet).add(row.method);
  }
  return { accounts, sheets };
}

/**
 * Move `from` accounts onto `to`. A transfer whose operation number is already on `to` cannot move
 * (the ledger records a number once per box); those are returned, not forced, so they are looked at.
 */
async function mergeAccounts(db, { tenantId, from, to }) {
  const target = String(to || '').trim();
  const sources = [...new Set((from || []).map(name => String(name || '').trim()).filter(name => name && name !== target))];
  if (!target) throw Object.assign(new Error('اختار الحساب اللي هيتجمع فيه'), { statusCode: 400 });
  if (!sources.length) throw Object.assign(new Error('اختار حساب واحد على الأقل يتدمج'), { statusCode: 400 });
  let moved = 0;
  for (const source of sources) {
    const [result] = await db.query(
      'UPDATE IGNORE incoming_transfers SET method=? WHERE tenant_id=? AND method=?', [target, tenantId, source]);
    moved += result.affectedRows || 0;
  }
  const [stuck] = await db.query(
    `SELECT id, method, reference, amount, currency FROM incoming_transfers WHERE tenant_id=? AND method IN (?) ORDER BY reference`,
    [tenantId, sources]);
  return { moved, target, stuck };
}

module.exports = { groupAccounts, loadAccounts, mergeAccounts, sameAccountName, numbersOf, railsOf, fold, sheetOf };
