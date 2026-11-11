'use strict';

// The price one client agreed for one item — a course, or a track (bundle).
//
// «لما بنعدلها وقت تسجيل حجز العميل مش بتظهر في صفحه عملاء الاونلاين وبتظهر
// السعر الاجمالي علي السسيتم». The agreed price lived in two places that were
// written and read separately: payments.course_expected on each booking row,
// and the client's own price (client_item_money, lib/itemMoney.js). The online table read the second
// and then the catalogue; the payment route, the access panel, the receipt
// and the collections list read the first; an instalment recorded neither, so
// its row fell back to nothing. Each screen was right about its own copy.
//
// One rule now, the same one the admin applies (admin/lib/agreedPrice.ts): the
// client's own price, else what their booking recorded — never below what has
// been paid for it — else the catalogue. And one writer, which puts a changed
// price in both places.
//
// «مدفوع قبل السيستم» (client_item_money.prior_paid, lib/itemMoney.js) is money a client paid before their
// payments were recorded here — an old sheet's «المحصل». It counts towards what
// they have paid everywhere a balance is shown, and is not revenue: no payment
// row, no journal.

const { resolveCatalogPrice, resolveCatalogPrices } = require('./catalogPrice');
const { moneyOf, loadItemMoney, setItemMoney, priorPaidTotals } = require('./itemMoney');
const { logClientEvent } = require('./clientHistory');
const { clientCurrency } = require('./clientMarket');
const { safeDateOnly } = require('./dates');

const itemKey = ({ courseId, bundleId }) => (bundleId ? `bundle:${bundleId}` : String(courseId || ''));

/** The rule itself, with where the figure came from: 'client' (their own price), 'booking' (what their booking recorded), 'catalogue', or 'none'. `booked` is the highest price a booking recorded. */
function resolveAgreedDetail({ custom = 0, booked = 0, paid = 0, catalogue = 0 }) {
  if (Number(custom) > 0) return { price: Number(custom), source: 'client' };
  // Never below what was paid: 21 track bookings on production carry one
  // course's price («900» on a track paid 5,500), left by an old fault.
  if (Number(booked) > 0) return { price: Math.max(Number(booked), Number(paid) || 0), source: 'booking' };
  return Number(catalogue) > 0 ? { price: Number(catalogue), source: 'catalogue' } : { price: null, source: 'none' };
}
const resolveAgreed = figures => resolveAgreedDetail(figures).price;

/** The agreed price of one item and where it came from: { price, source, catalogue? } — what a booking, a payment and a screen all start from. */
async function agreedPriceDetail(db, { tenantId, subscriberId, courseId = null, bundleId = null, currency = 'EGP' }) {
  if (!courseId && !bundleId) return { price: null, source: 'none' };
  const custom = Number((await moneyOf(db, { tenantId, subscriberId })).customPrices[itemKey({ courseId, bundleId })]) || 0;
  if (custom > 0) return { price: custom, source: 'client' };
  const [[booked]] = await db.query(
    `SELECT MAX(course_expected) AS price,
            SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS paid FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status IN ('paid','pending')
        AND (payment_type IS NULL OR payment_type IN ('COURSE','BUNDLE','OTHER'))
        AND course_id <=> ? AND bundle_id <=> ? AND currency=?`,
    [tenantId, subscriberId, courseId || null, bundleId || null, currency]);
  const catalogue = Number(booked?.price) > 0 ? 0 : await resolveCatalogPrice(db, {
    type: bundleId ? 'bundle' : 'course', itemId: bundleId || courseId, currency, tenantId,
  }).catch(() => null);
  return resolveAgreedDetail({ booked: booked?.price, paid: booked?.paid, catalogue });
}

const agreedPrice = async (db, options) => (await agreedPriceDetail(db, options)).price;

/**
 * The agreed price of many items at once, by the same rule as agreedPriceDetail (the client's own price, else what their booking recorded, else the catalogue) in a
 * fixed number of queries whatever the number of items — the month's bonus prices every booking of the month.
 * @param {{ subscriberId: string, courseId?: string|null, bundleId?: string|null, currency?: string }[]} items
 * @returns {Promise<(number|null)[]>} one price per item, in the same order
 */
async function agreedPrices(db, { tenantId, items }) {
  const wanted = items.map(({ subscriberId, courseId = null, bundleId = null, currency = 'EGP' }) => ({ subscriberId, courseId: courseId || null, bundleId: bundleId || null, currency, key: itemKey({ courseId, bundleId }) }));
  const priced = wanted.filter(item => item.courseId || item.bundleId);
  const money = await loadItemMoney(db, { tenantId, subscriberIds: priced.map(item => item.subscriberId) });
  const own = item => Number(money.get(item.subscriberId)?.customPrices[item.key]) || 0;
  const needBooking = priced.filter(item => !(own(item) > 0));
  const booked = new Map();
  const subscribers = [...new Set(needBooking.map(item => item.subscriberId))];
  for (let i = 0; i < subscribers.length; i += 1000) {
    const [rows] = await db.query(
      `SELECT subscriber_id, course_id, bundle_id, currency, MAX(course_expected) AS price,
              SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS paid FROM payments
        WHERE tenant_id=? AND subscriber_id IN (?) AND deleted_at IS NULL AND status IN ('paid','pending')
          AND (payment_type IS NULL OR payment_type IN ('COURSE','BUNDLE','OTHER'))
        GROUP BY subscriber_id, course_id, bundle_id, currency`, [tenantId, subscribers.slice(i, i + 1000)]);
    for (const row of rows) booked.set(`${row.subscriber_id}|${row.course_id || ''}|${row.bundle_id || ''}|${String(row.currency).toUpperCase()}`, row);
  }
  const bookedOf = item => booked.get(`${item.subscriberId}|${item.courseId || ''}|${item.bundleId || ''}|${String(item.currency).toUpperCase()}`);
  const needCatalogue = needBooking.filter(item => !(Number(bookedOf(item)?.price) > 0));
  const catalogue = needCatalogue.length
    ? await resolveCatalogPrices(db, { tenantId, entries: needCatalogue.map(item => ({ type: item.bundleId ? 'bundle' : 'course', itemId: item.bundleId || item.courseId, currency: item.currency })) }).catch(() => new Map())
    : new Map();
  return wanted.map(item => {
    if (!(item.courseId || item.bundleId)) return null;
    if (own(item) > 0) return own(item);
    const row = bookedOf(item);
    const fromCatalogue = Number(row?.price) > 0 ? 0 : catalogue.get(`${item.bundleId ? 'bundle' : 'course'}|${item.bundleId || item.courseId}|${String(item.currency).toUpperCase()}`) || null;
    return resolveAgreedDetail({ booked: row?.price, paid: row?.paid, catalogue: fromCatalogue }).price;
  });
}

/**
 * Every item one client holds or has paid for, with its currency, the price
 * agreed, what the system has recorded as paid, and what was paid before it.
 * `foldTracks: false` keeps every course a line of its own — what track naming (lib/trackNaming.js) needs, to price a track from the courses before they move into it.
 */
async function itemBalances(db, { tenantId, subscriberId, foldTracks = true }) {
  const held = await moneyOf(db, { tenantId, subscriberId });
  const [payments] = await db.query(
    `SELECT course_id, bundle_id, amount, currency, status, course_expected, date FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND (payment_type IN ('COURSE','BUNDLE','OTHER') OR payment_type IS NULL)
        AND (course_id IS NOT NULL OR bundle_id IS NOT NULL)
      ORDER BY date, created_at`,
    [tenantId, subscriberId]);
  const [enrolments] = await db.query(
    // Active ones: a course taken away is not one still owed for.
    `SELECT course_id, bundle_id FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND status='active'`, [tenantId, subscriberId]);

  // The currency an item is priced in when no payment names one: the client's own (the same answer as the lists and the money route, lib/clientMarket.js).
  const [everyPayment] = await db.query('SELECT status, currency, date FROM payments WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL', [tenantId, subscriberId]);
  const [[subscriber]] = await db.query('SELECT branch, market FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, subscriberId]);
  const fallbackCurrency = clientCurrency({
    branch: subscriber?.branch, market: subscriber?.market,
    paymentHistory: everyPayment.map(payment => ({ status: payment.status, currency: payment.currency, at: safeDateOnly(payment.date) })),
  });

  const items = new Map();
  const touch = (courseId, bundleId, currency) => {
    const key = itemKey({ courseId, bundleId });
    if (!items.has(key)) items.set(key, { item: key, courseId: bundleId ? null : courseId, bundleId, currency: currency || fallbackCurrency, booked: 0, paid: 0 });
    return items.get(key);
  };
  for (const payment of payments) {
    const entry = touch(payment.bundle_id ? null : payment.course_id, payment.bundle_id, payment.currency);
    entry.fromPayment = true;
    if (payment.currency !== entry.currency) continue;
    if (['paid', 'pending'].includes(payment.status)) entry.booked = Math.max(entry.booked, Number(payment.course_expected) || 0);
    if (payment.status === 'paid') entry.paid += Number(payment.amount) || 0;
  }
  for (const enrolment of enrolments) touch(enrolment.bundle_id ? null : enrolment.course_id, enrolment.bundle_id, null);
  // An item whose only trace is a price agreed for it or money paid before the system is still an item: the money is the evidence (as the lists read it).
  for (const key of new Set([...Object.keys(held.customPrices), ...Object.keys(held.priorPaid)])) {
    if (!key || key.startsWith('multi:')) continue;
    if (key.startsWith('bundle:')) touch(null, key.slice(7), null); else touch(key, null, null);
  }

  // A track is one line (the rule of the staff lists, api/lib/staffClientsView.js clientItems, and of the booking dialog): holding EVERY course of a track — however
  // each was bought — is holding the track, at the track's price; and a course inside a held track is not a debt of its own, what was paid for it counts toward the
  // track (in the same currency). `items.holders` says which line a folded course went into; `balanceFor` reads through it.
  const holders = new Map();
  const carried = new Map();
  const enrolledCourses = new Set(enrolments.map(enrolment => enrolment.course_id).filter(Boolean).map(String));
  const knownCourses = [...new Set([...[...items.values()].map(entry => entry.courseId).filter(Boolean).map(String), ...enrolledCourses])];
  const knownTracks = [...items.values()].map(entry => entry.bundleId).filter(Boolean).map(String);
  const members = new Map();
  if (foldTracks && (knownCourses.length || knownTracks.length)) {
    const clauses = []; const params = [tenantId];
    if (knownTracks.length) { clauses.push(`bundle_id IN (${knownTracks.map(() => '?').join(',')})`); params.push(...knownTracks); }
    if (knownCourses.length) {
      clauses.push(`bundle_id IN (SELECT bundle_id FROM bundle_courses WHERE tenant_id=? AND course_id IN (${knownCourses.map(() => '?').join(',')}))`);
      params.push(tenantId, ...knownCourses);
    }
    const [rows] = await db.query(`SELECT bundle_id, course_id FROM bundle_courses WHERE tenant_id=? AND (${clauses.join(' OR ')})`, params);
    for (const row of rows) { const list = members.get(String(row.bundle_id)) || []; list.push(String(row.course_id)); members.set(String(row.bundle_id), list); }
  }
  for (const [bundleId, courseIds] of members) {
    if (items.has(`bundle:${bundleId}`) || courseIds.length < 2 || !courseIds.every(id => enrolledCourses.has(id))) continue;
    touch(null, bundleId, courseIds.map(id => items.get(id)).find(entry => entry?.fromPayment)?.currency);
  }
  for (const track of [...items.values()].filter(entry => entry.bundleId)) {
    for (const courseId of members.get(String(track.bundleId)) || []) if (!holders.has(courseId)) holders.set(courseId, track.item);
  }
  for (const [courseId, trackItem] of holders) {
    const row = items.get(courseId);
    if (!row) continue;
    items.delete(courseId);
    const owner = items.get(trackItem);
    if (!owner || (row.fromPayment && owner.currency !== row.currency)) continue;
    const entry = carried.get(trackItem) || { paid: 0, priorPaid: 0 };
    entry.paid += row.paid; entry.priorPaid += Number(held.priorPaid[row.item]) || 0;
    carried.set(trackItem, entry);
  }

  for (const entry of items.values()) {
    const catalogue = await resolveCatalogPrice(db, {
      type: entry.bundleId ? 'bundle' : 'course', itemId: entry.bundleId || entry.courseId, currency: entry.currency, tenantId,
    }).catch(() => null);
    entry.catalogue = catalogue || 0;
    const agreed = resolveAgreedDetail({ custom: held.customPrices[entry.item], booked: entry.booked, paid: entry.paid, catalogue });
    entry.expected = agreed.price || 0;
    entry.source = agreed.source;
    entry.priorPaid = Number(held.priorPaid[entry.item]) || 0;
    // what was paid for the courses of a track counts after the price is found: it never raises it (as the list's expected, which is read before they are added)
    const carry = carried.get(entry.item);
    if (carry) { entry.paid += carry.paid; entry.priorPaid += carry.priorPaid; }
    entry.remaining = Math.max(0, entry.expected - entry.paid - entry.priorPaid);
  }
  items.holders = holders;
  return items;
}

/** The balance line of an item — a course or `bundle:<id>` — read through the tracks that took courses in (`items.holders`). */
function balanceFor(balances, item) {
  return balances.get(item) || balances.get(balances.holders?.get(String(item))) || undefined;
}

/**
 * A new agreed price for one item, written everywhere it is kept: on every
 * payment for the item (so the access ratio, the receipt and the collections
 * list see it) and on the client (so the online table does). Run inside the
 * caller's transaction.
 */
async function setAgreedPrice(db, { tenantId, subscriberId, courseId = null, bundleId = null, price, actor = null, explicit = false, currency = 'EGP', followPlans = true }) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error('السعر لازم يكون رقم أكبر من صفر'); error.statusCode = 400; throw error;
  }
  // The item's instalment plans follow the new price (lib/planFollowsMoney.js). A caller that writes a payment too says so and brings them along itself, once.
  const plans = followPlans ? require('./planFollowsMoney') : null;
  const before = plans ? await plans.itemRemaining(db, { tenantId, subscriberId, courseId, bundleId }) : null;
  // A change of price is in the client's history — who, the old price, the new one. It is logged when the client already had a price for the item
  // (their own or their booking's), or when someone set it on purpose (`explicit`); a first booking at the catalogue's figure is not a change.
  const was = actor ? await agreedPriceDetail(db, { tenantId, subscriberId, courseId, bundleId, currency }) : null;
  await db.query(
    `UPDATE payments SET course_expected=?
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL
        AND course_id <=> ? AND bundle_id <=> ? AND payment_type IN ('COURSE','BUNDLE')`,
    [value, tenantId, subscriberId, courseId || null, bundleId || null]);
  await setItemMoney(db, { tenantId, subscriberId, itemKey: itemKey({ courseId, bundleId }), price: value });
  if (was && was.price !== value && (explicit || was.source === 'client' || was.source === 'booking')) {
    await logClientEvent(db, {
      tenantId, subscriberId, action: 'price_changed', actor,
      label: `سعر ${bundleId ? 'المسار' : 'الكورس'} (${itemKey({ courseId, bundleId })}): ${was.price == null ? 'بدون سعر' : Number(was.price).toLocaleString('en-US')} ← ${value.toLocaleString('en-US')} ${currency}`,
    });
  }
  if (plans) await plans.planFollowsMoney(db, { tenantId, subscriberId, courseId, bundleId, before });
}

/** «مدفوع قبل السيستم» for one item. Zero clears it. The item's instalment plans follow, as they do a price. */
async function setPriorPaid(db, { tenantId, subscriberId, courseId = null, bundleId = null, amount }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    const error = new Error('المدفوع لازم يكون رقم'); error.statusCode = 400; throw error;
  }
  const plans = require('./planFollowsMoney');
  const before = await plans.itemRemaining(db, { tenantId, subscriberId, courseId, bundleId });
  await setItemMoney(db, { tenantId, subscriberId, itemKey: itemKey({ courseId, bundleId }), priorPaid: value });
  await plans.planFollowsMoney(db, { tenantId, subscriberId, courseId, bundleId, before });
}

/**
 * An item taken off a client (lib/clientCourseActions.js): its agreed price and
 * «مدفوع قبل السيستم» go, and — when it moves to another item — what was paid
 * before the system moves with it. Returns what was there, for the history.
 */
async function releaseItemMoney(db, { tenantId, subscriberId, from, to = null }) {
  const held = await moneyOf(db, { tenantId, subscriberId });
  const key = itemKey(from);
  const released = { price: Number(held.customPrices[key]) || 0, priorPaid: Number(held.priorPaid[key]) || 0 };
  await setItemMoney(db, { tenantId, subscriberId, itemKey: key, price: 0, priorPaid: 0 });
  if (to && released.priorPaid > 0) {
    const toKey = itemKey(to);
    await setItemMoney(db, { tenantId, subscriberId, itemKey: toKey, priorPaid: (Number(held.priorPaid[toKey]) || 0) + released.priorPaid });
  }
  return released;
}


// What counts as paying for the course or track a payment names. A carnet, a
// book, a certificate or a consultation names the client's course too — «الكورس
// المرتبط» — and is not the course's money (8 Oct 2026: «اشتراك كارنيه … كأنه
// لسه بيزود الفلوس علي فلوس الكورس»): it opened the course in full, joined its
// instalments and read as over the remaining balance. OTHER with an item is old
// course money (admin/lib/agreedPrice.ts isCoursePayment).
const ITEM_PAYMENT_TYPES = Object.freeze(['COURSE', 'BUNDLE', 'OTHER']);
const isItemPaymentType = type => !type || ITEM_PAYMENT_TYPES.includes(String(type).toUpperCase());
// The same rule for SQL, written for the alias `p`: the payments that are the course's (or track's) own money.
const ITEM_PAYMENT_SQL = "COALESCE(p.payment_type, '') IN ('', 'COURSE', 'BUNDLE', 'OTHER')";

module.exports = { ITEM_PAYMENT_TYPES, ITEM_PAYMENT_SQL, isItemPaymentType, agreedPrice, agreedPrices, agreedPriceDetail, itemBalances, balanceFor, itemKey, priorPaidTotals, releaseItemMoney, resolveAgreed, resolveAgreedDetail, setAgreedPrice, setPriorPaid };
