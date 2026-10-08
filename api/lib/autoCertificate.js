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
 * Required quizzes must be passed too, and the certificate is the same one an
 * admin issues by hand (lib/courseCompletion.js), which the client sees.
 *
 * Runs on a schedule rather than at the moment of watching or paying, because
 * either event can be the one that completes the pair and neither knows about
 * the other. A customer who qualifies is certified within the hour.
 */
const logger = require('./logger');
const { pool } = require('./db');
const { createNotification } = require('./notification');
const { completeCourse } = require('./courseCompletion');
const { PAID_SHARE } = require('./coursePaid');

const WATCHED_THRESHOLD = 50;   // percent of the course's published lectures
const PAID_THRESHOLD = PAID_SHARE; // share of the course price — one rule with staff completion and requests
const BATCH = 500;

/**
 * The next batch of enrolments that might qualify, after `afterId`.
 *
 * Read in id order to the end every run. It used to be the first 500 with no
 * order, and nothing marked the ones that did not qualify — so the same 500
 * came back every hour and nobody past them was ever looked at. Only
 * enrolments with something watched are read: nobody qualifies at zero.
 *
 * Progress lives in lecture_completions. There is also a lecture_progress
 * table with the more obvious name — it is empty and nothing writes to it.
 *
 * A lecture counts as watched at 90% progress rather than 100: video players
 * routinely stop a second or two short, and a customer who watched to the
 * credits should not be held back by that.
 */
const CANDIDATES_SQL = `
  SELECT e.id AS enrollment_id, e.subscriber_id, e.course_id, e.tenant_id,
         s.name AS subscriber_name, s.crm_json,
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
             AND p.deleted_at IS NULL) AS paid_egp,
         -- A required quiz not passed holds the certificate, as it does for a
         -- certificate issued by hand.
         (SELECT COUNT(*) FROM course_quizzes q
           WHERE q.tenant_id = e.tenant_id AND q.course_id = e.course_id AND q.required_for_completion = 1
             AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa
                              WHERE qa.tenant_id = q.tenant_id AND qa.quiz_id = q.id
                                AND qa.subscriber_id = e.subscriber_id AND qa.passed = 1)) AS quizzes_missing
    FROM enrollments e
    JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id AND s.deleted_at IS NULL
    JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id AND c.deleted_at IS NULL
   WHERE e.tenant_id = ? AND e.status = 'active' AND e.access_type = 'full'
     AND (e.certificate_issued = 0 OR e.certificate_issued IS NULL)
     AND e.id > ?
     AND EXISTS (SELECT 1 FROM lecture_completions lx
                  WHERE lx.subscriber_id = e.subscriber_id AND lx.course_id = e.course_id)
   ORDER BY e.id
   LIMIT ${BATCH}`;

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
  // The best of what the course was paid by: its own payments, or the share
  // of a track (or of «مدفوع قبل السيستم») found by otherPaidShare.
  const paidShare = Math.max(paid / price, Number(row.other_paid_share) || 0);
  if (watchedPct < WATCHED_THRESHOLD) return { ok: false, reason: 'not_watched_enough', watchedPct, paidShare };
  if (paidShare < PAID_THRESHOLD) return { ok: false, reason: 'not_paid_enough', watchedPct, paidShare };
  if (Number(row.quizzes_missing) > 0) return { ok: false, reason: 'quiz_not_passed', watchedPct, paidShare };
  return { ok: true, watchedPct, paidShare };
}

/**
 * The course paid for some other way: a track (bundle) that holds it, or the
 * money an old sheet recorded as already collected (crm_json.priorPaid, for
 * the course or for such a track). As a share of what was owed for it.
 */
async function otherPaidShare(db, row) {
  const [tracks] = await db.query(
    `SELECT b.id, b.price_egp, COALESCE(SUM(p.amount_egp), 0) AS paid
       FROM bundle_courses bc
       JOIN bundles b ON b.id = bc.bundle_id AND b.tenant_id = bc.tenant_id
       LEFT JOIN payments p ON p.bundle_id = b.id AND p.tenant_id = b.tenant_id AND p.subscriber_id = ?
        AND p.status = 'paid' AND p.deleted_at IS NULL
      WHERE bc.tenant_id = ? AND bc.course_id = ?
      GROUP BY b.id, b.price_egp`,
    [row.subscriber_id, row.tenant_id, row.course_id]);
  let prior = {};
  try {
    const crm = row.crm_json && typeof row.crm_json === 'object' ? row.crm_json : JSON.parse(row.crm_json || '{}');
    prior = (crm && crm.priorPaid) || {};
  } catch { prior = {}; }
  const shares = [(Number(prior[String(row.course_id)]) || 0) / (Number(row.price_egp) || Infinity)];
  for (const track of tracks) {
    const price = Number(track.price_egp) || 0;
    if (price > 0) shares.push((Number(track.paid) + (Number(prior[`bundle:${track.id}`]) || 0)) / price);
  }
  return Math.max(0, ...shares.filter(Number.isFinite));
}

async function runAutoCertificateSweep(tenantId = 'tenant-default') {
  let issued = 0;
  try {
    let afterId = '';
    for (;;) {
      const [rows] = await pool.query(CANDIDATES_SQL, [tenantId, afterId]);
      for (const row of rows) {
        let verdict = evaluate(row);
        if (!verdict.ok && verdict.reason === 'not_paid_enough') {
          verdict = evaluate({ ...row, other_paid_share: await otherPaidShare(pool, row) });
        }
        if (!verdict.ok) continue;
        try {
          // The certificate the client sees (course_completions) — issued by the
          // same function as one issued by hand. The sweep used to write a
          // table nothing on the client's side reads: the admin was told a
          // certificate was earned, and the client never got it.
          const result = await completeCourse({
            tenantId: row.tenant_id, subscriberId: row.subscriber_id, courseId: row.course_id,
            actor: 'auto-certificate', requireFullProgress: false,
            reason: `تلقائي — شاهد ${Math.round(verdict.watchedPct)}% وسدّد ${Math.round(verdict.paidShare * 100)}%`,
          });
          await pool.query(
            `UPDATE enrollments SET certificate_issued = 1, certificate_issued_at = NOW(),
                    progress_percent = GREATEST(progress_percent, ?), completed_at = COALESCE(completed_at, NOW())
              WHERE id = ? AND tenant_id = ?`,
            [Math.round(verdict.watchedPct), row.enrollment_id, row.tenant_id]);
          if (result.alreadyCompleted) continue;
          issued += 1;
          logger.info('[auto-certificate] issued', {
            code: result.certificate_code,
            course: row.course_title_ar || row.course_title,
            watchedPct: Math.round(verdict.watchedPct),
            paidShare: Number(verdict.paidShare.toFixed(2)),
          });
          await createNotification(
            'certificate', '🎓 شهادة جديدة',
            `${row.subscriber_name || 'عميل'} استحق شهادة «${row.course_title_ar || row.course_title}»`,
            { subscriberId: row.subscriber_id, courseId: row.course_id, code: result.certificate_code },
            row.tenant_id, null
          ).catch(() => {});
        } catch (error) {
          logger.warn('[auto-certificate] could not issue', { enrollment: row.enrollment_id, error: error.message });
        }
      }
      if (rows.length < BATCH) break;
      afterId = rows[rows.length - 1].enrollment_id;
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
  WATCHED_THRESHOLD, PAID_THRESHOLD, evaluate, otherPaidShare, runAutoCertificateSweep, CANDIDATES_SQL,
};
