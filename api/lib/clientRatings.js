'use strict';

// «اقدر اسجل فيه تقييم العميل من 1 الي 10 في المحاضر وفي المادة العلميه وفي
// توصيل المعلومه وفي مسئولين الفرع» (8 Oct 2026). The four questions, in the
// order the desk asks them; client_ratings keeps one column for each.

const SCORES = Object.freeze([
  { key: 'instructor', column: 'instructor_score', label: 'المحاضر' },
  { key: 'material', column: 'material_score', label: 'المادة العلمية' },
  { key: 'delivery', column: 'delivery_score', label: 'توصيل المعلومة' },
  { key: 'branchStaff', column: 'branch_staff_score', label: 'مسئولين الفرع' },
]);

/** A whole number from 1 to 10, else null. */
function scoreOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** The four scores' mean, to one decimal, from a client_ratings row. */
function averageOf(row) {
  const total = SCORES.reduce((sum, { column }) => sum + Number(row?.[column] || 0), 0);
  return Math.round((total / SCORES.length) * 10) / 10;
}

// «اي تقييم اقل من 5 يفتح تيكت لخدمة العملاء لوحده» (8 Oct 2026, from the
// suggestions the owner chose): an upset client is heard before they leave.
const LOW_RATING = 5;

/**
 * Keep one rating — the desk's or the client's own from their link — and, when
 * its mean is under 5, open a ticket for customer service on the client's file.
 * `round` is { id, code, branch, course_id, instructor_name }. Returns
 * { id, average, ticketId }.
 */
async function saveRating(db, { tenantId, round, subscriberId, scores, note = null, by = {} }) {
  const { uuidv4 } = require('./id');
  const id = uuidv4();
  await db.query(
    `INSERT INTO client_ratings
       (id, tenant_id, subscriber_id, round_id, branch, course_id, instructor_name,
        instructor_score, material_score, delivery_score, branch_staff_score, note, created_by_id, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, subscriberId, round.id, round.branch || null, round.course_id || null, round.instructor_name || null,
      ...scores, note, by.id || null, by.name || null]);
  const average = averageOf(Object.fromEntries(SCORES.map(({ column }, i) => [column, scores[i]])));
  let ticketId = null;
  if (average < LOW_RATING) {
    const [[client]] = await db.query('SELECT name, email FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
    const { createRoutedTicket } = require('../routes/support');
    const { logClientEvent } = require('./clientHistory');
    const subject = `تقييم واطي ${average}/10 — روند ${round.code || ''}`.trim();
    const body = [
      SCORES.map(({ label }, i) => `${label}: ${scores[i]}/10`).join(' · '),
      round.instructor_name ? `المحاضر: ${round.instructor_name}` : null,
      note ? `ملاحظة العميل: ${note}` : null,
      `سجّله: ${by.name || 'العميل'}`,
    ].filter(Boolean).join('\n');
    const ticket = await createRoutedTicket(db, {
      tenantId, subscriberId, email: client?.email || null, name: client?.name || null, subject, body,
      category: 'client_problem', priority: 'high', channel: 'rating', sourceType: 'client_rating', sourceId: id,
      actor: { id: by.id || null, name: by.name || 'التقييمات' },
    });
    ticketId = ticket.id;
    await logClientEvent(db, {
      tenantId, subscriberId, action: 'problem_ticket_opened', actor: by.name || 'التقييمات',
      label: `اتفتح تيكت لخدمة العملاء من تقييم واطي (${average}/10)${note ? ` — ${note}` : ''}`,
    });
  }
  return { id, average, ticketId };
}

module.exports = { LOW_RATING, SCORES, averageOf, saveRating, scoreOf };
