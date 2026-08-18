'use strict';
/**
 * Issue a course certificate once the customer has genuinely earned it:
 * they have watched at least half the lectures and paid at least 95% of what
 * the course costs.
 *
 * Both halves are deliberate. Watching alone would certify someone who never
 * finished paying; paying alone would certify someone who never opened a
 * lecture. The 95% rather than 100% is what the owner asked for — it absorbs
 * rounding on instalment plans without letting a real unpaid balance through.
 *
 * Runs on a schedule rather than at the moment of watching or paying, because
 * either event can be the one that completes the pair and neither knows about
 * the other. A customer who qualifies is certified within the hour.
 */
const logger = require('./logger');
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { createNotification } = require('./notification');

const WATCHED_THRESHOLD = 50;   // percent of the course's published lectures
const PAID_THRESHOLD = 0.95;    // share of the course price

/**
 * Everyone who qualifies but has not been issued yet.
 *
 * Progress lives in lecture_completions. There is also a lecture_progress
 * table with the more obvious name — it is empty and nothing writes to it,
 * and reading it here would have made this feature silently never fire.
 *
 * A lecture counts as watched at 90% progress rather than 100: video players
 * routinely stop a second or two short, and a customer who watched to the
 * credits should not be held back by that.
 */
const CANDIDATES_SQL = `
  SELECT e.id AS enrollment_id, e.subscriber_id, e.course_id, e.tenant_id,
         s.name AS subscriber_name, s.email AS subscriber_email,
         c.title AS course_title, c.title_ar AS course_title_ar,
         c.price_egp,
         (SELECT COUNT(*) FROM course_lectures cl
           WHERE cl.course_id = e.course_id AND cl.is_published = 1) AS total_lectures,
         (SELECT COUNT(*) FROM lecture_completions lp
            JOIN course_lectures cl2 ON cl2.id = lp.lecture_id AND cl2.is_published = 1
           WHERE lp.subscriber_id = e.subscriber_id AND lp.course_id = e.course_id
             AND (lp.progress_pct >= 90 OR lp.completed_at IS NOT NULL)) AS watched_lectures,
         (SELECT COALESCE(SUM(p.amount_egp), 0) FROM payments p
           WHERE p.subscriber_id = e.subscriber_id AND p.tenant_id = e.tenant_id
             AND p.course_id = e.course_id AND p.status = 'paid'
             AND p.deleted_at IS NULL) AS paid_egp
    FROM enrollments e
    JOIN subscribers s ON s.id = e.subscriber_id AND s.deleted_at IS NULL
    JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id AND c.deleted_at IS NULL
   WHERE e.tenant_id = ? AND e.status = 'active'
     AND (e.certificate_issued = 0 OR e.certificate_issued IS NULL)
   LIMIT 500`;

/** Did this enrolment earn a certificate? Returns the reason when it did not. */
function evaluate(row) {
  const totalLectures = Number(row.total_lectures) || 0;
  const watched = Number(row.watched_lectures) || 0;
  const price = Number(row.price_egp) || 0;
  const paid = Number(row.paid_egp) || 0;

  // A course with no published lectures cannot be half-watched, and a free
  // course cannot be 95% paid — neither is a failure, there is just nothing to
  // measure, so neither is ever certified automatically.
  if (totalLectures === 0) return { ok: false, reason: 'no_lectures' };
  if (price <= 0) return { ok: false, reason: 'no_price' };

  const watchedPct = (watched / totalLectures) * 100;
  const paidShare = paid / price;
  if (watchedPct < WATCHED_THRESHOLD) return { ok: false, reason: 'not_watched_enough', watchedPct, paidShare };
  if (paidShare < PAID_THRESHOLD) return { ok: false, reason: 'not_paid_enough', watchedPct, paidShare };
  return { ok: true, watchedPct, paidShare };
}

async function issueCertificate(conn, row, verdict) {
  const certificateId = uuidv4();
  const serial = `MDN-${new Date().getFullYear()}-${certificateId.slice(0, 8).toUpperCase()}`;
  // issued_certificates carries no tenant column — it is reached only through
  // subscriber_id and course_id, both of which are already tenant-scoped by the
  // query that selected this row.
  await conn.query(
    `INSERT INTO issued_certificates
       (id, subscriber_id, course_id, certificate_number, issued_at, note)
     VALUES (?,?,?,?,NOW(),?)`,
    [certificateId, row.subscriber_id, row.course_id, serial,
      `تلقائي — شاهد ${Math.round(verdict.watchedPct)}% وسدّد ${Math.round(verdict.paidShare * 100)}%`]
  );
  // The flag on the enrolment is what stops this running again for the same
  // person; without it every sweep would re-issue.
  await conn.query(
    `UPDATE enrollments SET certificate_issued = 1, certificate_issued_at = NOW(),
            progress_percent = ?, completed_at = COALESCE(completed_at, NOW())
      WHERE id = ? AND tenant_id = ?`,
    [Math.round(verdict.watchedPct), row.enrollment_id, row.tenant_id]
  );
  return serial;
}

async function runAutoCertificateSweep(tenantId = 'tenant-default') {
  let issued = 0;
  try {
    const [rows] = await pool.query(CANDIDATES_SQL, [tenantId]);
    for (const row of rows) {
      const verdict = evaluate(row);
      if (!verdict.ok) continue;

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const serial = await issueCertificate(conn, row, verdict);
        await conn.commit();
        issued += 1;
        logger.info('[auto-certificate] issued', {
          serial,
          course: row.course_title_ar || row.course_title,
          watchedPct: Math.round(verdict.watchedPct),
          paidShare: Number(verdict.paidShare.toFixed(2)),
        });
        await createNotification(
          'certificate', '🎓 شهادة جديدة',
          `${row.subscriber_name || 'عميل'} استحق شهادة «${row.course_title_ar || row.course_title}»`,
          { subscriberId: row.subscriber_id, courseId: row.course_id, serial },
          row.tenant_id, null
        ).catch(() => {});
      } catch (error) {
        await conn.rollback();
        logger.warn('[auto-certificate] could not issue', { enrollment: row.enrollment_id, error: error.message });
      } finally {
        conn.release();
      }
    }
    // Say so even when nothing qualified, so "ran and found none" and "never
    // ran" are not the same line in the log.
    logger.info(`[auto-certificate] ${issued} issued for ${tenantId}`);
  } catch (error) {
    logger.warn('[auto-certificate] sweep failed:', error.message);
  }
  return issued;
}

module.exports = {
  WATCHED_THRESHOLD, PAID_THRESHOLD, evaluate, runAutoCertificateSweep, CANDIDATES_SQL,
};
