'use strict';

// «نظام المكافآت» (8 Nov 2026) — the rules a month's bonus is worked out by, kept as data (tenant_settings section 'bonus_plan', seeded with the owner's
// numbers by migration 381, edited on the HR screen) and applied here. Nothing in this file is a number of the institute's: every amount, price band
// and target comes from the plan or from the employee's own row.
//
//   booking weight   a course or track counts as more than one booking by its price in EGP (a client paying in another currency at the booking's rate):
//                    the highest band the price reaches. A band says from which price, and whether that price itself is in it («من 4400» / «أكتر من 11000»).
//   booking ladder   the bookings of the month reach a tier («10 حجز ← 1000»); past the tier, each booking adds the amount of the band it falls in
//                    («من 20 لـ30: 140 للحجز»). A rep's first target («أول تارجيت»: 10, 15 or 20) is where the ladder starts for them: below it, nothing.
//                    Half a booking counts half.
//   collection       a collector's levels («من 50,000: 2%», «من 80,000: 3%» or a fixed amount): the level the month's collected money reaches applies to
//                    the whole of it.

const SCHEMES = Object.freeze(['NONE', 'SALES_BOOKINGS', 'COLLECTION', 'COLLECTION_BOOKINGS']);
const num = value => (value === '' || value == null ? NaN : Number(value));
const cents = value => Math.round(value * 100);
const money = value => cents(value) / 100;

const planError = message => Object.assign(new Error(message), { statusCode: 400, code: 'BONUS_PLAN_INVALID' });

/** The plan as stored, checked and put in order. An empty or missing plan pays nothing. Throws a 400 for a plan that cannot be applied. */
function normalizePlan(raw = {}) {
  const plan = raw && typeof raw === 'object' ? raw : {};
  const bookingWeights = (Array.isArray(plan.bookingWeights) ? plan.bookingWeights : []).map(band => ({
    min: num(band.min), minIncluded: band.minIncluded !== false, weight: num(band.weight),
  }));
  for (const band of bookingWeights) {
    if (!Number.isFinite(band.min) || band.min < 0 || !Number.isFinite(band.weight) || band.weight < 0) throw planError('كل شريحة سعر لازم يكون ليها سعر بداية وعدد حجوزات (أرقام موجبة)');
  }
  bookingWeights.sort((a, b) => a.min - b.min || Number(!a.minIncluded) - Number(!b.minIncluded));
  const bookingLadder = (Array.isArray(plan.bookingLadder) ? plan.bookingLadder : []).map(tier => ({ bookings: num(tier.bookings), amount: num(tier.amount) }));
  for (const tier of bookingLadder) {
    if (!(tier.bookings > 0) || !Number.isFinite(tier.amount) || tier.amount < 0) throw planError('كل تارجيت لازم يكون عدد حجوزات أكبر من صفر ومكافأة (رقم موجب)');
  }
  bookingLadder.sort((a, b) => a.bookings - b.bookings);
  if (new Set(bookingLadder.map(tier => tier.bookings)).size !== bookingLadder.length) throw planError('في تارجيت متكرر بنفس عدد الحجوزات');
  const extraPerBooking = (Array.isArray(plan.extraPerBooking) ? plan.extraPerBooking : []).map(band => ({
    from: num(band.from), to: band.to === '' || band.to == null ? null : num(band.to), amount: num(band.amount),
  }));
  for (const band of extraPerBooking) {
    if (!Number.isFinite(band.from) || band.from < 0 || (band.to !== null && !(band.to > band.from)) || !Number.isFinite(band.amount) || band.amount < 0) {
      throw planError('كل شريحة حجز إضافي لازم يكون ليها من / لحد (أكبر من «من» أو فاضي) ومبلغ للحجز');
    }
  }
  extraPerBooking.sort((a, b) => a.from - b.from);
  return { bookingWeights, bookingLadder, extraPerBooking, courseSalesBonusEnabled: plan.courseSalesBonusEnabled === true };
}

/** How many bookings a course or track of this price in EGP counts as: the weight of the highest band the price reaches (one when no band says). */
function bookingWeight(plan, priceEgp) {
  const price = Number(priceEgp) || 0;
  let weight = 1;
  for (const band of plan.bookingWeights) {
    if (band.minIncluded ? price >= band.min : price > band.min) weight = band.weight;
  }
  return weight;
}

/**
 * The booking ladder's bonus for `bookings` (fractions count) when the rep's ladder starts at `firstTarget` (none: the first tier).
 * @returns {{ amount: number, tier: {bookings, amount}|null, extraBookings: number, extraAmount: number, firstTarget: number|null }}
 */
function ladderBonus(plan, bookings, firstTarget = null) {
  const count = Math.max(0, Number(bookings) || 0);
  const start = Number(firstTarget) > 0 ? Number(firstTarget) : null;
  const tiers = plan.bookingLadder.filter(tier => start == null || tier.bookings >= start);
  const reached = [...tiers].reverse().find(tier => count >= tier.bookings) || null;
  if (!reached) return { amount: 0, tier: null, extraBookings: 0, extraAmount: 0, firstTarget: start };
  // Each booking past the tier reached is paid at the band it falls in: from 20 to 30 at 140, past 30 at 200.
  let extraCents = 0;
  for (const band of plan.extraPerBooking) {
    const from = Math.max(band.from, reached.bookings);
    const to = band.to == null ? count : Math.min(band.to, count);
    if (to > from) extraCents += Math.round(cents(band.amount) * (to - from));
  }
  return {
    amount: money((cents(reached.amount) + extraCents) / 100),
    tier: reached, extraBookings: Math.max(0, count - reached.bookings), extraAmount: extraCents / 100, firstTarget: start,
  };
}

/** A collector's levels as stored on their row, checked: [{ from, kind: 'percent'|'fixed', value }] by from. */
function normalizeLevels(raw) {
  let levels = raw;
  if (typeof raw === 'string') { try { levels = JSON.parse(raw); } catch { levels = []; } }
  if (!Array.isArray(levels)) return [];
  const checked = levels.map(level => ({ from: num(level.from), kind: level.kind === 'fixed' ? 'fixed' : 'percent', value: num(level.value) }));
  for (const level of checked) {
    if (!Number.isFinite(level.from) || level.from < 0 || !Number.isFinite(level.value) || level.value < 0 || (level.kind === 'percent' && level.value > 100)) {
      throw planError('كل ليفل تحصيل لازم يكون له «من» (مبلغ) وقيمة: نسبة من 0 لـ100 أو مبلغ ثابت');
    }
  }
  return checked.sort((a, b) => a.from - b.from);
}

/** The collection bonus: the level the collected EGP reaches, applied to the whole of it. */
function collectionBonus(levels, collectedEgp) {
  const collected = Math.max(0, Number(collectedEgp) || 0);
  const level = [...levels].reverse().find(item => collected >= item.from) || null;
  if (!level) return { amount: 0, level: null, collected };
  const amount = level.kind === 'fixed' ? level.value : money(collected * level.value / 100);
  return { amount: money(amount), level, collected };
}

/** A course's own booking bonus (courses/bundles.booking_bonuses_json, one role's): fixed EGP, or a percentage of the booking's price in EGP. */
function courseBonusAmount(bonus, priceEgp) {
  if (!bonus || !(Number(bonus.value) > 0)) return 0;
  return bonus.type === 'percent' ? money((Number(priceEgp) || 0) * Math.min(100, Number(bonus.value)) / 100) : money(Number(bonus.value));
}

module.exports = { SCHEMES, normalizePlan, bookingWeight, ladderBonus, normalizeLevels, collectionBonus, courseBonusAmount };
