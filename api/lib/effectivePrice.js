'use strict';

/**
 * What a course or bundle costs right now, in one place.
 *
 * Every page used to price an item its own way: the course page took a
 * marketing discount off, the course card did not, the home page took the
 * featured discount and then the rule again, and the pop-up its own — while
 * checkout charged the catalogue price less the cash rate. A customer read
 * 2,800 on the course page and was asked for 3,600. The pop-up's code had
 * nowhere to be typed, and the promo codes table was checked by an endpoint
 * nothing called and applied to nothing.
 *
 * The rule, from the marketing settings (التسويق ← الخصومات):
 *   1. base: the catalogue price in the currency (catalogPrice.js).
 *   2. the list price: the cheapest of the automatic discounts running on the
 *      item — a discount rule without a code (the item's own before
 *      «all courses»), the home page's featured course, the timed offer's own
 *      price, the pop-up's discount when it has no code. They do not stack.
 *   3. a code, when one is given: a rule's code, the pop-up's code or a row of
 *      promo_codes. It does not stack with (2) either — the better one wins.
 *   4. the pay mode on top: the cash or instalment rate (enrollmentPricing.js),
 *      as checkout always applied it.
 *
 * The site reads (2) from GET /api/public/prices and (3)+(4) from
 * POST /api/public/price-quote; checkout-intent and orders/reserve charge
 * exactly what this returns.
 *
 * A consultation is priced the same way from its doctor's fee: the rules
 * marketing aims at consultations («مستشار بعينه» — the item is the doctor —
 * and «كل الاستشارات»), with or without a code. The admin screen offered both
 * and nothing applied them. Nothing else touches a consultation: the course
 * offers, the pop-up and the promo-codes table are for courses and paths, and
 * there is no cash or instalment rate on a session.
 */

const { resolveCatalogPrice } = require('./catalogPrice');
const { enrollmentRates, amountDueNow, installmentTotal } = require('./enrollmentPricing');
const { cairoToday } = require('./dates');
const { getTenantSetting } = require('./tenantSettings');

const CURRENCIES = ['EGP', 'SAR', 'USD'];
const OFFER_DEFAULT_HOURS = 24;
const OFFER_MAX_HOURS = 24 * 30;

const num = value => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
// A share off the price. 100% would give the item away and is not a discount anybody meant.
const percentOff = value => {
  const n = num(value);
  return n > 0 && n < 100 ? n : 0;
};
const off = (base, pct) => Math.round(base * (1 - pct / 100));
const cleanCode = value => String(value || '').trim().toUpperCase();
const isOn = value => value !== false && value !== 0 && value !== '0' && value !== 'false';

// The same reading of the timed offer and the pop-up as shared/siteOffers.ts.
function offerLive(content, now) {
  if (content['offer.enabled'] === '0') return false;
  const startedAt = String(content['offer.timerStartedAt'] || '');
  if (!startedAt) return true;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return true;
  const hours = num(content['offer.durationHours']);
  const span = (hours > 0 ? Math.min(OFFER_MAX_HOURS, Math.round(hours)) : OFFER_DEFAULT_HOURS) * 3600_000;
  return now - start < span;
}

function popupLive(content, now) {
  if (content['popup.enabled'] !== '1') return false;
  const endsAt = String(content['popup.endsAt'] || '');
  if (endsAt) {
    const end = new Date(endsAt).getTime();
    if (Number.isFinite(end) && end <= now) return false;
  }
  return true;
}

/** Whether a rule from the «discounts» setting covers this item today (an expiry date runs through its Cairo day). */
function ruleCovers(rule, { type, itemId, today }) {
  if (!rule || !isOn(rule.active)) return false;
  if (rule.expiresAt && String(rule.expiresAt).slice(0, 10) < today) return false;
  if (!percentOff(rule.discountPercent)) return false;
  if (type === 'course') {
    return (rule.type === 'course' && String(rule.targetId || '') === String(itemId)) || rule.type === 'all_courses';
  }
  if (type === 'bundle') return rule.type === 'bundle' && String(rule.targetId || '') === String(itemId);
  if (type === 'consultation') {
    return rule.type === 'all_consultations'
      || (rule.type === 'therapist_consultation' && String(rule.targetId || '') === String(itemId));
  }
  return false;
}

const ruleDiscount = (rule, base) => ({
  price: off(base, percentOff(rule.discountPercent)), source: 'rule',
  percent: percentOff(rule.discountPercent), label: String(rule.label || ''), expiresAt: rule.expiresAt ? String(rule.expiresAt).slice(0, 10) : null,
});

/** The automatic discounts running on one item in one currency, cheapest first is not assumed. */
function automaticDiscounts({ type, itemId, currency, base, discounts = [], content = {}, now = Date.now() }) {
  const today = cairoToday(new Date(now));
  const found = [];
  // Rules without a code. The item's own rule wins over «all courses», as the site always showed it.
  const rules = (Array.isArray(discounts) ? discounts : []).filter(rule => !cleanCode(rule?.promoCode || rule?.code) && ruleCovers(rule, { type, itemId, today }));
  const rule = rules.find(r => r.type !== 'all_courses' && r.type !== 'all_consultations') || rules[0];
  if (rule) found.push(ruleDiscount(rule, base));
  if (type === 'course') {
    const featuredPct = percentOff(content['home.featured.discountPercent']);
    if (featuredPct && String(content['home.featured.courseId'] || '') === String(itemId)) {
      found.push({ price: off(base, featuredPct), source: 'featured', percent: featuredPct, label: '', expiresAt: null });
    }
    const offerPrice = num(content[`offer.price.${currency}`]);
    if (offerPrice > 0 && String(content['offer.courseId'] || '') === String(itemId) && offerLive(content, now)) {
      found.push({ price: Math.round(offerPrice), source: 'offer', percent: null, label: String(content['home.offer.title'] || ''), expiresAt: null });
    }
    const popupPct = percentOff(content['popup.discountPercent']);
    if (popupPct && !cleanCode(content['popup.code']) && String(content['popup.courseId'] || '') === String(itemId) && popupLive(content, now)) {
      found.push({ price: off(base, popupPct), source: 'popup', percent: popupPct, label: String(content['popup.title'] || ''), expiresAt: null });
    }
  }
  return found.filter(d => d.price > 0 && d.price < base);
}

/**
 * What a code takes off. `promoRow` is the tenant's promo_codes row for it,
 * already found usable (findPromoRow). Returns { discount } or { error }.
 */
function codeDiscount(code, { type, itemId, currency, base, discounts = [], content = {}, now = Date.now(), promoRow = null }) {
  const wanted = cleanCode(code);
  if (!wanted) return { discount: null };
  const today = cairoToday(new Date(now));
  const rule = (Array.isArray(discounts) ? discounts : [])
    .find(r => cleanCode(r?.promoCode || r?.code) === wanted && ruleCovers(r, { type, itemId, today }));
  if (rule) return { discount: { ...ruleDiscount(rule, base), source: 'code', code: wanted } };

  // The pop-up's code and the promo-codes table are for courses and paths: a
  // consultation is the doctor's fee, discounted only by a rule aimed at it.
  if (type === 'consultation') return { error: { code: 'PROMO_NOT_FOR_ITEM', message: 'الكود ده مش على الاستشارات' } };

  const popupPct = percentOff(content['popup.discountPercent']);
  if (popupPct && cleanCode(content['popup.code']) === wanted && popupLive(content, now)) {
    // A pop-up on a course is for that course; one on no course is for any course or path.
    const course = String(content['popup.courseId'] || '');
    if (!course || (type === 'course' && course === String(itemId))) {
      return { discount: { price: off(base, popupPct), source: 'code', code: wanted, percent: popupPct, label: String(content['popup.title'] || ''), expiresAt: null } };
    }
    return { error: { code: 'PROMO_NOT_FOR_ITEM', message: 'الكود ده مش على الكورس ده' } };
  }

  if (promoRow) {
    const value = Number(promoRow.discount_value) || 0;
    // min_order_amount and a fixed amount are pounds (the admin screen says ج.م);
    // applied to a riyal or dollar price they would mean something else entirely.
    const fixed = promoRow.discount_type === 'fixed';
    if (fixed && currency !== 'EGP') return { error: { code: 'PROMO_EGP_ONLY', message: 'الكود ده للدفع بالجنيه بس' } };
    const min = Number(promoRow.min_order_amount) || 0;
    if (min > 0 && currency === 'EGP' && base < min) {
      return { error: { code: 'PROMO_MIN_ORDER', message: `الحد الأدنى للطلب ${min} ج.م` } };
    }
    const price = fixed ? Math.round(base - value) : off(base, percentOff(value));
    if (!(price > 0) || price >= base) return { error: { code: 'PROMO_INVALID', message: 'الكود غير صالح أو منتهي الصلاحية' } };
    return { discount: { price, source: 'code', code: wanted, percent: fixed ? null : percentOff(value), label: String(promoRow.description || ''), expiresAt: null } };
  }
  // A rule's code that exists but is off, expired or for another item reads the same as an unknown one.
  return { error: { code: 'PROMO_INVALID', message: 'الكود غير صالح أو منتهي الصلاحية' } };
}

const cheapest = list => list.reduce((best, d) => (!best || d.price < best.price ? d : best), null);

/**
 * The price of one item in one currency: base, the automatic discount and the
 * list price it gives, the code (or why it was refused), and the price after it.
 */
function priceItem({ type, itemId, currency, base, discounts, content, now = Date.now(), promoCode = '', promoRow = null }) {
  const automatic = cheapest(automaticDiscounts({ type, itemId, currency, base, discounts, content, now }));
  const list = automatic ? automatic.price : base;
  let promo = null;
  let promoError = null;
  if (cleanCode(promoCode)) {
    const result = codeDiscount(promoCode, { type, itemId, currency, base, discounts, content, now, promoRow });
    if (result.error) promoError = result.error;
    else if (result.discount && result.discount.price >= list) {
      promoError = { code: 'PROMO_NOT_BETTER', message: 'السعر الحالي أقل من خصم الكود — هتدفع السعر الأقل' };
    } else promo = result.discount;
  }
  const applied = promo || automatic;
  return {
    currency, base, list, price: applied ? applied.price : base,
    discount: applied ? { source: applied.source, percent: applied.percent ?? null, label: applied.label || '', expiresAt: applied.expiresAt || null, code: applied.code || null } : null,
    promoError,
  };
}

/** The price with the pay mode on top: what is due now, and an instalment plan's total. */
function quoteItem(priced, { payMode = 'cash', rates, type = 'course' }) {
  // A session is paid as it is priced: no cash rate, no instalment plan.
  if (type === 'consultation') return { ...priced, payMode: 'cash', dueNow: priced.price, planTotal: null };
  const mode = payMode === 'installment' ? 'installment' : 'cash';
  return {
    ...priced,
    payMode: mode,
    dueNow: amountDueNow(priced.price, mode, rates),
    planTotal: mode === 'installment' ? installmentTotal(priced.price, rates) : null,
  };
}

/** The tenant's marketing settings the price is made of. */
async function loadPricingContext(db, tenantId) {
  const [discounts, content] = await Promise.all([
    getTenantSetting('discounts', { tenantId, fallback: [], db }).catch(() => []),
    getTenantSetting('content', { tenantId, fallback: {}, db }).catch(() => ({})),
  ]);
  const safeContent = content && typeof content === 'object' ? content : {};
  return { discounts: Array.isArray(discounts) ? discounts : [], content: safeContent, rates: enrollmentRates(safeContent) };
}

/**
 * The tenant's promo_codes row for a code, when it can still be used: active,
 * not expired, and fewer paid orders carry it than it allows. Uses are counted
 * from paid orders, so an abandoned checkout does not spend one.
 */
async function findPromoRow(db, { tenantId, code }) {
  const wanted = cleanCode(code);
  if (!wanted) return null;
  const [[row]] = await db.query(
    `SELECT pc.id, pc.code, pc.description, pc.discount_type, pc.discount_value, pc.min_order_amount, pc.max_uses,
            GREATEST(pc.used_count, (SELECT COUNT(*) FROM orders o
                                      WHERE o.tenant_id=pc.tenant_id AND o.coupon_code=pc.code
                                        AND o.status='paid' AND o.deleted_at IS NULL)) AS uses
       FROM promo_codes pc
      WHERE pc.tenant_id=? AND pc.code=? AND pc.active=1 AND (pc.expires_at IS NULL OR pc.expires_at > NOW())
      LIMIT 1`,
    [tenantId, wanted]
  );
  if (!row) return null;
  if (row.max_uses != null && Number(row.uses) >= Number(row.max_uses)) return null;
  return row;
}

/**
 * The full quote for one course or bundle: null when the catalogue has no
 * price for it in this currency (not for sale in it).
 */
async function resolveEffectivePrice(db, { type, itemId, currency = 'EGP', tenantId, payMode = 'cash', promoCode = '', base = null, context = null, now = Date.now() }) {
  if (!['course', 'bundle', 'consultation'].includes(type) || !itemId) return null;
  const cur = String(currency || 'EGP').toUpperCase();
  if (!CURRENCIES.includes(cur)) return null;
  const listed = Number(base) > 0 ? Number(base)
    : type === 'consultation' ? await therapistFee(db, { therapistId: itemId, currency: cur, tenantId })
      : await resolveCatalogPrice(db, { type, itemId, currency: cur, tenantId });
  if (!(listed > 0)) return null;
  const ctx = context || await loadPricingContext(db, tenantId);
  const promoRow = cleanCode(promoCode) && type !== 'consultation' ? await findPromoRow(db, { tenantId, code: promoCode }) : null;
  const priced = priceItem({ type, itemId, currency: cur, base: listed, discounts: ctx.discounts, content: ctx.content, now, promoCode, promoRow });
  return quoteItem(priced, { payMode, rates: ctx.rates, type });
}

/** A doctor's session fee in the currency, as checkout charges it. */
async function therapistFee(db, { therapistId, currency, tenantId }) {
  const [[row]] = await db.query(
    `SELECT price_egp, price_sar, price_usd FROM therapists
      WHERE id=? AND tenant_id=? AND is_active=1 AND is_consultation_enabled=1 LIMIT 1`,
    [therapistId, tenantId]
  );
  return row ? Number(row[`price_${currency.toLowerCase()}`]) || 0 : 0;
}

module.exports = {
  CURRENCIES, automaticDiscounts, codeDiscount, priceItem, quoteItem,
  loadPricingContext, findPromoRow, resolveEffectivePrice, cleanCode,
};
