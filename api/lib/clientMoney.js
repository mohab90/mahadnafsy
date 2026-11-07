'use strict';

// What one client owes and has paid, for every item they hold — the ONE answer the client's page, the booking/payment dialog, the receipt, the collections and
// instalment lists and the nightly check read (7 Nov 2026: «سعر الكورس أحيانًا رقم في صفحة العميل ورقم تاني عند زر دفع وحجز»).
//
// It is built on the rule and the writer that already exist — lib/agreedPrice.js (the client's own price in client_item_money, else what their booking recorded,
// never below what was paid, else the catalogue; itemBalances) and lib/itemMoney.js — and adds what they did not cover: certificates (the price agreed for this client's
// certificate, else the price list's — lib/certificatePricing.js certificateDue) and the extras (carnets, books, consultations), each kept apart from the courses and tracks
// (a certificate is its own service; a track is paid once). Every figure carries where it came from, so a screen can say «سعر متفق عليه» or «سعر الكتالوج».
//
// Amounts are DECIMAL in the database and added here in piastres (integers), never as floats.

const { itemBalances } = require('./agreedPrice');
const { certificateDue, certificateSource } = require('./certificatePricing');
const { certificatePricing } = require('./certificatePayments');
const { certificatePrices } = require('./itemMoney');
const { getTenantSetting } = require('./tenantSettings');

/** Piastres: the integer a DECIMAL(14,2) amount is added in. */
const cents = value => Math.round((Number(value) || 0) * 100);
const fromCents = value => value / 100;
/** a − b − c … floored at zero, in piastres. */
const remainingOf = (agreed, ...paid) => fromCents(Math.max(0, cents(agreed) - paid.reduce((sum, amount) => sum + cents(amount), 0)));

const IN_LIST = ids => ids.map(() => '?').join(',');

async function titlesOf(db, tenantId, table, ids) {
  if (!ids.length) return new Map();
  const [rows] = await db.query(
    `SELECT id, COALESCE(NULLIF(title_ar, ''), title) AS title FROM ${table} WHERE tenant_id=? AND id IN (${IN_LIST(ids)})`, [tenantId, ...ids]);
  return new Map(rows.map(row => [String(row.id), row.title]));
}

/** The carnets and books «تسعير الشهادات» lists, by label: { label → { EGP, SAR, USD } }. */
async function extraCatalogue(db, tenantId) {
  const content = await getTenantSetting('content', { tenantId, fallback: {}, db }).catch(() => ({}));
  let parsed = {};
  try { parsed = JSON.parse(content?.extra_item_pricing || '{}') || {}; } catch { parsed = {}; }
  const byLabel = new Map();
  for (const item of [...(parsed.carnets || []), ...(parsed.books || [])]) {
    if (item?.label) byLabel.set(String(item.label).trim(), { EGP: Number(item.priceEGP) || 0, SAR: Number(item.priceSAR) || 0, USD: Number(item.priceUSD) || 0 });
  }
  return byLabel;
}

/**
 * @returns {Promise<{
 *   subscriberId: string,
 *   nationality: string|null,
 *   items: Array<{ item: string, kind: 'course'|'track', title: string, currency: string, catalogue: number, agreed: number, source: string,
 *                  paid: number, priorPaid: number, remaining: number }>,
 *   certificates: Array<{ id: string, type: string, courseId: string|null, status: string, currency: string, list: number, agreed: number, source: string,
 *                         paid: number, remaining: number|null }>,
 *   extras: Array<{ kind: string, title: string, currency: string, agreed: number, source: string, paid: number, remaining: number }>,
 *   totals: Record<string, { agreed: number, paid: number, remaining: number }>,
 * }|null>} null when the client does not exist in this institute.
 */
async function clientMoney(db, { tenantId, subscriberId }) {
  const [[subscriber]] = await db.query('SELECT id, nationality FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [subscriberId, tenantId]);
  if (!subscriber) return null;

  const balances = await itemBalances(db, { tenantId, subscriberId });
  const lines = [...balances.values()];
  const courseTitles = await titlesOf(db, tenantId, 'courses', lines.filter(line => !line.bundleId && line.courseId).map(line => String(line.courseId)));
  const trackTitles = await titlesOf(db, tenantId, 'bundles', lines.filter(line => line.bundleId).map(line => String(line.bundleId)));
  const items = lines.map(line => ({
    item: line.item,
    kind: line.bundleId ? 'track' : 'course',
    title: (line.bundleId ? trackTitles.get(String(line.bundleId)) : courseTitles.get(String(line.courseId))) || line.item,
    currency: line.currency,
    catalogue: Number(line.catalogue) || 0,
    agreed: Number(line.expected) || 0,
    source: line.source || 'none',
    paid: Number(line.paid) || 0,
    priorPaid: Number(line.priorPaid) || 0,
    remaining: remainingOf(line.expected, line.paid, line.priorPaid),
  }));

  // Certificates: each request is its own line, at the price agreed for this client's certificate, else the price list's, else the request's own.
  const pricing = await certificatePricing(db, tenantId);
  const agreedCertificates = await certificatePrices(db, { tenantId, subscriberIds: [subscriberId] });
  const [requests] = await db.query(
    `SELECT id, course_id, type, status, price, paid_amount, currency, nationality FROM certificate_requests
      WHERE tenant_id=? AND subscriber_id=? ORDER BY requested_at DESC`, [tenantId, subscriberId]);
  const certificates = requests.map(request => {
    const currency = String(request.currency || 'EGP').toUpperCase();
    const shape = { ...request, currency };
    const own = agreedCertificates.get(String(request.id)) || 0;
    const agreed = certificateDue(pricing, shape, own);
    return {
      id: request.id,
      type: String(request.type || 'OTHER').toUpperCase(),
      courseId: request.course_id || null,
      status: String(request.status || 'PENDING').toLowerCase(),
      currency,
      list: certificateDue(pricing, { ...shape, price: 0 }),
      agreed,
      source: certificateSource(pricing, shape, own),
      paid: Number(request.paid_amount) || 0,
      remaining: agreed > 0 ? remainingOf(agreed, request.paid_amount) : null,
    };
  });

  // Extras: a carnet, a book, a consultation is its own service, priced from its list when it has one, else by what its booking recorded.
  const [extraRows] = await db.query(
    `SELECT payment_type, item_title, currency, SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS paid, MAX(course_expected) AS expected
       FROM payments WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status IN ('paid','pending')
        AND payment_type IN ('CARNEH','BOOK','CONSULTATION')
      GROUP BY payment_type, item_title, currency`, [tenantId, subscriberId]);
  const listed = extraRows.length ? await extraCatalogue(db, tenantId) : new Map();
  const extras = extraRows.map(row => {
    const currency = String(row.currency || 'EGP').toUpperCase();
    const fromList = Number(listed.get(String(row.item_title || '').trim())?.[currency]) || 0;
    const agreed = fromList > 0 ? fromList : Number(row.expected) || 0;
    return {
      kind: String(row.payment_type).toLowerCase(), title: row.item_title || String(row.payment_type).toLowerCase(), currency, agreed,
      source: fromList > 0 ? 'catalogue' : agreed > 0 ? 'booking' : 'none', paid: Number(row.paid) || 0, remaining: remainingOf(agreed, row.paid),
    };
  });

  // What is owed in each currency: courses and tracks, then certificates, then extras — added in piastres.
  const sums = new Map();
  const add = (currency, agreed, paid, remaining) => {
    const entry = sums.get(currency) || { agreed: 0, paid: 0, remaining: 0 };
    entry.agreed += cents(agreed); entry.paid += cents(paid); entry.remaining += cents(remaining);
    sums.set(currency, entry);
  };
  items.forEach(line => add(line.currency, line.agreed, cents(line.paid) / 100 + cents(line.priorPaid) / 100, line.remaining));
  certificates.forEach(line => add(line.currency, line.agreed, line.paid, line.remaining || 0));
  extras.forEach(line => add(line.currency, line.agreed, line.paid, line.remaining));
  const totals = Object.fromEntries([...sums].map(([currency, entry]) => [currency, { agreed: fromCents(entry.agreed), paid: fromCents(entry.paid), remaining: fromCents(entry.remaining) }]));

  return { subscriberId, nationality: subscriber.nationality || null, items, certificates, extras, totals };
}

module.exports = { clientMoney, remainingOf, cents };
