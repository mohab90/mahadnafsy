'use strict';

// The collection employees' monthly sheet (lib/collectionSheet.js) held against the system, row by row (9 Nov 2026): is every payment the sheet says an employee
// collected in the system, and under the same employee? READ-ONLY: it only SELECTs.
//
//   a row's client     by the client's phone digits (every spelling: lib/phoneNumber.js), else by the folded name, else by the sender's number (said)
//   a row's payment    a PAID, undeleted payment of that client for the same amount (in EGP, or in the payment's own currency) within ±3 days of the sheet's date;
//                      one row can be two or three payments that add up to it
//   FOUND_SAME         found, recorded by the tab's employee (payments.staff_id)
//   OTHER_EMPLOYEE     found, recorded by someone else (named; «بدون موظف» for the site's own)
//   TYPE_MISMATCH      found under the same employee, but a certificate recorded as course money, or the reverse (a carnet, a book, a consultation too)
//   DIFFERENT          the client has the payment, but not for that amount, or not on that date (±3 days): which one is said
//   NOT_IN_SYSTEM      the client is registered and has no such payment (a voided or refunded one is said)
//   UNPAID_IN_SYSTEM   the system has the payment — same amount, within the days — but FAILED or still PENDING: not paid
//   NOT_REGISTERED     no client by that phone or name (a lead is said)
//   and the other way round: every paid payment of the month recorded by a collector that no row claims, per collector, with the totals sheet vs system.

const { cairoDayOf } = require('./dates');
const { monthBounds } = require('./monthlyBonuses');
const { mapTabsToStaff, loadClients, pickByPhone, pickByName } = require('./salesSheetReconcile');

const CATEGORIES = Object.freeze(['FOUND_SAME', 'OTHER_EMPLOYEE', 'TYPE_MISMATCH', 'DIFFERENT', 'NOT_IN_SYSTEM', 'UNPAID_IN_SYSTEM', 'NOT_REGISTERED']);
const DAY_WINDOW = 3;
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const dayNumber = day => Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000);
const kindOfPayment = type => (['CERTIFICATE', 'CARNEH', 'BOOK', 'CONSULTATION'].includes(type) ? type : 'COURSE');

/** The payment's amount in EGP (its own, or at its rate). */
const egpOf = payment => {
  const own = Number(payment.amount_egp);
  if (own > 0) return own;
  const rate = String(payment.currency || 'EGP').toUpperCase() === 'EGP' ? 1 : Number(payment.fx_rate_to_egp) || 0;
  return (Number(payment.amount) || 0) * rate;
};
const sameMoney = (sheet, value) => Math.abs(sheet - value) <= Math.max(1, sheet * 0.005);
/** True when the payment, in EGP or in its own currency, is the sheet's amount. */
const isAmount = (sheet, payment) => sameMoney(sheet, egpOf(payment)) || sameMoney(sheet, Number(payment.amount) || 0);

/** One payment, or two or three of them, that make the sheet's amount (the nearest dates first). */
function payingSet(amount, candidates) {
  const single = candidates.filter(payment => isAmount(amount, payment));
  if (single.length) return single.map(payment => [payment]);
  const pool = candidates.slice(0, 8); const found = [];
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) {
    if (sameMoney(amount, egpOf(pool[a]) + egpOf(pool[b]))) found.push([pool[a], pool[b]]);
    for (let c = b + 1; c < pool.length; c++) if (sameMoney(amount, egpOf(pool[a]) + egpOf(pool[b]) + egpOf(pool[c]))) found.push([pool[a], pool[b], pool[c]]);
  }
  return found;
}

/**
 * @param db     a pool or connection (only SELECTs are run)
 * @param sheet  what lib/collectionSheet.js parseCollectionSheet returns
 */
async function reconcileCollectionSheet(db, { tenantId, sheet, year, month, tabMap = null }) {
  const bounds = monthBounds(year, month);
  const start = new Date(bounds.start); const end = new Date(bounds.end);
  const [staff] = await db.query('SELECT id, name, role, is_active, bonus_scheme FROM staff WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]);
  const staffById = new Map(staff.map(member => [member.id, member]));
  const mapping = mapTabsToStaff(sheet.collectors.map(tab => tab.tab), staff, tabMap);
  const staffOfTab = new Map(mapping.map(item => [item.tab, item.staff]));
  const describe = id => (id ? { id, name: staffById.get(id)?.name || '—' } : null);

  const rows = sheet.collectors.flatMap(tab => tab.rows);
  // every number of every row (the client's and the sender's) is looked up in one query
  const lookup = await loadClients(db, tenantId, rows.map(row => ({ phones: [...row.phones, ...row.senderPhones] })));
  let everyone = null;
  const clientOf = new Map();
  for (const row of rows) {
    const key = `${row.tab}|${row.rowNumber}`;
    let pick = row.phones.length ? pickByPhone({ phones: row.phones, name: row.name }, lookup) : null;
    let ambiguous = [];
    if (!pick) {
      everyone = everyone || (await db.query('SELECT id, client_code, name, phone, phone2, phone_digits, assigned_sales_id, branch FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]))[0];
      const byName = pickByName(row, everyone);
      pick = byName.client ? { client: byName.client, by: 'name', shared: null } : null;
      ambiguous = byName.ambiguous;
    }
    if (!pick && row.senderPhones.length) {
      pick = pickByPhone({ phones: row.senderPhones, name: row.name }, lookup);
      if (pick) pick = { ...pick, by: 'sender-phone' };
    }
    clientOf.set(key, { pick, ambiguous });
  }

  // what those clients paid (every payment, so a voided or refunded one can be said)
  const clientIds = [...new Set([...clientOf.values()].map(item => item.pick?.client.id).filter(Boolean))];
  const paymentsOf = new Map();
  if (clientIds.length) {
    const [payments] = await db.query(
      `SELECT p.id, p.subscriber_id, p.payment_type, p.status, p.deleted_at, p.date, p.amount, p.currency, p.fx_rate_to_egp, p.amount_egp, p.staff_id, p.payment_method,
              COALESCE(b.title, c.title) AS title
         FROM payments p
         LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
         LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
        WHERE p.tenant_id=? AND p.subscriber_id IN (?) ORDER BY p.date, p.id`, [tenantId, clientIds]);
    for (const payment of payments) paymentsOf.set(payment.subscriber_id, [...(paymentsOf.get(payment.subscriber_id) || []), { ...payment, day: cairoDayOf(payment.date) }]);
  }
  const leadOf = new Map();
  const strangers = rows.filter(row => !clientOf.get(`${row.tab}|${row.rowNumber}`).pick);
  const leadSpellings = [...new Set(strangers.flatMap(row => [...row.phones, ...row.senderPhones].flatMap(phone => [...lookup.spellingsOf(phone)])))];
  if (leadSpellings.length) {
    const [leads] = await db.query('SELECT id, name, phone_digits, client_code FROM leads WHERE tenant_id=? AND deleted_at IS NULL AND phone_digits IN (?)', [tenantId, leadSpellings]);
    for (const lead of leads) leadOf.set(String(lead.phone_digits), lead);
  }

  // classify
  const claimed = new Map(); // payment id → the tab whose row claimed it
  const results = [];
  const shapePayment = payment => ({
    id: payment.id, day: payment.day, amount: money(payment.amount), currency: payment.currency, amountEgp: money(egpOf(payment)), type: payment.payment_type || 'COURSE',
    staff: describe(payment.staff_id), method: payment.payment_method || null, title: payment.title || null,
  });
  for (const tab of sheet.collectors) {
    const member = staffOfTab.get(tab.tab) || null;
    for (const row of tab.rows) {
      const { pick, ambiguous } = clientOf.get(`${row.tab}|${row.rowNumber}`);
      const result = {
        tab: row.tab, rowNumber: row.rowNumber, name: row.name, phones: row.phones, senderPhones: row.senderPhones, text: row.text, kinds: row.kinds, amount: row.amount,
        day: row.day, inMonth: row.inMonth, method: row.method, employee: member ? { id: member.id, name: member.name } : null,
        client: pick ? { id: pick.client.id, code: pick.client.client_code || '', name: pick.client.name, by: pick.by } : null,
        category: 'NOT_REGISTERED', flags: [], notes: [...row.problems], payments: [],
      };
      if (pick && pick.shared) result.notes.push(`الرقم موجود عند أكتر من عميل: ${pick.shared.join('، ')}`);
      if (pick && pick.by === 'name') result.notes.push('اتلاقى بالاسم مش بالتليفون');
      if (pick && pick.by === 'sender-phone') result.notes.push('اتلاقى برقم المحوّل مش برقم العميل');
      if (!pick) {
        const lead = [...row.phones, ...row.senderPhones].flatMap(phone => [...lookup.spellingsOf(phone)]).map(spelling => leadOf.get(spelling)).find(Boolean);
        if (lead) result.notes.push(`موجود كـ lead فقط: ${lead.name}${lead.client_code ? ` (${lead.client_code})` : ''}`);
        if (ambiguous.length) result.notes.push(`الاسم يطابق أكتر من عميل: ${ambiguous.join('، ')}`);
        results.push(result);
        continue;
      }
      const all = paymentsOf.get(pick.client.id) || [];
      const live = all.filter(payment => payment.status === 'paid' && !payment.deleted_at);
      const near = live.filter(payment => row.day && Math.abs(dayNumber(payment.day) - dayNumber(row.day)) <= DAY_WINDOW)
        .sort((a, b) => Math.abs(dayNumber(a.day) - dayNumber(row.day)) - Math.abs(dayNumber(b.day) - dayNumber(row.day)));
      const sets = payingSet(row.amount, near.filter(payment => !claimed.has(payment.id)));
      // the set the tab's employee recorded first, then the one with the fewest payments, then the nearest date
      const score = set => (member && set.every(payment => payment.staff_id === member.id) ? 0 : 10) + set.length;
      const chosen = [...sets].sort((a, b) => score(a) - score(b))[0] || null;
      if (chosen) {
        for (const payment of chosen) claimed.set(payment.id, row.tab);
        result.payments = chosen.map(shapePayment);
        const staffIds = [...new Set(chosen.map(payment => payment.staff_id))];
        if (chosen.length > 1) result.notes.push(`${chosen.length} دفعات في السيستم مجموعها المبلغ ده`);
        const mismatched = chosen.filter(payment => !row.kinds.includes(kindOfPayment(payment.payment_type)));
        if (mismatched.length) result.flags.push('TYPE_MISMATCH');
        if (member && staffIds.every(id => id === member.id)) result.category = mismatched.length ? 'TYPE_MISMATCH' : 'FOUND_SAME';
        else if (!member) { result.category = mismatched.length ? 'TYPE_MISMATCH' : 'FOUND_SAME'; result.notes.push('اسم التاب ما اتطابقش مع موظف: الموظف ما اتقارنش'); }
        else result.category = 'OTHER_EMPLOYEE';
        if (result.category === 'OTHER_EMPLOYEE' && staffIds.includes(null)) result.notes.push('الدفعة من غير موظف (الموقع)');
        if (mismatched.length) {
          result.notes.push(`النوع: الشيت ${row.kinds.join(' + ')} · السيستم ${mismatched.map(payment => kindOfPayment(payment.payment_type)).join(' + ')}`);
        }
        const days = chosen.map(payment => Math.round(dayNumber(payment.day) - dayNumber(row.day)));
        if (row.day && days.some(gap => gap !== 0)) result.notes.push(`التاريخ: الشيت ${row.day} والسيستم ${chosen.map(payment => payment.day).join(' / ')}`);
        results.push(result);
        continue;
      }
      // not found: the same amount on another date, or the same date with another amount
      const sameAmount = live.filter(payment => !claimed.has(payment.id) && isAmount(row.amount, payment))
        .sort((a, b) => Math.abs(dayNumber(a.day) - dayNumber(row.day || a.day)) - Math.abs(dayNumber(b.day) - dayNumber(row.day || b.day)))[0];
      const sameDay = near.filter(payment => !claimed.has(payment.id))
        .sort((a, b) => Math.abs(egpOf(a) - row.amount) - Math.abs(egpOf(b) - row.amount))[0];
      const differing = sameAmount || sameDay;
      if (differing) {
        claimed.set(differing.id, row.tab);
        result.category = 'DIFFERENT';
        result.payments = [shapePayment(differing)];
        if (sameAmount) {
          const gap = row.day ? Math.round(dayNumber(differing.day) - dayNumber(row.day)) : null;
          result.diffs = [{ field: 'date', sheet: row.day, system: differing.day, gap }];
        } else {
          result.diffs = [{ field: 'amount', sheet: row.amount, system: money(egpOf(differing)), gap: money(row.amount - egpOf(differing)) }];
        }
        if (member && differing.staff_id !== member.id) result.flags.push('OTHER_EMPLOYEE');
        if (!row.kinds.includes(kindOfPayment(differing.payment_type))) result.flags.push('TYPE_MISMATCH');
        results.push(result);
        continue;
      }
      result.category = 'NOT_IN_SYSTEM';
      const unlive = all.filter(payment => row.day && Math.abs(dayNumber(payment.day) - dayNumber(row.day)) <= DAY_WINDOW && isAmount(row.amount, payment) && !(payment.status === 'paid' && !payment.deleted_at));
      // a payment that is there but FAILED or PENDING is its own answer: not paid, rather than not there
      const waiting = unlive.find(payment => !payment.deleted_at && ['pending', 'failed'].includes(payment.status));
      if (waiting) {
        result.category = 'UNPAID_IN_SYSTEM';
        result.notes.push(`في السيستم دفعة بنفس المبلغ والتاريخ لكنها ${waiting.status === 'failed' ? 'فاشلة' : 'معلّقة'} (مش مدفوعة)`);
        result.payments = [shapePayment(waiting)];
      } else if (unlive.length) {
        const state = unlive[0].deleted_at ? 'ممسوحة' : 'مستردّة';
        result.notes.push(`في السيستم دفعة بنفس المبلغ والتاريخ لكنها ${state}`);
        result.payments = [shapePayment(unlive[0])];
      } else if (!all.length) result.notes.push('العميل مسجل ومفيش له أي دفعة');
      results.push(result);
    }
  }

  // the other way round: this month's paid payments of the collectors that no row claims
  const [monthPayments] = await db.query(
    `SELECT p.id, p.subscriber_id, p.payment_type, p.date, p.amount, p.currency, p.fx_rate_to_egp, p.amount_egp, p.staff_id, p.payment_method,
            s.name AS client_name, s.client_code, COALESCE(b.title, c.title) AS title
       FROM payments p
       LEFT JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
       LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
       LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.date >= ? AND p.date < ? ORDER BY p.date, p.id`, [tenantId, start, end]);
  const tabEmployees = new Set([...staffOfTab.values()].filter(Boolean).map(member => member.id));
  const collectors = new Set([...tabEmployees, ...staff.filter(member => ['COLLECTION', 'COLLECTION_BOOKINGS'].includes(member.bonus_scheme)).map(member => member.id)]);
  const tabOfEmployee = new Map([...staffOfTab.entries()].filter(([, member]) => member).map(([tab, member]) => [member.id, tab]));
  // a collector's payment is missing from their tab when no row of THEIR tab claimed it (a row of another tab may have: said)
  const missing = monthPayments.filter(payment => {
    if (!collectors.has(payment.staff_id)) return false;
    const ownTab = tabOfEmployee.get(payment.staff_id);
    return ownTab ? claimed.get(payment.id) !== ownTab : !claimed.has(payment.id);
  }).map(payment => ({
    employee: describe(payment.staff_id), employeeHasTab: tabEmployees.has(payment.staff_id), client: payment.client_name || '—', clientCode: payment.client_code || '',
    day: cairoDayOf(payment.date), amount: money(payment.amount), currency: payment.currency, amountEgp: money(egpOf(payment)), type: payment.payment_type || 'COURSE',
    method: payment.payment_method || null, title: payment.title || null, claimedByTab: claimed.get(payment.id) || null,
  }));

  const sum = list => money(list.reduce((total, item) => total + item.amount, 0));
  const PAIRED = ['FOUND_SAME', 'TYPE_MISMATCH', 'OTHER_EMPLOYEE', 'DIFFERENT'];
  const perCollector = sheet.collectors.map(tab => {
    const member = staffOfTab.get(tab.tab) || null;
    const mine = results.filter(item => item.tab === tab.tab);
    const counts = Object.fromEntries(CATEGORIES.map(category => [category, mine.filter(item => item.category === category).length]));
    const amounts = Object.fromEntries(CATEGORIES.map(category => [category, sum(mine.filter(item => item.category === category))]));
    const inMonth = mine.filter(item => item.inMonth !== false);
    const systemMine = member ? monthPayments.filter(payment => payment.staff_id === member.id) : [];
    const systemTotal = money(systemMine.reduce((total, payment) => total + egpOf(payment), 0));
    const missingMine = member ? missing.filter(item => item.employee?.id === member.id) : [];
    // sheet − system, in exact pieces: the rows of the month either hold one of this employee's payments (paired) or not; the employee's payments either are held or not
    const paired = inMonth.filter(item => PAIRED.includes(item.category) && item.payments.some(payment => payment.staff?.id === member?.id));
    const unpaired = inMonth.filter(item => !paired.includes(item));
    const systemIds = new Set(systemMine.map(payment => payment.id));
    const pairedPayments = new Map(paired.flatMap(item => item.payments).filter(payment => payment.staff?.id === member?.id && systemIds.has(payment.id)).map(payment => [payment.id, payment]));
    const pairedSystem = money([...pairedPayments.values()].reduce((total, payment) => total + payment.amountEgp, 0));
    const unpairedSystem = systemMine.filter(payment => !pairedPayments.has(payment.id));
    const by = category => unpaired.filter(item => item.category === category || (category === 'OTHER_EMPLOYEE' && item.category === 'DIFFERENT'));
    return {
      tab: tab.tab, employee: member ? { id: member.id, name: member.name } : null, rows: mine.length, counts, amounts,
      sheetTotal: sum(inMonth), sheetTotalAll: sum(mine), sheetOutsideMonth: money(sum(mine) - sum(inMonth)),
      systemTotal, systemPayments: systemMine.length, missingFromTab: { count: missingMine.length, amount: money(missingMine.reduce((total, item) => total + item.amountEgp, 0)) },
      difference: member ? money(sum(inMonth) - systemTotal) : null,
      reasons: member ? [
        { kind: 'NOT_REGISTERED', label: 'عملاء مش مسجلين', rows: by('NOT_REGISTERED').length, amount: sum(by('NOT_REGISTERED')) },
        { kind: 'NOT_IN_SYSTEM', label: 'دفعات مش في السيستم', rows: by('NOT_IN_SYSTEM').length, amount: sum(by('NOT_IN_SYSTEM')) },
        { kind: 'UNPAID_IN_SYSTEM', label: 'دفعات في السيستم بس فاشلة/معلّقة', rows: by('UNPAID_IN_SYSTEM').length, amount: sum(by('UNPAID_IN_SYSTEM')) },
        { kind: 'OTHER_EMPLOYEE', label: 'دفعات في السيستم باسم موظف تاني', rows: by('OTHER_EMPLOYEE').length, amount: sum(by('OTHER_EMPLOYEE')) },
        { kind: 'PAIRED_GAP', label: 'فرق المبالغ في الدفعات الموجودة', rows: paired.length, amount: money(sum(paired) - pairedSystem) },
        { kind: 'MISSING_FROM_TAB', label: 'دفعات في السيستم باسمه مش في التاب', rows: unpairedSystem.length, amount: -money(unpairedSystem.reduce((total, payment) => total + egpOf(payment), 0)) },
      ].filter(reason => (reason.kind === 'PAIRED_GAP' ? reason.amount : (reason.rows || reason.amount))) : [],
    };
  });

  return {
    month: `${year}-${String(month).padStart(2, '0')}`, from: bounds.first, to: bounds.last, generatedAt: new Date().toISOString(),
    totals: {
      rows: results.length, ...Object.fromEntries(CATEGORIES.map(category => [category, results.filter(item => item.category === category).length])),
      TYPE_FLAGS: results.filter(item => item.flags.includes('TYPE_MISMATCH')).length, outsideMonth: results.filter(item => item.inMonth === false).length,
      missingFromSheet: missing.length, systemPayments: monthPayments.length, sheetAmount: sum(results), systemAmount: money(monthPayments.reduce((total, payment) => total + egpOf(payment), 0)),
    },
    tabs: mapping.map(item => ({ tab: item.tab, employee: item.staff ? { id: item.staff.id, name: item.staff.name } : null, ambiguous: item.ambiguous, via: item.via, mapError: item.mapError || null })),
    rows: results, missingFromSheet: missing, perCollector, unreadable: sheet.unreadable,
  };
}

module.exports = { CATEGORIES, reconcileCollectionSheet, payingSet };
