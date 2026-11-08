'use strict';

// One month's bonus of every employee on a bonus scheme (staff.bonus_scheme, migration 381), by the institute's plan (lib/bonusPlan.js), from the payments
// themselves — and, when HR asks, written as one bonus per employee awaiting approval (employee_bonuses, source 'BONUS_PLAN'), which payroll takes once it is
// APPROVED like any other. Nothing is paid by working it out.
//
//   a booking        the first paid payment of a client for a course or a track (a second instalment, a retake or a replay is not one), in the Cairo month
//                    it was paid in. Its price is the client's agreed price (lib/agreedPrice.js) at the rate of that payment, in EGP.
//   whose booking    SALES_BOOKINGS: the rep the client belongs to, else the one who recorded it. COLLECTION_BOOKINGS (the desk): the one who recorded it,
//                    else the client's collection officer. One booking can count for a rep and for a desk.
//   collected        the course and track money (never a certificate's) an employee recorded, paid in the month, in EGP at the payment's own rate.
//   SALES_BOOKINGS        the booking ladder on the weighted bookings (+ the course page's sales bonus, only while the plan switches it on)
//   COLLECTION            the collector's level on what they collected
//   COLLECTION_BOOKINGS   the collector's level + each booking's desk bonus from its course page («المكافأة المسجلة داخل كل كورس»)

const { getTenantSetting } = require('./tenantSettings');
const { agreedPrice } = require('./agreedPrice');
const { normalizeBonuses } = require('./priceTiers');
const { addDaysToDateOnly, cairoDayOf, cairoDayStartUtc } = require('./dates');
const { normalizePlan, bookingWeight, ladderBonus, normalizeLevels, collectionBonus, courseBonusAmount } = require('./bonusPlan');

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

/** The month's bookings: one per client and item, at the first paid payment, with what it is worth in EGP. */
async function bookingsOf(db, tenantId, { start, end }) {
  const [clients] = await db.query(
    `SELECT DISTINCT subscriber_id FROM payments
      WHERE tenant_id=? AND status='paid' AND deleted_at IS NULL AND payment_type IN ('COURSE','BUNDLE') AND subscriber_id IS NOT NULL
        AND (course_id IS NOT NULL OR bundle_id IS NOT NULL) AND date >= ? AND date < ?`, [tenantId, start, end]);
  if (!clients.length) return [];
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
  const bookings = [];
  for (const row of first.values()) {
    const at = new Date(row.date);
    if (!(at >= new Date(start) && at < new Date(end))) continue;
    const currency = String(row.currency || 'EGP').toUpperCase();
    const rate = currency === 'EGP' ? 1 : Number(row.fx_rate_to_egp) || (Number(row.amount) > 0 ? Number(row.amount_egp) / Number(row.amount) : 0);
    const agreed = await agreedPrice(db, {
      tenantId, subscriberId: row.subscriber_id, courseId: row.bundle_id ? null : row.course_id, bundleId: row.bundle_id || null, currency,
    });
    bookings.push({
      paymentId: row.id, clientId: row.subscriber_id, client: row.client_name || '', clientCode: row.client_code || '',
      item: row.bundle_id ? `bundle:${row.bundle_id}` : row.course_id, title: row.item_title || '', day: cairoDayOf(at),
      currency, price: money(agreed), priceEgp: money((Number(agreed) || 0) * rate),
      recordedBy: row.staff_id || null, salesRep: row.assigned_sales_id || null, collector: row.assigned_cs_id || null,
      bonuses: normalizeBonuses(row.bonuses_json),
    });
  }
  return bookings;
}

/**
 * Every employee on a scheme, with how their month's bonus is made up.
 * @returns {Promise<{ year, month, plan, employees: object[], total: number }>}
 */
async function computeMonthlyBonuses(db, { tenantId, year, month }) {
  const bounds = monthBounds(year, month);
  const plan = await loadPlan(db, tenantId);
  const [staff] = await db.query(
    `SELECT id, name, role, bonus_scheme, booking_first_target, collection_levels_json FROM staff
      WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1 AND bonus_scheme <> 'NONE' ORDER BY name`, [tenantId]);
  const schemeOf = new Map(staff.map(row => [row.id, row.bonus_scheme]));
  const bookings = await bookingsOf(db, tenantId, bounds);
  const [collectedRows] = staff.some(row => row.bonus_scheme !== 'SALES_BOOKINGS') ? await db.query(
    `SELECT staff_id, COALESCE(SUM(amount_egp), 0) AS collected, COUNT(*) AS payments FROM payments
      WHERE tenant_id=? AND status='paid' AND deleted_at IS NULL AND staff_id IS NOT NULL
        AND (payment_type IS NULL OR payment_type IN ('COURSE','BUNDLE','OTHER')) AND date >= ? AND date < ?
      GROUP BY staff_id`, [tenantId, bounds.start, bounds.end]) : [[]];
  const collected = new Map(collectedRows.map(row => [row.staff_id, { amount: money(row.collected), payments: Number(row.payments) }]));

  const ownerOf = (booking, scheme) => {
    const order = scheme === 'SALES_BOOKINGS' ? [booking.salesRep, booking.recordedBy] : [booking.recordedBy, booking.collector];
    return order.find(id => id && schemeOf.get(id) === scheme) || null;
  };

  const employees = staff.map(row => {
    const scheme = row.bonus_scheme;
    const lines = [];
    let total = 0;
    let ladder = null; let collection = null; let mine = [];
    if (scheme === 'SALES_BOOKINGS') {
      mine = bookings.filter(booking => ownerOf(booking, scheme) === row.id).map(booking => ({ ...booking, weight: bookingWeight(plan, booking.priceEgp) }));
      const firstTarget = Number(row.booking_first_target) > 0 ? Number(row.booking_first_target) : null;
      const weightOf = list => Math.round(list.reduce((sum, booking) => sum + booking.weight, 0) * 100) / 100;
      // Half-month rounds: the 1st to the 15th, the 16th to the end, each on the whole ladder.
      const rounds = plan.salesPeriod === 'HALF_MONTH'
        ? [['1–15', mine.filter(booking => Number(booking.day.slice(8, 10)) <= 15)], [`16–${bounds.last.slice(8, 10)}`, mine.filter(booking => Number(booking.day.slice(8, 10)) > 15)]]
        : [['الشهر', mine]];
      const perRound = rounds.map(([label, list]) => ({ label, bookings: weightOf(list), ...ladderBonus(plan, weightOf(list), firstTarget) }));
      for (const booking of mine) booking.round = perRound.length > 1 ? (Number(booking.day.slice(8, 10)) <= 15 ? perRound[0].label : perRound[1].label) : null;
      ladder = { bookings: weightOf(mine), amount: money(perRound.reduce((sum, round) => sum + round.amount, 0)), firstTarget, rounds: perRound,
        tier: perRound.length === 1 ? perRound[0].tier : null, extraBookings: perRound.length === 1 ? perRound[0].extraBookings : 0, extraAmount: perRound.length === 1 ? perRound[0].extraAmount : 0 };
      total += ladder.amount;
      const target = firstTarget ?? plan.bookingLadder[0]?.bookings ?? '—';
      lines.push(perRound.length > 1
        ? perRound.map(round => `روند ${round.label}: ${round.bookings} حجز ← ${round.amount}`).join(' · ') + ` (أول تارجيت ${target} لكل روند)`
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
      mine = bookings.filter(booking => ownerOf(booking, scheme) === row.id).map(booking => ({ ...booking, deskBonus: courseBonusAmount(booking.bonuses.service, booking.priceEgp) }));
      deskBonus = money(mine.reduce((sum, booking) => sum + booking.deskBonus, 0));
      total += deskBonus;
      lines.push(`حجوزات ${mine.length} بمكافأة الكورس ← ${deskBonus}`);
    }
    return {
      staffId: row.id, name: row.name, role: row.role, scheme, schemeLabel: SCHEME_LABEL[scheme] || scheme,
      ladder, collection, deskBonus,
      bookings: mine.map(({ bonuses: _bonuses, ...booking }) => booking),
      total: money(total), summary: lines.join(' · '),
    };
  });
  return { year, month, from: bounds.first, to: bounds.last, plan, employees, total: money(employees.reduce((sum, item) => sum + item.total, 0)) };
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
    const reason = `مكافأة شهر ${month}/${year} (${employee.schemeLabel}): ${employee.summary}`;
    const calc = JSON.stringify({ scheme: employee.scheme, ladder: employee.ladder, collection: employee.collection && { ...employee.collection, levels: undefined }, deskBonus: employee.deskBonus, bookings: employee.bookings.map(b => ({ paymentId: b.paymentId, client: b.clientCode, item: b.item, priceEgp: b.priceEgp, weight: b.weight, deskBonus: b.deskBonus })) });
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

module.exports = { SOURCE, monthBounds, loadPlan, computeMonthlyBonuses, saveMonthlyBonuses };
