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
const { hasPaidForBundle, hasPaidForCourse } = require('./coursePaid');

const DELIVERY_STAGES = Object.freeze(['READY', 'PRINTED', 'AT_BRANCH', 'SHIPPED', 'DELIVERED', 'RETURNED']);

function parseCrm(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

/**
 * Every (client, course) and (client, track) with money in and no certificate yet.
 *
 * «أي عميل حجز مسار بيطلعله شهادة المسار كامل فقط مش الكورسات الداخلية» (26 Oct 2026): a client who booked a TRACK is certified for the track —
 * one certificate, whose id is the track's — and not for each course inside it; a course counts on its own only when its own money is in.
 * An item is { subscriberId, courseId } or { subscriberId, bundleId }.
 */
async function candidatePairs(db, tenantId) {
  const pairs = new Map();
  const addCourse = (subscriberId, courseId) => {
    if (subscriberId && courseId) pairs.set(`${subscriberId}|${courseId}`, { subscriberId: String(subscriberId), courseId: String(courseId) });
  };
  const addTrack = (subscriberId, bundleId) => {
    if (subscriberId && bundleId) pairs.set(`${subscriberId}|${bundleId}`, { subscriberId: String(subscriberId), bundleId: String(bundleId) });
  };
  const [direct] = await db.query(
    `SELECT DISTINCT p.subscriber_id, p.course_id FROM payments p
      WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.course_id IS NOT NULL AND p.bundle_id IS NULL
        AND COALESCE(p.payment_type, '') IN ('', 'COURSE', 'OTHER')`, [tenantId]);
  direct.forEach(row => addCourse(row.subscriber_id, row.course_id));
  const [viaTrack] = await db.query(
    `SELECT DISTINCT p.subscriber_id, p.bundle_id FROM payments p
       JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id AND b.deleted_at IS NULL
      WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.bundle_id IS NOT NULL
        AND COALESCE(p.payment_type, '') IN ('', 'BUNDLE', 'COURSE', 'OTHER')`, [tenantId]);
  viaTrack.forEach(row => addTrack(row.subscriber_id, row.bundle_id));
  // «مدفوع قبل السيستم»: most of Dokki's clients paid before the system existed.
  const [prior] = await db.query(
    `SELECT id, crm_json FROM subscribers
      WHERE tenant_id=? AND deleted_at IS NULL AND crm_json LIKE '%priorPaid%'`, [tenantId]);
  for (const row of prior) {
    for (const [key, amount] of Object.entries(parseCrm(row.crm_json).priorPaid || {})) {
      if (!(Number(amount) > 0)) continue;
      if (key.startsWith('bundle:')) addTrack(row.id, key.slice(7)); else addCourse(row.id, key);
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
    for (const { subscriberId, courseId, bundleId } of await candidatePairs(db, tenantId)) {
      try {
        const paid = bundleId
          ? await hasPaidForBundle(db, { tenantId, subscriberId, bundleId })
          : await hasPaidForCourse(db, { tenantId, subscriberId, courseId });
        if (!paid) continue;
        const result = await completeCourse({
          tenantId, subscriberId, courseId, bundleId, actor: 'شهادات المعهد', requireFullProgress: false,
          requireEnrollment: false, sendEmail: false, reason: `شهادة المعهد — دفع 90% أو أكتر من ${bundleId ? 'المسار' : 'الكورس'}`,
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

const DELIVERY_OF_REQUEST = Object.freeze({ SHIPPED: 'SHIPPED', AT_BRANCH: 'AT_BRANCH', DELIVERED: 'DELIVERED' });

/**
 * «العملاء القدام … شهادة المعهد صدرت بس بتفشل لما نفتحها ومش في السجل» (25 Oct 2026): an institute certificate
 * issued as a REQUEST (by hand, or by the old system and imported) is also a course completion under the same code, so
 * the printable design opens, its QR resolves to the design and it is listed in the history. A client who already
 * holds a completion for the course keeps it; a code already used by a completion is left alone.
 *
 * @param {object} db       a connection (inside the caller's transaction)
 * @param {object} request  the certificate_requests row, with the status it is moving to
 * @returns {Promise<boolean>} whether a completion was written
 */
async function recordIssuedInstituteCertificate(db, request) {
  if (String(request.type || '').toUpperCase() !== 'INSTITUTE') return false;
  if (!request.subscriber_id || !request.course_id || !request.certificate_code || !request.tenant_id) return false;
  const [result] = await db.query(
    `INSERT IGNORE INTO course_completions
       (id, subscriber_id, course_id, certificate_code, completed_at, delivery_status, cert_name_en, status, version, tenant_id)
     SELECT ?,?,?,?,COALESCE(?, NOW()),?,?, 'active', 1, ?
      FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM course_completions WHERE tenant_id=? AND subscriber_id=? AND course_id=?)
        AND NOT EXISTS (SELECT 1 FROM course_completions WHERE certificate_code=?)`,
    [require('./id').uuidv4(), request.subscriber_id, request.course_id, request.certificate_code, request.issued_at || null,
      DELIVERY_OF_REQUEST[String(request.status || '').toUpperCase()] || 'READY', String(request.name_en || '').trim() || null,
      request.tenant_id, request.tenant_id, request.subscriber_id, request.course_id, request.certificate_code]);
  return Boolean(result?.affectedRows);
}

module.exports = { DELIVERY_STAGES, candidatePairs, recordIssuedInstituteCertificate, sweepInstituteCertificates };
