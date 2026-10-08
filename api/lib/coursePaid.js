'use strict';

const { agreedPrice } = require('./agreedPrice');

// Share of the agreed price that must be in before a course counts as paid for —
// the same for the automatic certificate (lib/autoCertificate.js), a completion
// recorded by staff and a client's own certificate request. Those two took any
// payment at all (CRIT-04 of the 7 Oct 2026 audit): a 25% instalment earned
// the certificate the automatic sweep would have held back.
// «لاي عميل خلص فلوسه او 90 % من فلوسه» (8 Oct 2026) — was 95%.
const PAID_SHARE = 0.9;

function parseCrm(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

/**
 * Has this client paid for this course — on the course itself or on a track
 * that holds it, by its payment rows (a refund takes its amount back; the
 * certificate, carnet or book paid for beside it is not the course) and by
 * «مدفوع قبل السيستم» (crm_json.priorPaid, the money of an old sheet's
 * «المحصل»): at least PAID_SHARE of the price agreed for it (lib/agreedPrice.js).
 * When no price is known anywhere, any money in counts, as it always did.
 *
 * Most Dokki clients' money is priorPaid with no payment row (1,609 of 1,919
 * on 3 October): it counts the same as a payment.
 */
async function hasPaidForCourse(db, { tenantId, subscriberId, courseId }) {
  const [[client]] = await db.query('SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
  const prior = parseCrm(client?.crm_json).priorPaid || {};
  const [tracks] = await db.query('SELECT bundle_id FROM bundle_courses WHERE tenant_id=? AND course_id=?', [tenantId, courseId]);
  const items = [{ courseId, bundleId: null, key: String(courseId) },
    ...tracks.map(track => ({ courseId: null, bundleId: track.bundle_id, key: `bundle:${track.bundle_id}` }))];

  for (const item of items) {
    const [byCurrency] = await db.query(
      `SELECT currency, SUM(amount) AS paid FROM payments
        WHERE tenant_id=? AND subscriber_id=? AND status='paid' AND deleted_at IS NULL
          AND COALESCE(payment_type, '') IN ('', 'COURSE', 'BUNDLE', 'OTHER')
          AND ${item.bundleId ? 'bundle_id=?' : 'course_id=? AND bundle_id IS NULL'}
        GROUP BY currency ORDER BY paid DESC`,
      [tenantId, subscriberId, item.bundleId || item.courseId]
    );
    const currency = byCurrency[0]?.currency || 'EGP';
    const paid = (Number(byCurrency[0]?.paid) || 0) + (Number(prior[item.key]) || 0);
    if (paid <= 0) continue;
    const price = await agreedPrice(db, { tenantId, subscriberId, courseId: item.courseId, bundleId: item.bundleId, currency });
    if (!price || paid >= price * PAID_SHARE) return true;
  }
  return false;
}

module.exports = { PAID_SHARE, hasPaidForCourse };
