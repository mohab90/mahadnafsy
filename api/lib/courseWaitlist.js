'use strict';
/**
 * SUB-02: notifying a waitlisted person that a seat opened up used to be
 * entirely manual (an admin had to notice a cancellation, open the waitlist
 * tab, and click "notify" themselves). Call this after any enrollment removal
 * to auto-notify the top of the queue for the freed seat(s).
 */
const outbox = require('./outbox');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

// Must run inside the caller's existing transaction on `conn` (after the
// enrollment row has already been deleted/cancelled). Returns the number of
// waitlist entries notified.
async function notifyWaitlistForFreedSeats(tenantId, courseId, conn) {
  if (!courseId) return 0;
  const [[course]] = await conn.query('SELECT title, max_students FROM courses WHERE id=? AND tenant_id=?', [courseId, tenantId]);
  if (!course || !course.max_students) return 0;
  const [[{ enrolled }]] = await conn.query(
    "SELECT COUNT(*) AS enrolled FROM enrollments WHERE course_id=? AND tenant_id=? AND status != 'cancelled'",
    [courseId, tenantId]
  );
  const availableSpots = Math.max(0, Number(course.max_students) - Number(enrolled));
  if (availableSpots <= 0) return 0;

  const [candidates] = await conn.query(
    `SELECT id, name, email FROM course_waitlist WHERE tenant_id=? AND course_id=? AND status='waiting' ORDER BY position ASC LIMIT ?`,
    [tenantId, courseId, availableSpots]
  );
  let notified = 0;
  for (const candidate of candidates) {
    if (!candidate.email) continue;
    await outbox.enqueue({
      channel: 'email', recipient: candidate.email, subject: `متاح مقعد في كورس ${course.title || ''}`,
      payload: { html: `<div dir="rtl"><p>مرحباً ${escapeHtml(candidate.name || '')}،</p><p>توفر مقعد في كورس <strong>${escapeHtml(course.title)}</strong>.</p><p>يرجى التواصل معنا لتأكيد التسجيل.</p></div>` },
      tenantId, dedupeKey: `waitlist-seat:${tenantId}:${candidate.id}`, refType: 'course_waitlist', refId: candidate.id,
    }, conn);
    await conn.query("UPDATE course_waitlist SET status='notified', notified_at=NOW() WHERE id=? AND tenant_id=?", [candidate.id, tenantId]);
    notified++;
  }
  return notified;
}

module.exports = { notifyWaitlistForFreedSeats };
