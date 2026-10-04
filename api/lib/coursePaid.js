'use strict';

/**
 * Has this client paid for this course — by a payment row on it or on a track
 * that holds it, or by «مدفوع قبل السيستم» (crm_json.priorPaid, the money of an
 * old sheet's «المحصل», counted on every balance by lib/agreedPrice.js) for the
 * course or for such a track.
 *
 * The certificate request and the course completion each asked for a payment
 * row and nothing else. Most Dokki clients' money is priorPaid with no payment
 * row (1,609 of 1,919 on 3 October): they had paid and finished, and were told
 * to pay first — by the portal, and by the completion staff record by hand.
 * A refund row (negative, status 'paid', same course) is not a payment.
 */
async function hasPaidForCourse(db, { tenantId, subscriberId, courseId }) {
  const [[paid]] = await db.query(
    `SELECT 1 AS ok FROM payments p
      WHERE p.subscriber_id=? AND p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.amount > 0
        AND (p.course_id=? OR EXISTS (
          SELECT 1 FROM bundle_courses bc WHERE bc.bundle_id=p.bundle_id AND bc.course_id=? AND bc.tenant_id=p.tenant_id
        )) LIMIT 1`,
    [subscriberId, tenantId, courseId, courseId]
  );
  if (paid) return true;
  const [[client]] = await db.query('SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
  let prior = {};
  try {
    const crm = client?.crm_json && typeof client.crm_json === 'object' ? client.crm_json : JSON.parse(client?.crm_json || '{}');
    prior = (crm && crm.priorPaid) || {};
  } catch { prior = {}; }
  if (Number(prior[String(courseId)]) > 0) return true;
  const tracks = Object.keys(prior).filter(key => key.startsWith('bundle:') && Number(prior[key]) > 0).map(key => key.slice(7));
  if (!tracks.length) return false;
  const [[inTrack]] = await db.query(
    'SELECT 1 AS ok FROM bundle_courses WHERE tenant_id=? AND course_id=? AND bundle_id IN (?) LIMIT 1',
    [tenantId, courseId, tracks]
  );
  return Boolean(inTrack);
}

module.exports = { hasPaidForCourse };
