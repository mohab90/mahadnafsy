'use strict';
/**
 * GET /api/me/next-step — what the client portal's «خطوتك الجاية» card needs
 * that the portal does not already load: the next session of the Dokki or
 * Tagamoa round the client is housed in, what they still owe for it, and the
 * certificates they have earned.
 *
 * «كارت خطوتك الجاية» (11 Oct 2026). Everything else on the card — what is owed
 * per course, the certificate requests, the next lecture online — is read from
 * what /api/me/subscriber already returns.
 *
 * Only ever the signed-in client's own rows, in their own institute.
 */
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'me-next-step-route' });
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { nextHeldSession } = require('../lib/daqqiLecture');
const { getDaqqiAttendees } = require('../lib/daqqiAttendees');
const { attachAttendeeMoney } = require('../lib/daqqiAttendeeMoney');
const { cairoToday } = require('../lib/dates');
const { ymd } = require('../lib/helpers');

const SLOTS = { MORNING: 'صباحاً', NOON: 'ظهراً', EVENING: 'مساءً' };
const BRANCHES = { DAQQI: 'الدقي', TAGAMOA: 'التجمع' };

function parseList(value) {
  try { const list = JSON.parse(value || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}

/** The round the client meets next, of all the open ones they sit in. Pure. */
function nextSessionOf(rounds, today = cairoToday()) {
  return rounds
    .map(round => {
      const startDate = ymd(round.start_date);
      const next = startDate ? nextHeldSession(startDate, parseList(round.postponed_weeks_json), today) : null;
      if (!next) return null;
      return {
        roundId: round.id,
        code: round.code,
        branch: round.branch || 'DAQQI',
        branchLabel: BRANCHES[round.branch] || BRANCHES.DAQQI,
        courseId: round.course_id,
        courseTitle: round.course_title || '',
        lecture: next.lecture,
        date: next.date,
        dayOfWeek: round.day_of_week || '',
        timeSlot: SLOTS[round.time_slot] || SLOTS.EVENING,
        room: round.room || '',
        instructorName: round.instructor_name || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.code).localeCompare(String(b.code)))[0] || null;
}

/**
 * What the client owes towards each round, by the rule the Dokki schedule shows
 * under «المتبقي» (admin daqqiScheduleUtils.attendeeMoney): the price they
 * agreed — their course's or their track's — less what came in as payments,
 * what they paid before the system, and unnamed money when this is their only course.
 */
function roundBalance(row) {
  const paid = (Number(row.amount_paid) || 0) + (Number(row.prior_paid) || 0) + (Number(row.unlinked_applied) || 0);
  const price = Number(row.agreed_price) || 0;
  return {
    roundId: row.round_id,
    courseId: row.course_id,
    trackId: row.track_id || null,
    trackTitle: row.track_title || null,
    item: row.track_id ? `bundle:${row.track_id}` : String(row.course_id),
    price,
    paid,
    remaining: price > 0 ? Math.max(0, price - paid) : 0,
    currency: 'EGP',
  };
}

// The certificates the client has earned (course_completions). The portal reads
// them only when its certificates tab opens, and the card is on the first screen.
async function earnedCertificates(tenantId, subscriberId) {
  const [rows] = await pool.query(
    `SELECT cc.course_id, cc.certificate_code, cc.completed_at, c.title AS course_title
       FROM course_completions cc
       LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
      WHERE cc.subscriber_id = ? AND cc.tenant_id = ? AND cc.status = 'active'
      ORDER BY cc.completed_at DESC LIMIT 20`,
    [subscriberId, tenantId]);
  return rows.map(row => ({
    courseId: row.course_id, courseTitle: row.course_title || '',
    code: row.certificate_code, completedAt: ymd(row.completed_at),
  }));
}

router.get('/api/me/next-step', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.json({ session: null, rounds: [], certificates: [] });
    const certificates = await earnedCertificates(req.tenantId, sub.id);
    const [rounds] = await pool.query(
      `SELECT r.id, r.code, r.branch, r.course_id, c.title AS course_title, r.instructor_name, r.day_of_week,
              r.start_date, r.time_slot, r.room, r.postponed_weeks_json
         FROM daqqi_attendees da
         JOIN daqqi_rounds r ON r.id = da.round_id AND r.tenant_id = da.tenant_id
         LEFT JOIN courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
        WHERE da.tenant_id = ? AND da.subscriber_id = ? AND r.status <> 'FINISHED'
        ORDER BY r.start_date DESC LIMIT 20`,
      [req.tenantId, sub.id]);
    if (rounds.length === 0) return res.json({ session: null, rounds: [], certificates });

    const attendees = (await getDaqqiAttendees(pool, req.tenantId, rounds.map(round => round.id)))
      .filter(row => String(row.subscriber_id) === String(sub.id));
    const money = await attachAttendeeMoney(pool, req.tenantId, attendees);
    const titles = new Map(rounds.map(round => [round.id, round.course_title || '']));
    res.json({
      session: nextSessionOf(rounds),
      rounds: money.map(row => ({ ...roundBalance(row), title: row.track_title || titles.get(row.round_id) || '' })),
      certificates,
    });
  } catch (e) {
    logger.error('[me/next-step]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router._test = { nextSessionOf, roundBalance };

module.exports = router;
