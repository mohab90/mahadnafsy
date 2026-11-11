'use strict';

// One month's bonus of every employee on a bonus scheme (staff.bonus_scheme, migration 381), by the institute's plan (lib/bonusPlan.js), from the payments
// themselves — and, when HR asks, written as one bonus per employee awaiting approval (employee_bonuses, source 'BONUS_PLAN'), which payroll takes once it is
// APPROVED like any other. Nothing is paid by working it out.
//
//   a booking        the first paid payment of a client for a course or a track (a second instalment, a retake or a replay is not one), in the Cairo month
//                    it was paid in. Its price is the client's agreed price (lib/agreedPrice.js) at the rate of that payment, in EGP.
//   whose booking    SALES_BOOKINGS: the rep the client belongs to, else the one who recorded it. COLLECTION_BOOKINGS (the desk): the one who recorded it,
//                    else the client's collection officer. One booking can count for a rep and for a desk.
//                    A late-uploaded booking can be counted in the month before or after its own for a rep (COUNT_IN_MONTH, lib/bonusAdjustments.js): there it counts
//                    on the day the month nearest to its own ends (the last day of the month it is counted in when it was paid after it, the first when before), and
//                    in its own month it is not counted for the reps. Nothing about the payment changes.
//   collected        the money a collector recorded, paid in the month, in EGP at the payment's own rate: the course and track money AND the certificates' (11 Nov 2026, the
//                    owner: certificate money is collection, not sales — it counts for a collector, never for a rep's bookings or revenue, lib/repRevenue.js).
//   SALES_BOOKINGS        the booking ladder on the weighted bookings (+ the course page's sales bonus, only while the plan switches it on)
//   COLLECTION            the collector's level on what they collected
//   COLLECTION_BOOKINGS   the collector's level + each booking's desk bonus from its course page («المكافأة المسجلة داخل كل كورس»)

const { getTenantSetting } = require('./tenantSettings');
const { agreedPrices } = require('./agreedPrice');
const { normalizeBonuses } = require('./priceTiers');
const { addDaysToDateOnly, cairoDayOf, cairoDayStartUtc } = require('./dates');
const { normalizePlan, bookingWeight, ladderBonus, normalizeLevels, collectionBonus, courseBonusAmount, splitDayOf, roundOfDay, roundLabels } = require('./bonusPlan');
const { listAdjustments, listCountedElsewhere } = require('./bonusAdjustments');

const SOURCE = 'BONUS_PLAN';
const SCHEME_LABEL = { SALES_BOOKINGS: 'حجوزات (سيلز)', COLLECTION: 'تحصيل', COLLECTION_BOOKINGS: 'تحصيل + حجوزات' };
const money = value => Math.round((Number(value) || 0) * 100) / 100;

function monthBounds(year, month) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { first, start: cairoDayStartUtc(first), end: cairoDayStartUtc(next), last: addDaysToDateOnly(next, -1) };
}

async function loadPlan(db, tenantId) {
  return normalizePlan(await getTenantSetting('bonus_plan', { tenantId, fallback: {}, db }));
}

/**
 * The bookings of one or more time ranges: one per client and item, at the first paid payment, with what it is worth in EGP. A booking belongs to a range when its first payment
 * was paid inside it, or (`include`) was named to be counted there although paid outside it. Everything is read in a fixed number of queries whatever the number of bookings or
 * ranges — the prices of all of them in one go (lib/agreedPrice.js agreedPrices) — so a month of 700 bookings costs what a month of 7 does.
 * @param {{ start, end, include?: string[] }[]} ranges
 * @returns {Promise<object[][]>} one list per range, in the order given
 */
async function bookingsInRanges(db, tenantId, ranges) {
  const windows = ranges.map(range => ({ from: new Date(range.start).getTime(), to: new Date(range.end).getTime(), include: new Set(range.include || []) }));
  const earliest = ranges.reduce((best, range) => (new Date(range.start) < new Date(best.start) ? range : best));
  const latest = ranges.reduce((best, range) => (new Date(range.end) > new Date(best.end) ? range : best));
  const include = [...new Set(ranges.flatMap(range => range.include || []))];
  const [clients] = await db.query(
    `SELECT DISTINCT subscriber_id FROM payments
      WHERE tenant_id=? AND status='paid' AND deleted_at IS NULL AND payment_type IN ('COURSE','BUNDLE') AND subscriber_id IS NOT NULL
        AND (course_id IS NOT NULL OR bundle_id IS NOT NULL) AND (date >= ? AND date < ?${include.length ? ' OR id IN (?)' : ''})`,
    [tenantId, earliest.start, latest.end, ...(include.length ? [include] : [])]);
  if (!clients.length) return ranges.map(() => []);
  const [rows] = await db.query(
    `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.staff_id, p.currency, p.fx_rate_to_egp, p.amount_egp, p.amount, p.date,
            s.assigned_sales_id, s.assigned_cs_id, s.name AS client_name, s.client_code,
            COALESCE(b.title, c.title) AS item_title, COALESCE(b.booking_bonuses_json, c.booking_bonuses_json) AS bonuses_json
       FROM payments p
       JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
       LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
       LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.payment_type IN ('COURSE','BUNDLE') AND p.subscriber_id IN (?)
        AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL)
      ORDER BY p.date, p.created_at, p.id`, [tenantId, clients.map(row => row.subscriber_id)]);
  const first = new Map();
  for (const row of rows) {
    const key = `${row.subscriber_id}|${row.bundle_id ? `bundle:${row.bundle_id}` : row.course_id}`;
    if (!first.has(key)) first.set(key, row);
  }
  const wanted = [];
  for (const row of first.values()) {
    const at = new Date(row.date);
    const hit = windows.map(window => (at >= window.from && at < window.to) || window.include.has(row.id));
    if (hit.some(Boolean)) wanted.push({ row, at, hit });
  }
  const currencyOf = row => String(row.currency || 'EGP').toUpperCase();
  const agreed = await agreedPrices(db, {
    tenantId, items: wanted.map(({ row }) => ({ subscriberId: row.subscriber_id, courseId: row.bundle_id ? null : row.course_id, bundleId: row.bundle_id || null, currency: currencyOf(row) })),
  });
  const built = wanted.map(({ row, at }, index) => {
    const currency = currencyOf(row);
    const rate = currency === 'EGP' ? 1 : Number(row.fx_rate_to_egp) || (Number(row.amount) > 0 ? Number(row.amount_egp) / Number(row.amount) : 0);
    return {
      paymentId: row.id, clientId: row.subscriber_id, client: row.client_name || '', clientCode: row.client_code || '',
      item: row.bundle_id ? `bundle:${row.bundle_id}` : row.course_id, title: row.item_title || '', day: cairoDayOf(at),
      currency, price: money(agreed[index]), priceEgp: money((Number(agreed[index]) || 0) * rate),
      recordedBy: row.staff_id || null, salesRep: row.assigned_sales_id || null, collector: row.assigned_cs_id || null,
      bonuses: normalizeBonuses(row.bonuses_json),
    };
  });
  return ranges.map((_, rangeIndex) => wanted.flatMap((entry, index) => (entry.hit[rangeIndex] ? [{ ...built[index] }] : [])));
}

/** The month's bookings (see bookingsInRanges). `include`: payments counted in this month although paid outside it. */
async function bookingsOf(db, tenantId, { start, end }, { include = [] } = {}) {
  return (await bookingsInRanges(db, tenantId, [{ start, end, include }]))[0];
}

/**
 * Every employee on a scheme, with how their month's bonus is made up.
 * @returns {Promise<{ year, month, plan, employees: object[], total: number }>}
 */
async function computeMonthlyBonuses(db, { tenantId, year, month, applyAdjustments = true }) {
  const bounds = monthBounds(year, month);
  const plan = await loadPlan(db, tenantId);
  // The owner's changes to the month (lib/bonusAdjustments.js): what the system works out below is changed by them, and each is shown beside the figure.
  const adjustments = applyAdjustments ? await listAdjustments(db, { tenantId, year, month }) : [];
  const excluded = new Set(adjustments.filter(item => item.kind === 'EXCLUDE_BOOKING').map(item => `${item.staffId}|${item.paymentId}`));
  const reassigned = new Map(adjustments.filter(item => item.kind === 'REASSIGN_BOOKING').map(item => [item.paymentId, item]));
  const reweighed = new Map(adjustments.filter(item => item.kind === 'WEIGHT_BOOKING').map(item => [item.paymentId, item]));
  const overridden = new Map(adjustments.filter(item => item.kind === 'TOTAL_OVERRIDE').map(item => [item.staffId, item]));
  const splits = new Map(adjustments.filter(item => item.kind === 'ROUND_SPLIT').map(item => [item.staffId, item]));
  const roundChanges = new Map(adjustments.filter(item => item.kind === 'ROUND_OVERRIDE').map(item => [`${item.staffId}|${item.round}`, item]));
  const countedHere = new Map(adjustments.filter(item => item.kind === 'COUNT_IN_MONTH').map(item => [item.paymentId, item]));
  const [staff] = await db.query(
    `SELECT id, name, role, bonus_scheme, booking_first_target, collection_levels_json FROM staff
      WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1 AND bonus_scheme <> 'NONE' ORDER BY name`, [tenantId]);
  const schemeOf = new Map(staff.map(row => [row.id, row.bonus_scheme]));
  const bookings = await bookingsOf(db, tenantId, bounds, { include: [...countedHere.keys()] });
  // Late-uploaded bookings: the ones counted here although paid in the month before or after stand on the nearest day of this month; the ones paid here but counted in
  // another month are not the reps' here (the desk still has them).
  const elsewhere = await listCountedElsewhere(db, { tenantId, paymentIds: bookings.filter(booking => !countedHere.has(booking.paymentId)).map(booking => booking.paymentId) });
  for (const booking of bookings) {
    const change = countedHere.get(booking.paymentId);
    if (change) {
      booking.movedIn = { adjustmentId: change.id, staffId: change.staffId, paidDay: booking.day };
      booking.day = booking.day < bounds.first ? bounds.first : bounds.last;
    } else if (elsewhere.has(booking.paymentId)) {
      const target = elsewhere.get(booking.paymentId);
      booking.countedElsewhere = { adjustmentId: target.id, staffId: target.staffId, month: `${target.year}-${String(target.month).padStart(2, '0')}` };
    }
  }
  const [collectedRows] = staff.some(row => row.bonus_scheme !== 'SALES_BOOKINGS') ? await db.query(
    `SELECT staff_id, COALESCE(SUM(amount_egp), 0) AS collected, COUNT(*) AS payments FROM payments
      WHERE tenant_id=? AND status='paid' AND deleted_at IS NULL AND staff_id IS NOT NULL
        AND (payment_type IS NULL OR payment_type IN ('COURSE','BUNDLE','OTHER','CERTIFICATE')) AND date >= ? AND date < ?
      GROUP BY staff_id`, [tenantId, bounds.start, bounds.end]) : [[]];
  const collected = new Map(collectedRows.map(row => [row.staff_id, { amount: money(row.collected), payments: Number(row.payments) }]));

  const ownerOf = (booking, scheme) => {
    if (booking.movedIn && scheme !== 'SALES_BOOKINGS') return null;
    if (booking.countedElsewhere && scheme === 'SALES_BOOKINGS') return null;
    const moved = scheme === 'SALES_BOOKINGS' ? reassigned.get(booking.paymentId) : null;
    if (moved && schemeOf.get(moved.toStaffId) === scheme) return moved.toStaffId;
    if (booking.movedIn && schemeOf.get(booking.movedIn.staffId) === scheme) return booking.movedIn.staffId;
    const order = scheme === 'SALES_BOOKINGS' ? [booking.salesRep, booking.recordedBy] : [booking.recordedBy, booking.collector];
    return order.find(id => id && schemeOf.get(id) === scheme) || null;
  };
  const countedFor = (booking, scheme) => {
    const owner = ownerOf(booking, scheme);
    return owner && !excluded.has(`${owner}|${booking.paymentId}`) ? owner : null;
  };

  const employees = staff.map(row => {
    const scheme = row.bonus_scheme;
    const lines = [];
    let total = 0;
    let ladder = null; let collection = null; let mine = [];
    let splitDay = null;
    let splitSource = null;
    const leftOut = bookings.filter(booking => ownerOf(booking, scheme) === row.id && excluded.has(`${row.id}|${booking.paymentId}`))
      .map(({ bonuses: _bonuses, ...booking }) => booking);
    if (scheme === 'SALES_BOOKINGS') {
      mine = bookings.filter(booking => countedFor(booking, scheme) === row.id).map(booking => {
        const computedWeight = bookingWeight(plan, booking.priceEgp);
        const change = reweighed.get(booking.paymentId);
        return { ...booking, weight: change ? change.weight : computedWeight, ...(change ? { computedWeight, weightChangedBy: change.id } : {}) };
      });
      const firstTarget = Number(row.booking_first_target) > 0 ? Number(row.booking_first_target) : null;
      const weightOf = list => Math.round(list.reduce((sum, booking) => sum + booking.weight, 0) * 100) / 100;
      // Half-month rounds: round 1 is the days before the rep's split day (the 16th unless the owner set another for them and the month), round 2 from it
      // to the end, each on the whole ladder.
      // The rep's own exception, else the month's split (for every rep), else the 16th.
      splitSource = splits.has(row.id) ? 'rep' : (splits.has(null) ? 'month' : 'default');
      splitDay = splitDayOf((splits.get(row.id) || splits.get(null) || {}).splitDay);
      const [firstLabel, secondLabel] = roundLabels(splitDay, Number(bounds.last.slice(8, 10)));
      const rounds = plan.salesPeriod === 'HALF_MONTH'
        ? [[firstLabel, mine.filter(booking => roundOfDay(booking.day, splitDay) === 1)], [secondLabel, mine.filter(booking => roundOfDay(booking.day, splitDay) === 2)]]
        : [['الشهر', mine]];
      const dayOf = number => `${bounds.first.slice(0, 8)}${String(number).padStart(2, '0')}`;
      const perRound = rounds.map(([label, list], index) => {
        const split = rounds.length > 1;
        const figures = { round: index + 1, label, from: split ? (index ? dayOf(splitDay) : bounds.first) : bounds.first, to: split ? (index ? bounds.last : dayOf(splitDay - 1)) : bounds.last,
          bookings: weightOf(list), ...ladderBonus(plan, weightOf(list), firstTarget) };
        // The owner's figure for the round replaces the plan's; the plan's stays beside it.
        const change = split ? roundChanges.get(`${row.id}|${index + 1}`) : null;
        return change ? { ...figures, computedAmount: figures.amount, amount: change.amount, override: { id: change.id, amount: change.amount, reason: change.reason, by: change.by, at: change.at } } : figures;
      });
      for (const booking of mine) booking.round = perRound.length > 1 ? perRound[roundOfDay(booking.day, splitDay) - 1].label : null;
      ladder = { bookings: weightOf(mine), amount: money(perRound.reduce((sum, round) => sum + round.amount, 0)), firstTarget, rounds: perRound,
        tier: perRound.length === 1 ? perRound[0].tier : null, extraBookings: perRound.length === 1 ? perRound[0].extraBookings : 0, extraAmount: perRound.length === 1 ? perRound[0].extraAmount : 0 };
      total += ladder.amount;
      const target = firstTarget ?? plan.bookingLadder[0]?.bookings ?? '—';
      lines.push(perRound.length > 1
        ? perRound.map(round => `روند ${round.label}: ${round.bookings} حجز ← ${round.amount}${round.override ? ` (تعديل يدوي بدل ${round.computedAmount})` : ''}`).join(' · ') + ` (أول تارجيت ${target} لكل روند)`
        : `حجوزات ${ladder.bookings} (أول تارجيت ${target}) ← ${ladder.amount}`);
      if (plan.courseSalesBonusEnabled) {
        const fromCourses = money(mine.reduce((sum, booking) => sum + courseBonusAmount(booking.bonuses.sales, booking.priceEgp), 0));
        total += fromCourses;
        lines.push(`مكافأة السيلز من صفحات الكورسات ← ${fromCourses}`);
      }
    }
    if (scheme === 'COLLECTION' || scheme === 'COLLECTION_BOOKINGS') {
      const levels = normalizeLevels(row.collection_levels_json);
      const theirs = collected.get(row.id) || { amount: 0, payments: 0 };
      collection = { ...collectionBonus(levels, theirs.amount), payments: theirs.payments, levels };
      total += collection.amount;
      lines.push(`تحصيل ${collection.collected} ← ${collection.amount}`);
    }
    let deskBonus = null;
    if (scheme === 'COLLECTION_BOOKINGS') {
      mine = bookings.filter(booking => countedFor(booking, scheme) === row.id).map(booking => ({ ...booking, deskBonus: courseBonusAmount(booking.bonuses.service, booking.priceEgp) }));
      deskBonus = money(mine.reduce((sum, booking) => sum + booking.deskBonus, 0));
      total += deskBonus;
      lines.push(`حجوزات ${mine.length} بمكافأة الكورس ← ${deskBonus}`);
    }
    // The owner's figure for the month replaces the computed one; the computed one stays beside it.
    const computedTotal = money(total);
    const override = overridden.get(row.id) || null;
    if (override) lines.push(`تعديل يدوي: الإجمالي ${override.amount} بدل ${computedTotal}`);
    const mineIds = new Set(mine.map(booking => booking.paymentId));
    return {
      staffId: row.id, name: row.name, role: row.role, scheme, schemeLabel: SCHEME_LABEL[scheme] || scheme,
      ladder, collection, deskBonus,
      bookings: mine.map(({ bonuses: _bonuses, ...booking }) => booking),
      excludedBookings: leftOut,
      splitDay: scheme === 'SALES_BOOKINGS' && plan.salesPeriod === 'HALF_MONTH' ? splitDay : null,
      splitSource: scheme === 'SALES_BOOKINGS' && plan.salesPeriod === 'HALF_MONTH' ? splitSource : null,
      adjustments: adjustments.filter(item => item.staffId === row.id || item.toStaffId === row.id || (item.kind === 'WEIGHT_BOOKING' && mineIds.has(item.paymentId))).map(item => item.id),
      computedTotal, override: override ? { id: override.id, amount: override.amount, reason: override.reason, by: override.by, at: override.at } : null,
      total: override ? override.amount : computedTotal, summary: lines.join(' · '),
    };
  });
  // Each change with the booking and the people it is about, for the screen's list.
  const bookingOf = new Map(bookings.map(booking => [booking.paymentId, booking]));
  const nameOf = new Map(staff.map(row => [row.id, row.name]));
  const shownAdjustments = adjustments.map(item => {
    const booking = item.paymentId ? bookingOf.get(item.paymentId) : null;
    return {
      ...item, client: booking ? booking.client : null, clientCode: booking ? booking.clientCode : null, item: booking ? booking.title : null,
      staffName: nameOf.get(item.staffId) || null, toStaffName: nameOf.get(item.toStaffId) || null,
    };
  });
  // The month's own bookings that the owner counted in another month, for the screen (they are not in any rep's count here).
  const movedOut = bookings.filter(booking => booking.countedElsewhere).map(({ bonuses: _bonuses, ...booking }) => ({ ...booking, staffName: nameOf.get(booking.countedElsewhere.staffId) || null }));
  return {
    year, month, from: bounds.first, to: bounds.last, plan, employees, adjustments: shownAdjustments, movedOut,
    // The day the second round starts for every rep this month (the 16th unless the owner set another); a rep's own exception is on the rep.
    splitDay: splitDayOf((splits.get(null) || {}).splitDay),
    computedTotal: money(employees.reduce((sum, item) => sum + item.computedTotal, 0)), total: money(employees.reduce((sum, item) => sum + item.total, 0)),
  };
}

/**
 * Writes the month's bonuses as one PENDING bonus per employee (source BONUS_PLAN), replacing one still PENDING; an employee whose bonus for the month is
 * already APPROVED (or REJECTED) is left as it is and reported. A zero bonus writes nothing and clears a pending one.
 */
async function saveMonthlyBonuses(db, { tenantId, year, month, actorId = null }) {
  const result = await computeMonthlyBonuses(db, { tenantId, year, month });
  const written = []; const kept = []; const cleared = [];
  for (const employee of result.employees) {
    const [[existing]] = await db.query(
      `SELECT id, status, amount FROM employee_bonuses WHERE tenant_id=? AND staff_id=? AND for_year=? AND for_month=? AND source=? ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [tenantId, employee.staffId, year, month, SOURCE]);
    if (existing && existing.status !== 'PENDING') { kept.push({ staffId: employee.staffId, name: employee.name, status: existing.status, amount: Number(existing.amount), now: employee.total }); continue; }
    const reason = `مكافأة شهر ${month}/${year} (${employee.schemeLabel}): ${employee.summary}${employee.override ? ` — السبب: ${employee.override.reason}` : ''}`;
    const calc = JSON.stringify({ scheme: employee.scheme, computedTotal: employee.computedTotal, override: employee.override, adjustments: result.adjustments.filter(item => employee.adjustments.includes(item.id)).map(item => ({ kind: item.kind, paymentId: item.paymentId, staffId: item.staffId, toStaffId: item.toStaffId, weight: item.weight, amount: item.amount, splitDay: item.splitDay, reason: item.reason, by: item.by })), ladder: employee.ladder, collection: employee.collection && { ...employee.collection, levels: undefined }, deskBonus: employee.deskBonus, bookings: employee.bookings.map(b => ({ paymentId: b.paymentId, client: b.clientCode, item: b.item, priceEgp: b.priceEgp, weight: b.weight, deskBonus: b.deskBonus })) });
    if (!(employee.total > 0)) {
      if (existing) { await db.query('DELETE FROM employee_bonuses WHERE id=? AND tenant_id=?', [existing.id, tenantId]); cleared.push(employee.staffId); }
      continue;
    }
    if (existing) {
      await db.query('UPDATE employee_bonuses SET amount=?, reason=?, calc_json=? WHERE id=? AND tenant_id=?', [employee.total, reason, calc, existing.id, tenantId]);
    } else {
      await db.query(
        `INSERT INTO employee_bonuses (staff_id, type, amount, status, currency, reason, for_month, for_year, created_by, tenant_id, source, calc_json)
         VALUES (?, 'bonus', ?, 'PENDING', 'EGP', ?, ?, ?, ?, ?, ?, ?)`,
        [employee.staffId, employee.total, reason, month, year, actorId, tenantId, SOURCE, calc]);
    }
    written.push({ staffId: employee.staffId, name: employee.name, amount: employee.total });
  }
  return { ...result, written, kept, cleared };
}

/** What a change to the month needs to be checked against: its bookings, the staff on a scheme, and whom a booking counts for (before the owner's changes, with `ignoreAdjustments`). */
async function adjustmentContext(db, { tenantId, year, month }) {
  const bounds = monthBounds(year, month);
  const [staff] = await db.query("SELECT id, name, bonus_scheme FROM staff WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1 AND bonus_scheme <> 'NONE'", [tenantId]);
  const live = await listAdjustments(db, { tenantId, year, month });
  const countedHere = new Map(live.filter(item => item.kind === 'COUNT_IN_MONTH').map(item => [item.paymentId, item.staffId]));
  // The first payments of the month before and after: the ones that can be counted here instead of in their own month. Read together with the month's own bookings
  // (which include the ones counted here although paid in the month before or after), in one pass.
  const previous = monthBounds(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const following = monthBounds(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
  const [bookings, before, after] = await bookingsInRanges(db, tenantId, [{ start: bounds.start, end: bounds.end, include: [...countedHere.keys()] }, previous, following]);
  const adjacentBookings = [...before, ...after];
  const schemeOf = new Map(staff.map(row => [row.id, row.bonus_scheme]));
  const moves = new Map(live.filter(item => item.kind === 'REASSIGN_BOOKING').map(item => [item.paymentId, item.toStaffId]));
  const natural = (booking, scheme) => (scheme === 'SALES_BOOKINGS' ? [booking.salesRep, booking.recordedBy] : [booking.recordedBy, booking.collector]).find(id => id && schemeOf.get(id) === scheme) || null;
  const countedFor = (booking, { ignoreAdjustments = false } = {}) => (ignoreAdjustments ? null : moves.get(booking.paymentId)) || countedHere.get(booking.paymentId) || natural(booking, 'SALES_BOOKINGS') || natural(booking, 'COLLECTION_BOOKINGS');
  return { staff, bookings, adjacentBookings, plan: await loadPlan(db, tenantId), countedFor };
}

module.exports = { SOURCE, monthBounds, loadPlan, bookingsOf, bookingsInRanges, adjustmentContext, computeMonthlyBonuses, saveMonthlyBonuses };
