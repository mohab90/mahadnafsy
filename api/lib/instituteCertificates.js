'use strict';

/**
 * «شهادات المعهد» (8 Oct 2026): «اتوماتك ومجاني لاي عميل خلص فلوسه او 90 % من
 * فلوسه … اتوماتك يظهر في القايمه دي».
 *
 * Every client who has paid 90% of a course — its own payments, a track that
 * holds it, or «مدفوع قبل السيستم» (lib/coursePaid.js, the same rule everywhere)
 * — gets the course's certificate: the digital one the site already shows and
 * verifies (course_completions), issued by the same function as one issued by
 * hand. Watching is not asked: a Dokki client sat the lectures in the hall. The
 * desk then follows the printed copy (delivery_status) and sees when the client
 * opened it from the site (downloaded_at).
 *
 * A client whose certificate was revoked is not certified again here; that is a
 * person's decision (lib/certificateLifecycle.js).
 */

const logger = require('./logger');
const { pool } = require('./db');
const { completeCourse } = require('./courseCompletion');
const { hasPaidForCourse } = require('./coursePaid');

const DELIVERY_STAGES = Object.freeze(['READY', 'PRINTED', 'AT_BRANCH', 'SHIPPED', 'DELIVERED', 'RETURNED']);

function parseCrm(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

/** Every (client, course) with course money and no certificate yet. */
async function candidatePairs(db, tenantId) {
  const pairs = new Map();
  const add = (subscriberId, courseId) => {
    if (subscriberId && courseId) pairs.set(`${subscriberId}|${courseId}`, { subscriberId: String(subscriberId), courseId: String(courseId) });
  };
  const [direct] = await db.query(
    `SELECT DISTINCT p.subscriber_id, p.course_id FROM payments p
      WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.course_id IS NOT NULL
        AND COALESCE(p.payment_type, '') IN ('', 'COURSE', 'OTHER')`, [tenantId]);
  direct.forEach(row => add(row.subscriber_id, row.course_id));
  const [viaTrack] = await db.query(
    `SELECT DISTINCT p.subscriber_id, bc.course_id FROM payments p
       JOIN bundle_courses bc ON bc.bundle_id=p.bundle_id AND bc.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.bundle_id IS NOT NULL
        AND COALESCE(p.payment_type, '') IN ('', 'BUNDLE', 'COURSE', 'OTHER')`, [tenantId]);
  viaTrack.forEach(row => add(row.subscriber_id, row.course_id));
  // «مدفوع قبل السيستم»: most of Dokki's clients paid before the system existed.
  const [prior] = await db.query(
    `SELECT id, crm_json FROM subscribers
      WHERE tenant_id=? AND deleted_at IS NULL AND crm_json LIKE '%priorPaid%'`, [tenantId]);
  const trackIds = new Set();
  const priorTracks = [];
  for (const row of prior) {
    for (const [key, amount] of Object.entries(parseCrm(row.crm_json).priorPaid || {})) {
      if (!(Number(amount) > 0)) continue;
      if (key.startsWith('bundle:')) { trackIds.add(key.slice(7)); priorTracks.push([row.id, key.slice(7)]); } else add(row.id, key);
    }
  }
  if (trackIds.size) {
    const [courses] = await db.query(
      `SELECT bundle_id, course_id FROM bundle_courses WHERE tenant_id=? AND bundle_id IN (${[...trackIds].map(() => '?').join(',')})`,
      [tenantId, ...trackIds]);
    for (const [subscriberId, bundleId] of priorTracks) {
      courses.filter(row => String(row.bundle_id) === String(bundleId)).forEach(row => add(subscriberId, row.course_id));
    }
  }
  const [certified] = await db.query('SELECT subscriber_id, course_id FROM course_completions WHERE tenant_id=?', [tenantId]);
  certified.forEach(row => pairs.delete(`${row.subscriber_id}|${row.course_id}`));
  return [...pairs.values()];
}

const running = new Set();

/** Issue every certificate earned since the last run. Returns how many. */
async function sweepInstituteCertificates(tenantId = 'tenant-default', db = pool) {
  if (running.has(tenantId)) return 0;
  running.add(tenantId);
  let issued = 0;
  try {
    for (const { subscriberId, courseId } of await candidatePairs(db, tenantId)) {
      try {
        if (!(await hasPaidForCourse(db, { tenantId, subscriberId, courseId }))) continue;
        const result = await completeCourse({
          tenantId, subscriberId, courseId, actor: 'شهادات المعهد', requireFullProgress: false,
          requireEnrollment: false, sendEmail: false, reason: 'شهادة المعهد — دفع 90% أو أكتر من الكورس',
        });
        if (!result.alreadyCompleted) issued += 1;
      } catch (error) {
        // A course gone or with no price: nothing to certify, and not a failure of the run.
        if (error.statusCode !== 409) logger.warn('[institute-certificates] could not issue', { subscriberId, courseId, error: error.message });
      }
    }
    logger.info(`[institute-certificates] ${issued} issued for ${tenantId}`);
  } catch (error) {
    logger.warn('[institute-certificates] sweep failed:', error.message);
  } finally {
    running.delete(tenantId);
  }
  return issued;
}

module.exports = { DELIVERY_STAGES, candidatePairs, sweepInstituteCertificates };
