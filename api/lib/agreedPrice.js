'use strict';

// The price one client agreed for one item — a course, or a track (bundle).
//
// «لما بنعدلها وقت تسجيل حجز العميل مش بتظهر في صفحه عملاء الاونلاين وبتظهر
// السعر الاجمالي علي السسيتم». The agreed price lived in two places that were
// written and read separately: payments.course_expected on each booking row,
// and crm_json.customPrices on the client. The online table read the second
// and then the catalogue; the payment route, the access panel, the receipt
// and the collections list read the first; an instalment recorded neither, so
// its row fell back to nothing. Each screen was right about its own copy.
//
// One rule now, the same one the admin applies (admin/lib/agreedPrice.ts): the
// client's own price, else what their booking recorded — never below what has
// been paid for it — else the catalogue. And one writer, which puts a changed
// price in both places.
//
// «مدفوع قبل السيستم» (crm_json.priorPaid) is money a client paid before their
// payments were recorded here — an old sheet's «المحصل». It counts towards what
// they have paid everywhere a balance is shown, and is not revenue: no payment
// row, no journal.

const { resolveCatalogPrice } = require('./catalogPrice');

const itemKey = ({ courseId, bundleId }) => (bundleId ? `bundle:${bundleId}` : String(courseId || ''));

function parseCrm(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

/** The rule itself. `booked` is the highest price a booking recorded. */
function resolveAgreed({ custom = 0, booked = 0, paid = 0, catalogue = 0 }) {
  if (Number(custom) > 0) return Number(custom);
  // Never below what was paid: 21 track bookings on production carry one
  // course's price («900» on a track paid 5,500), left by an old fault.
  if (Number(booked) > 0) return Math.max(Number(booked), Number(paid) || 0);
  return Number(catalogue) > 0 ? Number(catalogue) : null;
}

async function agreedPrice(db, { tenantId, subscriberId, courseId = null, bundleId = null, currency = 'EGP' }) {
  if (!courseId && !bundleId) return null;
  const [[subscriber]] = await db.query(
    'SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
  const custom = Number(parseCrm(subscriber?.crm_json).customPrices?.[itemKey({ courseId, bundleId })]) || 0;
  if (custom > 0) return custom;
  const [[booked]] = await db.query(
    `SELECT MAX(course_expected) AS price,
            SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS paid FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status IN ('paid','pending')
        AND course_id <=> ? AND bundle_id <=> ? AND currency=?`,
    [tenantId, subscriberId, courseId || null, bundleId || null, currency]);
  const catalogue = Number(booked?.price) > 0 ? 0 : await resolveCatalogPrice(db, {
    type: bundleId ? 'bundle' : 'course', itemId: bundleId || courseId, currency, tenantId,
  }).catch(() => null);
  return resolveAgreed({ booked: booked?.price, paid: booked?.paid, catalogue });
}

/**
 * Every item one client holds or has paid for, with its currency, the price
 * agreed, what the system has recorded as paid, and what was paid before it.
 */
async function itemBalances(db, { tenantId, subscriberId }) {
  const [[subscriber]] = await db.query(
    'SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
  const crm = parseCrm(subscriber?.crm_json);
  const [payments] = await db.query(
    `SELECT course_id, bundle_id, amount, currency, status, course_expected FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND payment_type IN ('COURSE','BUNDLE')
        AND (course_id IS NOT NULL OR bundle_id IS NOT NULL)
      ORDER BY date, created_at`,
    [tenantId, subscriberId]);
  const [enrolments] = await db.query(
    // Active ones: a course taken away is not one still owed for.
    `SELECT course_id, bundle_id FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND status='active'`, [tenantId, subscriberId]);

  const items = new Map();
  const touch = (courseId, bundleId, currency) => {
    const key = itemKey({ courseId, bundleId });
    if (!items.has(key)) items.set(key, { item: key, courseId: bundleId ? null : courseId, bundleId, currency: currency || 'EGP', booked: 0, paid: 0 });
    return items.get(key);
  };
  for (const payment of payments) {
    const entry = touch(payment.bundle_id ? null : payment.course_id, payment.bundle_id, payment.currency);
    if (payment.currency !== entry.currency) continue;
    if (['paid', 'pending'].includes(payment.status)) entry.booked = Math.max(entry.booked, Number(payment.course_expected) || 0);
    if (payment.status === 'paid') entry.paid += Number(payment.amount) || 0;
  }
  for (const enrolment of enrolments) touch(enrolment.bundle_id ? null : enrolment.course_id, enrolment.bundle_id, null);

  for (const entry of items.values()) {
    const catalogue = await resolveCatalogPrice(db, {
      type: entry.bundleId ? 'bundle' : 'course', itemId: entry.bundleId || entry.courseId, currency: entry.currency, tenantId,
    }).catch(() => null);
    entry.catalogue = catalogue || 0;
    entry.expected = resolveAgreed({ custom: crm.customPrices?.[entry.item], booked: entry.booked, paid: entry.paid, catalogue }) || 0;
    entry.priorPaid = Number(crm.priorPaid?.[entry.item]) || 0;
    entry.remaining = Math.max(0, entry.expected - entry.paid - entry.priorPaid);
  }
  return items;
}

async function updateCrm(db, { tenantId, subscriberId }, change) {
  const [[subscriber]] = await db.query(
    'SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [subscriberId, tenantId]);
  if (!subscriber) return;
  const crm = parseCrm(subscriber.crm_json);
  change(crm);
  await db.query('UPDATE subscribers SET crm_json=? WHERE id=? AND tenant_id=?',
    [JSON.stringify(crm), subscriberId, tenantId]);
}

/**
 * A new agreed price for one item, written everywhere it is kept: on every
 * payment for the item (so the access ratio, the receipt and the collections
 * list see it) and on the client (so the online table does). Run inside the
 * caller's transaction.
 */
async function setAgreedPrice(db, { tenantId, subscriberId, courseId = null, bundleId = null, price }) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error('السعر لازم يكون رقم أكبر من صفر'); error.statusCode = 400; throw error;
  }
  await db.query(
    `UPDATE payments SET course_expected=?
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL
        AND course_id <=> ? AND bundle_id <=> ? AND payment_type IN ('COURSE','BUNDLE')`,
    [value, tenantId, subscriberId, courseId || null, bundleId || null]);
  await updateCrm(db, { tenantId, subscriberId }, crm => {
    crm.customPrices = { ...(crm.customPrices || {}), [itemKey({ courseId, bundleId })]: value };
  });
}

/** «مدفوع قبل السيستم» for one item. Zero clears it. */
async function setPriorPaid(db, { tenantId, subscriberId, courseId = null, bundleId = null, amount }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    const error = new Error('المدفوع لازم يكون رقم'); error.statusCode = 400; throw error;
  }
  await updateCrm(db, { tenantId, subscriberId }, crm => {
    const priorPaid = { ...(crm.priorPaid || {}) };
    if (value > 0) priorPaid[itemKey({ courseId, bundleId })] = value;
    else delete priorPaid[itemKey({ courseId, bundleId })];
    crm.priorPaid = priorPaid;
  });
}

/**
 * An item taken off a client (lib/clientCourseActions.js): its agreed price and
 * «مدفوع قبل السيستم» go, and — when it moves to another item — what was paid
 * before the system moves with it. Returns what was there, for the history.
 */
async function releaseItemMoney(db, { tenantId, subscriberId, from, to = null }) {
  const released = { price: 0, priorPaid: 0 };
  await updateCrm(db, { tenantId, subscriberId }, crm => {
    const key = itemKey(from);
    released.price = Number(crm.customPrices?.[key]) || 0;
    released.priorPaid = Number(crm.priorPaid?.[key]) || 0;
    const customPrices = { ...(crm.customPrices || {}) };
    const priorPaid = { ...(crm.priorPaid || {}) };
    delete customPrices[key];
    delete priorPaid[key];
    if (to && released.priorPaid > 0) {
      priorPaid[itemKey(to)] = (Number(priorPaid[itemKey(to)]) || 0) + released.priorPaid;
    }
    crm.customPrices = customPrices;
    crm.priorPaid = priorPaid;
  });
  return released;
}

/** The client's «مدفوع قبل السيستم», summed, for balances that read payments alone. */
function priorPaidTotal(crmJson) {
  return Object.values(parseCrm(crmJson).priorPaid || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

// What counts as paying for the course or track a payment names. A carnet, a
// book, a certificate or a consultation names the client's course too — «الكورس
// المرتبط» — and is not the course's money (8 Oct 2026: «اشتراك كارنيه … كأنه
// لسه بيزود الفلوس علي فلوس الكورس»): it opened the course in full, joined its
// instalments and read as over the remaining balance. OTHER with an item is old
// course money (admin/lib/agreedPrice.ts isCoursePayment).
const ITEM_PAYMENT_TYPES = Object.freeze(['COURSE', 'BUNDLE', 'OTHER']);
const isItemPaymentType = type => !type || ITEM_PAYMENT_TYPES.includes(String(type).toUpperCase());

module.exports = { ITEM_PAYMENT_TYPES, isItemPaymentType, agreedPrice, itemBalances, itemKey, priorPaidTotal, releaseItemMoney, resolveAgreed, setAgreedPrice, setPriorPaid };
