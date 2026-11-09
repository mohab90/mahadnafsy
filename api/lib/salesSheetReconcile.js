'use strict';

// The owner's monthly sales sheet (lib/salesSheet.js) held against the system, row by row, and the target system (lib/bonusPlan.js) applied twice: once on
// the sheet's rows, once on the system's own bookings (lib/monthlyBonuses.js), side by side with the reasons they differ. READ-ONLY: it only SELECTs.
//
//   for every sheet row      the client (by phone digits — subscribers.phone_digits, phone2, then leads — else by folded name), then their booking of the
//                            month for the course the row names, and one of:
//     MATCHED          same rep, same course or track, and the agreed price (in EGP) equals the sheet's
//     DIFFERENT        the booking exists and differs: price / course / (no rep, or booked in another month) — date and branch are said in `notes`
//     REFUNDED         the client's payment for it was refunded (status 'refunded', or refunds that cover it)
//     VOIDED           the payment was voided (deleted)
//     NO_PAID_BOOKING  the client is registered but has no paid booking of that course (pending, failed, or none at all)
//     NOT_REGISTERED   no client by that phone or name (a lead is said)
//     OTHER_REP        the booking exists and belongs to another rep in the system — both are named
//   for every system booking of the month   the ones no sheet row claimed: «missing from the sheet», under the rep who owns them.

const { normalizeArabicName } = require('./linkSiteAccounts');
const { matchingSpellings } = require('./phoneNumber');
const { agreedPrice } = require('./agreedPrice');
const { bookingWeight, ladderBonus } = require('./bonusPlan');
const { monthBounds, loadPlan, bookingsOf, computeMonthlyBonuses } = require('./monthlyBonuses');
const { cairoDayOf } = require('./dates');
const { courseSimilarity } = require('./salesSheet');

const CATEGORIES = Object.freeze(['MATCHED', 'DIFFERENT', 'REFUNDED', 'VOIDED', 'NO_PAID_BOOKING', 'NOT_REGISTERED', 'OTHER_REP']);
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const PRICE_TOLERANCE = 0.01; // a client paying in another currency is converted at the payment's rate: the sheet's figure is rounded

const wordsOf = value => normalizeArabicName(value).split(' ').filter(Boolean).map(word => word.replace(/^ال(?=.{3})/, ''));
const sharedWords = (a, b) => { const second = new Set(b); return a.filter(word => second.has(word)).length; };
const digits = value => String(value ?? '').replace(/[^0-9]/g, '');
const itemKeyOf = payment => (payment.bundle_id ? `bundle:${payment.bundle_id}` : payment.course_id);

/** Every tab to the staff member it is named for: all its words are words (or starts of words) of the name; active staff and the same first name first. */
function mapTabsToStaff(tabNames, staff) {
  return tabNames.map(tab => {
    const words = wordsOf(tab);
    const candidates = words.length ? staff.map(member => {
      const theirs = wordsOf(member.name);
      const covered = words.every(word => theirs.some(other => other === word || (word.length >= 3 && other.startsWith(word))));
      return covered ? { member, score: (member.is_active ? 100 : 0) + (theirs[0] === words[0] ? 10 : 0) - (theirs.length - words.length) } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score) : [];
    if (!candidates.length) return { tab, staff: null, ambiguous: [] };
    const tied = candidates.filter(candidate => candidate.score === candidates[0].score);
    return tied.length === 1 ? { tab, staff: candidates[0].member, ambiguous: [] } : { tab, staff: null, ambiguous: tied.map(candidate => candidate.member.name) };
  });
}

/** The ladder on a rep's sheet rows (or system bookings): { bookings, amount, rounds } — per half month when the plan says so. `roundOf(item)` is 1 or 2. */
function ladderOver(plan, items, firstTarget, roundOf) {
  const sum = list => Math.round(list.reduce((total, item) => total + item.weight, 0) * 100) / 100;
  const groups = plan.salesPeriod === 'HALF_MONTH'
    ? [['1–15', items.filter(item => roundOf(item) !== 2)], ['16–آخر الشهر', items.filter(item => roundOf(item) === 2)]]
    : [['الشهر', items]];
  const rounds = groups.map(([label, list]) => ({ label, bookings: sum(list), ...ladderBonus(plan, sum(list), firstTarget) }));
  return { bookings: sum(items), amount: money(rounds.reduce((total, round) => total + round.amount, 0)), firstTarget, rounds: rounds.map(({ label, bookings, amount }) => ({ label, bookings, amount })) };
}

async function loadClients(db, tenantId, rows) {
  const phones = [...new Set(rows.flatMap(row => row.phones))];
  const spellingsOf = phone => new Set([phone, phone.replace(/^00/, ''), `00${phone}`, ...matchingSpellings(phone)]);
  const wanted = [...new Set(phones.flatMap(phone => [...spellingsOf(phone)]))];
  const byDigits = new Map();
  const add = (key, client) => { if (key) byDigits.set(key, [...(byDigits.get(key) || []), client]); };
  const columns = 'id, client_code, name, phone, phone2, phone_digits, assigned_sales_id, branch';
  if (wanted.length) {
    const [clients] = await db.query(
      `SELECT ${columns} FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL
          AND (phone_digits IN (?) OR REGEXP_REPLACE(COALESCE(phone2, ''), '[^0-9]', '') IN (?))`, [tenantId, wanted, wanted]);
    for (const client of clients) { add(String(client.phone_digits || ''), client); add(digits(client.phone2), client); }
  }
  return { spellingsOf, byDigits, columns };
}

/** The client for a row: by phone (the best name among those sharing it), else by name. */
function pickByPhone(row, lookup) {
  const found = new Map();
  for (const phone of row.phones) for (const spelling of lookup.spellingsOf(phone)) for (const client of lookup.byDigits.get(spelling) || []) found.set(client.id, client);
  if (!found.size) return null;
  const mine = wordsOf(row.name);
  const ranked = [...found.values()].map(client => ({ client, score: sharedWords(mine, wordsOf(client.name)) })).sort((a, b) => b.score - a.score);
  return { client: ranked[0].client, by: 'phone', shared: found.size > 1 ? ranked.map(item => item.client.name) : null };
}

function pickByName(row, everyone) {
  const mine = wordsOf(row.name);
  if (mine.length < 2) return { client: null, ambiguous: [] };
  const needed = Math.min(3, mine.length);
  const scored = [];
  for (const client of everyone) {
    const theirs = wordsOf(client.name);
    const shared = sharedWords(mine, theirs);
    if (shared >= needed && shared >= 0.75 * Math.min(mine.length, theirs.length)) scored.push({ client, shared, exact: mine.join(' ') === theirs.join(' ') });
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.shared - a.shared);
  if (!scored.length) return { client: null, ambiguous: [] };
  const top = scored.filter(item => item.exact === scored[0].exact && item.shared === scored[0].shared);
  return top.length === 1 ? { client: top[0].client, by: 'name', ambiguous: [] } : { client: null, ambiguous: top.map(item => item.client.name) };
}

/**
 * @param db         a pool or connection (only SELECTs are run)
 * @param sheet      what lib/salesSheet.js parseSalesSheet returns
 */
async function reconcileSalesSheet(db, { tenantId, sheet, year, month }) {
  const bounds = monthBounds(year, month);
  const start = new Date(bounds.start); const end = new Date(bounds.end);
  const inMonth = payment => { const at = new Date(payment.date); return at >= start && at < end; };
  const plan = await loadPlan(db, tenantId);
  const [staff] = await db.query('SELECT id, name, role, is_active, bonus_scheme, booking_first_target FROM staff WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]);
  const staffById = new Map(staff.map(member => [member.id, member]));
  const mapping = mapTabsToStaff(sheet.reps.map(rep => rep.tab), staff);
  const staffOfTab = new Map(mapping.map(item => [item.tab, item.staff]));

  const rows = sheet.reps.flatMap(rep => rep.rows);
  const lookup = await loadClients(db, tenantId, rows);
  const monthBookings = await bookingsOf(db, tenantId, bounds);
  const bookingByKey = new Map(monthBookings.map(booking => [`${booking.clientId}|${booking.item}`, booking]));

  // A booking's rep: the client's rep, else who recorded it — the one on the booking scheme first (the bonus's own rule).
  const ownerOf = booking => {
    const salesOnes = [booking.salesRep, booking.recordedBy].find(id => id && staffById.get(id)?.bonus_scheme === 'SALES_BOOKINGS');
    return salesOnes || booking.salesRep || booking.recordedBy || null;
  };

  // 1. the client of every row.
  let everyone = null;
  const matched = [];
  for (const row of rows) {
    let pick = pickByPhone(row, lookup);
    let ambiguous = [];
    if (!pick) {
      everyone = everyone || (await db.query('SELECT id, client_code, name, phone, phone2, phone_digits, assigned_sales_id, branch FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]))[0];
      const byName = pickByName(row, everyone);
      pick = byName.client ? { client: byName.client, by: 'name', shared: null } : null;
      ambiguous = byName.ambiguous;
    }
    matched.push({ row, client: pick ? pick.client : null, by: pick ? pick.by : null, shared: pick ? pick.shared : null, ambiguous });
  }

  // 2. what those clients paid for.
  const clientIds = [...new Set(matched.map(item => item.client?.id).filter(Boolean))];
  const itemsOf = new Map();
  const refundedAmount = new Map();
  if (clientIds.length) {
    const [payments] = await db.query(
      `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.status, p.deleted_at, p.date, p.amount, p.currency, p.staff_id, p.branch,
              COALESCE(b.title, c.title) AS title
         FROM payments p
         LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
         LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
        WHERE p.tenant_id=? AND p.subscriber_id IN (?) AND p.payment_type IN ('COURSE','BUNDLE') AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL)
        ORDER BY p.date, p.id`, [tenantId, clientIds]);
    for (const payment of payments) {
      const clientItems = itemsOf.get(payment.subscriber_id) || new Map();
      const key = itemKeyOf(payment);
      const item = clientItems.get(key) || { item: key, courseId: payment.bundle_id ? null : payment.course_id, bundleId: payment.bundle_id || null, title: payment.title || '', payments: [] };
      item.payments.push(payment);
      clientItems.set(key, item);
      itemsOf.set(payment.subscriber_id, clientItems);
    }
    const paymentIds = payments.map(payment => payment.id);
    if (paymentIds.length) {
      const [refunds] = await db.query(
        "SELECT payment_id, SUM(amount) AS amount FROM refunds WHERE tenant_id=? AND payment_id IN (?) AND status IN ('approved','done') GROUP BY payment_id", [tenantId, paymentIds]);
      for (const refund of refunds) refundedAmount.set(refund.payment_id, Number(refund.amount) || 0);
    }
  }

  // leads, for the clients not registered
  const leadOf = new Map();
  const strangers = matched.filter(item => !item.client);
  const leadSpellings = [...new Set(strangers.flatMap(item => item.row.phones.flatMap(phone => [...lookup.spellingsOf(phone)])))];
  if (leadSpellings.length) {
    const [leads] = await db.query('SELECT id, name, phone_digits, client_code FROM leads WHERE tenant_id=? AND deleted_at IS NULL AND phone_digits IN (?)', [tenantId, leadSpellings]);
    for (const lead of leads) leadOf.set(String(lead.phone_digits), lead);
  }

  const coveredByRefunds = payment => refundedAmount.has(payment.id) && refundedAmount.get(payment.id) >= Number(payment.amount) - 0.005;

  // 3. classify.
  const claimed = new Set();
  const results = [];
  const describeStaff = id => (id ? { id, name: staffById.get(id)?.name || '—' } : null);
  for (const { row, client, by, shared, ambiguous } of matched) {
    const sheetStaff = staffOfTab.get(row.tab) || null;
    const result = {
      tab: row.tab, rowNumber: row.rowNumber, name: row.name, phones: row.phones, course: row.course, day: row.day, price: row.price, deposit: row.deposit,
      branch: row.branch, round: row.round, roundByDate: row.roundByDate, roundConflict: row.roundConflict, weight: bookingWeight(plan, row.price),
      sheetRep: sheetStaff ? { id: sheetStaff.id, name: sheetStaff.name } : null,
      client: client ? { id: client.id, code: client.client_code || '', name: client.name, by } : null,
      category: 'NOT_REGISTERED', diffs: [], notes: [...row.problems], system: null,
    };
    if (shared) result.notes.push(`الرقم موجود عند أكتر من عميل: ${shared.join('، ')}`);
    if (!client) {
      const lead = row.phones.flatMap(phone => [...lookup.spellingsOf(phone)]).map(spelling => leadOf.get(spelling)).find(Boolean);
      if (lead) result.notes.push(`موجود كـ lead فقط: ${lead.name}${lead.client_code ? ` (${lead.client_code})` : ''}`);
      if (ambiguous.length) result.notes.push(`الاسم يطابق أكتر من عميل: ${ambiguous.join('، ')}`);
      results.push(result);
      continue;
    }
    if (by === 'name') result.notes.push('اتلاقى بالاسم مش بالتليفون');
    const items = [...(itemsOf.get(client.id) || new Map()).values()];
    const scored = items.map(item => {
      const key = `${client.id}|${item.item}`;
      const similarity = courseSimilarity(row.course, item.title);
      const score = (bookingByKey.has(key) ? 20 : 0) + (item.payments.some(inMonth) ? 10 : 0) + similarity * 8 - (claimed.has(key) ? 30 : 0);
      return { item, key, similarity, score, eligible: bookingByKey.has(key) || item.payments.some(inMonth) || similarity > 0 };
    }).filter(candidate => candidate.eligible).sort((a, b) => b.score - a.score);
    const chosen = scored[0] || null;
    if (!chosen) {
      result.category = 'NO_PAID_BOOKING';
      result.notes.push(items.length ? 'العميل عنده حجوزات تانية بس مفيش حجز للكورس ده' : 'العميل مسجل ومفيش له أي حجز مدفوع');
      results.push(result);
      continue;
    }
    if (claimed.has(chosen.key)) result.notes.push('نفس العميل والكورس مكرر في الشيت');
    claimed.add(chosen.key);
    const { item } = chosen;
    const booking = bookingByKey.get(chosen.key) || null;
    const live = item.payments.filter(payment => !payment.deleted_at);
    const owner = booking ? ownerOf(booking) : null;
    result.system = { item: item.item, title: item.title };

    if (!booking) {
      const refunded = live.filter(payment => payment.status === 'refunded' || coveredByRefunds(payment));
      const voided = item.payments.filter(payment => payment.deleted_at);
      const firstPaid = live.find(payment => payment.status === 'paid');
      const unpaid = live.filter(payment => ['pending', 'failed'].includes(payment.status));
      if (refunded.length && !firstPaid) {
        result.category = 'REFUNDED';
        result.system.refundedOn = cairoDayOf(refunded[0].date);
      } else if (voided.length && !firstPaid) {
        result.category = 'VOIDED';
        result.system.voidedOn = cairoDayOf(voided[0].date);
      } else if (firstPaid) {
        // paid, but its first payment is not in this month
        result.category = 'DIFFERENT';
        result.system.firstPaidOn = cairoDayOf(firstPaid.date);
        result.system.firstPaidBy = describeStaff(firstPaid.staff_id);
        result.diffs.push({ field: 'date', sheet: row.day, system: result.system.firstPaidOn, note: 'الحجز الأول للكورس ده في شهر تاني' });
        const currency = String(firstPaid.currency || 'EGP').toUpperCase();
        const agreed = await agreedPrice(db, { tenantId, subscriberId: client.id, courseId: item.courseId, bundleId: item.bundleId, currency });
        result.system.agreed = agreed == null ? null : money(agreed); result.system.currency = currency;
      } else {
        result.category = 'NO_PAID_BOOKING';
        result.system.status = unpaid.length ? unpaid[0].status : 'none';
        result.notes.push(unpaid.length ? `الدفعة ${unpaid[0].status === 'failed' ? 'فشلت' : 'لسه معلّقة'} في السيستم` : 'مفيش دفعة مدفوعة');
      }
      results.push(result);
      continue;
    }

    // a paid booking of the month: compare.
    const bookedRefund = refundedAmount.get(booking.paymentId) || 0;
    if (bookedRefund > 0) result.notes.push(`في استرداد على الدفعة: ${money(bookedRefund)} ${booking.currency}`);
    const refundedRows = item.payments.filter(payment => payment.status === 'refunded' && !payment.deleted_at);
    if (refundedRows.length) result.notes.push('في دفعات تانية للكورس ده مستردّة');
    result.system = {
      ...result.system, paymentId: booking.paymentId, day: booking.day, agreed: booking.priceEgp, currency: booking.currency, title: booking.title || item.title,
      rep: describeStaff(owner), assignedSales: describeStaff(booking.salesRep), recordedBy: describeStaff(booking.recordedBy),
      branch: (item.payments.find(payment => payment.id === booking.paymentId) || {}).branch || client.branch || null,
    };
    const priceGap = row.price - booking.priceEgp;
    if (Math.abs(priceGap) > Math.max(1, row.price * PRICE_TOLERANCE)) result.diffs.push({ field: 'price', sheet: row.price, system: booking.priceEgp, gap: money(priceGap) });
    if (chosen.similarity === 0) result.diffs.push({ field: 'course', sheet: row.course, system: result.system.title });
    if (row.day && row.day !== booking.day) {
      const gap = Math.round((Date.parse(`${row.day}T00:00:00Z`) - Date.parse(`${booking.day}T00:00:00Z`)) / 86400000);
      result.notes.push(`التاريخ مختلف: الشيت ${row.day} والسيستم ${booking.day} (${gap > 0 ? '+' : ''}${gap} يوم)`);
    }
    const systemBranch = /DAQQI|TAGAMOA/.test(String(result.system.branch || '')) ? 'DOKKI' : (result.system.branch ? 'ONLINE' : null);
    if (row.branch && systemBranch && row.branch !== systemBranch) result.notes.push(`الفرع مختلف: الشيت ${row.branch === 'DOKKI' ? 'الدقي' : 'أونلاين'} والسيستم ${systemBranch === 'DOKKI' ? 'الدقي' : 'أونلاين'}`);
    if (chosen.similarity > 0 && chosen.similarity < 0.5) result.notes.push(`اسم الكورس متقارب مش مطابق: «${row.course}» ↔ «${result.system.title}»`);
    const bookedPayment = item.payments.find(payment => payment.id === booking.paymentId);
    if (bookedPayment && coveredByRefunds(bookedPayment)) {
      result.category = 'REFUNDED';
      result.system.refundedOn = booking.day;
    } else if (sheetStaff && owner && owner !== sheetStaff.id) {
      result.category = 'OTHER_REP';
      result.diffs.unshift({ field: 'rep', sheet: sheetStaff.name, system: staffById.get(owner)?.name || '—' });
    } else if (sheetStaff && !owner) {
      result.category = 'DIFFERENT';
      result.diffs.unshift({ field: 'rep', sheet: sheetStaff.name, system: null, note: 'الحجز مالوش سيلز في السيستم' });
    } else {
      result.category = result.diffs.some(diff => diff.field === 'price' || diff.field === 'course') ? 'DIFFERENT' : 'MATCHED';
      if (!sheetStaff) result.notes.push('اسم التاب ما اتطابقش مع موظف: السيلز ما اتقارنش');
    }
    result.paired = Boolean(sheetStaff && owner === sheetStaff.id);
    result.systemWeight = bookingWeight(plan, booking.priceEgp);
    results.push(result);
  }

  // 4. the system's bookings of the month that no row of the sheet claimed.
  const missing = monthBookings.filter(booking => !claimed.has(`${booking.clientId}|${booking.item}`)).map(booking => {
    const owner = ownerOf(booking);
    return {
      owner: describeStaff(owner), ownerHasTab: [...staffOfTab.values()].some(member => member && member.id === owner),
      client: booking.client, clientCode: booking.clientCode, item: booking.title, day: booking.day, priceEgp: booking.priceEgp,
      weight: bookingWeight(plan, booking.priceEgp), recordedBy: describeStaff(booking.recordedBy),
    };
  });

  // 5. the target system, twice.
  const system = await computeMonthlyBonuses(db, { tenantId, year, month, applyAdjustments: false });
  const employeeOf = new Map(system.employees.map(employee => [employee.staffId, employee]));
  const perRep = sheet.reps.map(rep => {
    const mine = results.filter(item => item.tab === rep.tab);
    const member = staffOfTab.get(rep.tab) || null;
    const firstTarget = member && Number(member.booking_first_target) > 0 ? Number(member.booking_first_target) : null;
    const sheetItems = mine.map(item => ({ weight: item.weight, round: item.round, roundByDate: item.roundByDate }));
    const sheetSide = ladderOver(plan, sheetItems, firstTarget, item => item.round);
    const sheetByDate = ladderOver(plan, sheetItems, firstTarget, item => item.roundByDate ?? item.round);
    const sheetFirst = Object.fromEntries([10, 15, 20].map(target => [target, ladderOver(plan, sheetItems, target, item => item.round).amount]));
    const counts = Object.fromEntries(CATEGORIES.map(category => [category, mine.filter(item => item.category === category).length]));
    const weightOf = list => Math.round(list.reduce((total, item) => total + item.weight, 0) * 100) / 100;
    let systemSide = null;
    let systemItems = [];
    if (member) {
      const employee = employeeOf.get(member.id);
      const owned = monthBookings.filter(booking => ownerOf(booking) === member.id).map(booking => ({ weight: bookingWeight(plan, booking.priceEgp), day: booking.day, booking }));
      systemItems = owned;
      const here = ladderOver(plan, owned, firstTarget, item => (Number(item.day.slice(8, 10)) <= 15 ? 1 : 2));
      systemSide = employee
        ? { ...here, amount: employee.ladder ? employee.ladder.amount : here.amount, total: employee.total, onScheme: true, rounds: employee.ladder?.rounds?.length ? employee.ladder.rounds.map(({ label, bookings, amount }) => ({ label, bookings, amount })) : here.rounds }
        : { ...here, total: here.amount, onScheme: false };
    }
    const reasons = [];
    if (systemSide) {
      const lost = (category, label) => {
        const list = mine.filter(item => item.category === category);
        if (list.length) reasons.push({ kind: category, label, rows: list.length, weight: weightOf(list) });
      };
      lost('NOT_REGISTERED', 'عملاء في الشيت مش مسجلين في السيستم');
      lost('NO_PAID_BOOKING', 'عملاء مسجلين بدون حجز مدفوع للكورس');
      lost('REFUNDED', 'حجوزات في الشيت واتعملها استرداد');
      lost('VOIDED', 'حجوزات في الشيت ودفعتها اتمسحت');
      lost('OTHER_REP', 'حجوزات في الشيت وفي السيستم باسم سيلز تاني');
      const unpaired = mine.filter(item => item.category === 'DIFFERENT' && !item.paired);
      if (unpaired.length) reasons.push({ kind: 'DIFFERENT', label: 'حجوزات في الشيت مالهاش حجز في الشهر ده في السيستم', rows: unpaired.length, weight: weightOf(unpaired) });
      const priceShift = mine.filter(item => item.paired && item.systemWeight !== item.weight);
      if (priceShift.length) {
        reasons.push({ kind: 'PRICE', label: 'حجوزات سعرها مختلف فاختلف عدد الحجوزات اللي بتتحسب', rows: priceShift.length, weight: money(priceShift.reduce((total, item) => total + item.weight - item.systemWeight, 0)) });
      }
      const pairedKeys = new Set(mine.filter(item => item.paired).map(item => item.system.paymentId));
      const notInSheet = systemItems.filter(item => !pairedKeys.has(item.booking.paymentId));
      if (notInSheet.length) {
        reasons.push({ kind: 'MISSING_FROM_TAB', label: 'حجوزات في السيستم باسمه وملهاش صف في التاب بتاعه', rows: notInSheet.length, weight: -weightOf(notInSheet) });
      }
      if (plan.salesPeriod === 'HALF_MONTH' && sheetSide.amount !== sheetByDate.amount) {
        reasons.push({ kind: 'ROUNDS', label: 'فاصل «النص التانى» في الشيت مش على 15/16 بالتاريخ (بالتاريخ المكافأة كانت ' + sheetByDate.amount + ')', rows: mine.filter(item => item.roundConflict).length, weight: 0 });
      }
    }
    return {
      tab: rep.tab, staff: member ? { id: member.id, name: member.name, firstTarget, active: Boolean(member.is_active), scheme: member.bonus_scheme } : null,
      rowsByRound: { 1: mine.filter(item => item.round === 1).length, 2: mine.filter(item => item.round === 2).length },
      rows: mine.length, counts, sheetWeight: weightOf(mine),
      sheet: { byMarker: sheetSide, byDate: sheetByDate, byFirstTarget: sheetFirst },
      system: systemSide, difference: systemSide ? money(sheetSide.amount - systemSide.amount) : null, reasons,
      missingFromTab: missing.filter(item => member && item.owner?.id === member.id).length,
    };
  });

  const courseNames = [...results.reduce((map, item) => {
    const key = `${item.course}|${item.system?.title || ''}`;
    if (!map.has(key)) map.set(key, { sheet: item.course, system: item.system?.title || null, rows: 0 });
    map.get(key).rows += 1;
    return map;
  }, new Map()).values()].sort((a, b) => b.rows - a.rows);

  return {
    month: `${year}-${String(month).padStart(2, '0')}`, from: bounds.first, to: bounds.last, generatedAt: new Date().toISOString(),
    totals: { rows: results.length, ...Object.fromEntries(CATEGORIES.map(category => [category, results.filter(item => item.category === category).length])), missingFromSheet: missing.length, systemBookings: monthBookings.length },
    tabs: mapping.map(item => ({ tab: item.tab, staff: item.staff ? { id: item.staff.id, name: item.staff.name } : null, ambiguous: item.ambiguous })),
    rows: results, missingFromSheet: missing, perRep, unreadable: sheet.unreadable, courseNames,
    plan: { salesPeriod: plan.salesPeriod },
  };
}

module.exports = { CATEGORIES, mapTabsToStaff, ladderOver, reconcileSalesSheet };
