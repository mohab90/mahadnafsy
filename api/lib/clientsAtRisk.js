'use strict';

/**
 * «مؤشر عميل في خطر: تقييم واطي، وغاب محاضرتين، وعليه فلوس» (8 Oct 2026, from
 * the suggestions the owner chose). A client housed in a round still running is
 * at risk when two of the three hold: their latest rating is under 5, they missed
 * two lectures or more, they still owe for the course. The same rule draws the
 * mark on the round's row (admin/lib/clientsAtRisk.ts).
 */

const { getDaqqiAttendees } = require('./daqqiAttendees');
const { attachAttendeeMoney } = require('./daqqiAttendeeMoney');
const { lectureToday } = require('./daqqiLecture');
const { roundsScopeSql } = require('./physicalBranches');
const { averageOf, LOW_RATING } = require('./clientRatings');

const MISSED = 2;
const tryJson = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };

/** The three questions, for one client in one round. */
function riskOf({ latestRating = null, lecture = 0, attended = 0, owed = 0 }) {
  const reasons = [];
  if (latestRating != null && latestRating < LOW_RATING) reasons.push(`تقييمه ${latestRating}/10`);
  const missed = Math.max(0, Number(lecture) - Number(attended));
  if (missed >= MISSED) reasons.push(`غاب ${missed} محاضرات`);
  if (Number(owed) > 0) reasons.push(`عليه ${Math.round(owed).toLocaleString('en-US')} ج.م`);
  return { atRisk: reasons.length >= 2, reasons, missed };
}

async function clientsAtRisk(db, req) {
  const scope = roundsScopeSql(req, 'r');
  const [rounds] = await db.query(
    `SELECT r.id, r.code, r.branch, r.start_date, r.postponed_weeks_json, c.price_egp,
            COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
       FROM daqqi_rounds r LEFT JOIN courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.status <> 'FINISHED'${scope.sql}`, [req.tenantId, ...scope.params]);
  if (!rounds.length) return [];
  const byRound = new Map(rounds.map(round => [round.id, round]));
  const attendees = await attachAttendeeMoney(db, req.tenantId, await getDaqqiAttendees(db, req.tenantId, rounds.map(round => round.id)));
  const ids = [...new Set(attendees.map(row => row.subscriber_id))];
  const latest = new Map();
  if (ids.length) {
    const [ratings] = await db.query(
      `SELECT subscriber_id, instructor_score, material_score, delivery_score, branch_staff_score
         FROM client_ratings WHERE tenant_id = ? AND deleted_at IS NULL AND subscriber_id IN (${ids.map(() => '?').join(',')})
        ORDER BY created_at DESC`, [req.tenantId, ...ids]);
    for (const row of ratings) if (!latest.has(row.subscriber_id)) latest.set(row.subscriber_id, averageOf(row));
  }
  const out = [];
  for (const row of attendees) {
    if (Number(row.archived || 0)) continue;
    const round = byRound.get(row.round_id);
    const price = row.agreed_price != null ? Number(row.agreed_price) : Number(round.price_egp) || 0;
    const paid = Number(row.amount_paid || 0) + Number(row.prior_paid || 0) + Number(row.unlinked_applied || 0);
    const lecture = lectureToday(round.start_date, tryJson(round.postponed_weeks_json, []));
    const risk = riskOf({ latestRating: latest.get(row.subscriber_id) ?? null, lecture, attended: row.attended_lectures, owed: price > 0 ? price - paid : 0 });
    if (!risk.atRisk) continue;
    out.push({
      subscriberId: row.subscriber_id, name: row.name || '', phone: row.phone || '', clientCode: row.client_code || null,
      roundId: round.id, roundCode: round.code, courseTitle: round.course_title || '', reasons: risk.reasons,
      rating: latest.get(row.subscriber_id) ?? null, missed: risk.missed, owed: Math.max(0, price - paid),
    });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || (a.rating ?? 10) - (b.rating ?? 10));
}

module.exports = { MISSED, clientsAtRisk, riskOf };
