'use strict';

// What one client owes and has paid toward the round they sit in — the numbers
// the Dokki schedule shows under «المدفوع» and «المتبقي».
//
// «في عملاء بتظهر دافعه 0 وهيا دافعه فلوس … وفي الكورس نفسه قاري 0». The roster
// read money for the round's COURSE only (a payment naming it, or a track
// containing it; crm_json.priorPaid under the course's own key). But a client who
// holds every course of a track holds the track (lib/trackNaming.js): their
// payments move onto it, and the money they paid before the system moves with it,
// from priorPaid[<course>] to priorPaid['bundle:<id>']. The roster never looked
// under that key, so every client who held a track read «المدفوع 0» in all of the
// track's rounds — 238 of them on the first count — while their own page, which
// lists the track as an item, showed the money.
//
// The price follows the same item. A client in a track owes the track's agreed
// price, not the one course's catalogue price the round row used for everybody:
// a client who had paid 3,000 of a 3,500 track read «مكتمل» against a 900 course.
//
// One rule for the price, the one every other screen applies (lib/agreedPrice.js):
// the client's own price, else what their booking recorded (never below what was
// paid for it), else the catalogue.

const { isItemPaymentType, resolveAgreed } = require('./agreedPrice');

const CHUNK = 500;

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

const num = value => Number(value) || 0;
const chunks = list => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};
const inList = ids => ids.map(() => '?').join(',');

// A payment row that is money for a course or a track: what the clients screen
// calls a course payment. A certificate or a book that happens to carry a course
// id is not part of what the client owes for the course.
const isItemPayment = payment => isItemPaymentType(payment.paymentType);
const itemOf = payment => (payment.bundleId ? `bundle:${payment.bundleId}` : String(payment.courseId || ''));

/**
 * The pure rule. Everything it needs is passed in, so it is tested without a database.
 *
 * @param {object} input
 * @param {string} input.courseId        the round's course
 * @param {object} input.crm             { priorPaid, customPrices } of the client
 * @param {Array}  input.payments        the client's paid/pending rows: { courseId, bundleId, status, paymentType, amount, courseExpected }
 * @param {Set}    input.enrolledBundles bundle ids the client is actively enrolled in
 * @param {Array}  input.tracks          tracks that contain the course: { id, title, courseCount, price }
 * @param {number} input.coursePrice     the catalogue price of the course
 * @param {number} input.unlinked        collected money that names no course or track
 * @param {Set}    input.otherCourses    every course the client is booked in, enrolled in or has paid for
 * @param {boolean} input.anyTrack       whether the client has a track anywhere (a payment, an enrolment, a saved price)
 */
function resolveAttendeeMoney({
  courseId, crm = {}, payments = [], enrolledBundles = new Set(), tracks = [], coursePrice = 0,
  unlinked = 0, otherCourses = new Set(), anyTrack = false,
}) {
  const priorPaid = crm.priorPaid || {};
  const customPrices = crm.customPrices || {};

  // The track the client holds this course in: money, a saved price or an enrolment names it.
  const held = tracks
    .filter(track => num(priorPaid[`bundle:${track.id}`]) > 0 || num(customPrices[`bundle:${track.id}`]) > 0
      || enrolledBundles.has(String(track.id)) || payments.some(payment => String(payment.bundleId || '') === String(track.id)))
    .sort((a, b) => b.courseCount - a.courseCount || String(a.id).localeCompare(String(b.id)))[0] || null;

  const item = held ? `bundle:${held.id}` : String(courseId);
  const prior = num(priorPaid[String(courseId)]) + (held ? num(priorPaid[item]) : 0);

  const own = payments.filter(payment => isItemPayment(payment) && itemOf(payment) === item);
  const paidOnItem = own.filter(payment => payment.status === 'paid').reduce((sum, payment) => sum + num(payment.amount), 0);
  const booked = own.reduce((max, payment) => Math.max(max, num(payment.courseExpected)), 0);
  const catalogue = held ? num(held.price) : num(coursePrice);
  const agreed = resolveAgreed({ custom: customPrices[item], booked, paid: paidOnItem, catalogue });

  // Collected money that names nothing belongs to the round only when nothing else
  // could be what it was for: this course is the client's only one, and they hold no track.
  const onlyThisCourse = !anyTrack && !held && [...otherCourses].every(other => String(other) === String(courseId));
  const unlinkedApplied = onlyThisCourse ? num(unlinked) : 0;

  return {
    trackId: held ? held.id : null,
    trackTitle: held ? held.title : null,
    priorPaid: prior,
    agreedPrice: agreed,
    unlinkedApplied,
  };
}

/**
 * Adds the money fields to rows from getDaqqiAttendees(): prior_paid (now the
 * course's and the track's), agreed_price, track_id, track_title, unlinked_applied.
 * Reads in bulk — a handful of queries for the whole roster, not one per client.
 */
async function attachAttendeeMoney(db, tenantId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  const subscriberIds = [...new Set(rows.map(row => row.subscriber_id))];
  const courseIds = [...new Set(rows.map(row => row.course_id).filter(Boolean))];

  const crmById = new Map();
  const paymentsById = new Map();
  const enrolmentsById = new Map();
  const bookedById = new Map();
  for (const part of chunks(subscriberIds)) {
    const [crmRows] = await db.query(
      `SELECT s.id,
              CASE WHEN s.crm_json IS NOT NULL AND JSON_VALID(s.crm_json) THEN JSON_EXTRACT(s.crm_json, '$.priorPaid') END AS prior_paid,
              CASE WHEN s.crm_json IS NOT NULL AND JSON_VALID(s.crm_json) THEN JSON_EXTRACT(s.crm_json, '$.customPrices') END AS custom_prices
         FROM subscribers s WHERE s.tenant_id=? AND s.id IN (${inList(part)})`, [tenantId, ...part]);
    for (const row of crmRows) crmById.set(row.id, { priorPaid: parseJson(row.prior_paid), customPrices: parseJson(row.custom_prices) });

    const [payRows] = await db.query(
      `SELECT subscriber_id, course_id, bundle_id, status, payment_type, COALESCE(amount_egp, amount) AS amount, course_expected
         FROM payments
        WHERE tenant_id=? AND deleted_at IS NULL AND status IN ('paid','pending') AND subscriber_id IN (${inList(part)})`,
      [tenantId, ...part]);
    for (const row of payRows) {
      const list = paymentsById.get(row.subscriber_id) || [];
      list.push({ courseId: row.course_id, bundleId: row.bundle_id, status: row.status, paymentType: row.payment_type, amount: row.amount, courseExpected: row.course_expected });
      paymentsById.set(row.subscriber_id, list);
    }

    const [enrolRows] = await db.query(
      `SELECT subscriber_id, course_id, bundle_id FROM enrollments
        WHERE tenant_id=? AND status='active' AND subscriber_id IN (${inList(part)})`, [tenantId, ...part]);
    for (const row of enrolRows) {
      const list = enrolmentsById.get(row.subscriber_id) || [];
      list.push({ courseId: row.course_id, bundleId: row.bundle_id });
      enrolmentsById.set(row.subscriber_id, list);
    }

    const [bookRows] = await db.query(
      `SELECT da.subscriber_id, dr.course_id FROM daqqi_attendees da
         JOIN daqqi_rounds dr ON dr.id=da.round_id AND dr.tenant_id=da.tenant_id
        WHERE da.tenant_id=? AND da.subscriber_id IN (${inList(part)})`, [tenantId, ...part]);
    for (const row of bookRows) {
      const set = bookedById.get(row.subscriber_id) || new Set();
      set.add(String(row.course_id));
      bookedById.set(row.subscriber_id, set);
    }
  }

  const [trackRows] = await db.query(
    `SELECT b.id, b.title, b.price_egp, bc.course_id FROM bundles b
       JOIN bundle_courses bc ON bc.bundle_id=b.id AND bc.tenant_id=b.tenant_id
      WHERE b.tenant_id=? AND b.deleted_at IS NULL`, [tenantId]);
  const tracks = new Map();
  for (const row of trackRows) {
    const track = tracks.get(row.id) || { id: row.id, title: row.title, price: num(row.price_egp), courses: new Set() };
    track.courses.add(String(row.course_id));
    tracks.set(row.id, track);
  }
  const tracksOf = new Map();
  for (const track of tracks.values()) {
    for (const course of track.courses) {
      const list = tracksOf.get(course) || [];
      list.push({ id: track.id, title: track.title, price: track.price, courseCount: track.courses.size });
      tracksOf.set(course, list);
    }
  }

  const priceOf = new Map();
  for (const part of chunks(courseIds)) {
    const [courseRows] = await db.query(
      `SELECT id, price_egp FROM courses WHERE tenant_id=? AND id IN (${inList(part)})`, [tenantId, ...part]);
    for (const row of courseRows) priceOf.set(row.id, num(row.price_egp));
  }

  return rows.map(row => {
    const payments = paymentsById.get(row.subscriber_id) || [];
    const crm = crmById.get(row.subscriber_id) || {};
    const enrolments = enrolmentsById.get(row.subscriber_id) || [];
    const otherCourses = new Set([
      ...(bookedById.get(row.subscriber_id) || []),
      ...payments.filter(payment => isItemPayment(payment) && payment.courseId).map(payment => String(payment.courseId)),
      ...enrolments.filter(enrolment => enrolment.courseId).map(enrolment => String(enrolment.courseId)),
    ]);
    const anyTrack = payments.some(payment => payment.bundleId) || enrolments.some(enrolment => enrolment.bundleId)
      || Object.keys(crm.priorPaid || {}).some(key => key.startsWith('bundle:'))
      || Object.keys(crm.customPrices || {}).some(key => key.startsWith('bundle:'));
    const money = resolveAttendeeMoney({
      courseId: row.course_id, crm, payments,
      enrolledBundles: new Set(enrolments.filter(enrolment => enrolment.bundleId).map(enrolment => String(enrolment.bundleId))),
      tracks: tracksOf.get(String(row.course_id)) || [],
      coursePrice: priceOf.get(row.course_id) || 0,
      unlinked: num(row.unlinked_amount), otherCourses, anyTrack,
    });
    return {
      ...row,
      prior_paid: money.priorPaid,
      agreed_price: money.agreedPrice,
      track_id: money.trackId,
      track_title: money.trackTitle,
      unlinked_applied: money.unlinkedApplied,
    };
  });
}

module.exports = { attachAttendeeMoney, resolveAttendeeMoney };
