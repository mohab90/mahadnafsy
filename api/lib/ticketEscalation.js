'use strict';

// What an escalation to the administration is, and how often it has happened.
//
// «لما عملت تصعيد للادارة ايه اللي حصل؟ وصل بيها اشعار فقط … محتاجين يكون عند الادارة 2 اشعار
// واحد للحاجات المهمة جدا وواحد للحاجات المكررة ويبقى في فرق بينهم» (14 Oct 2026).
//   critical  «🚨 مهم جدا»   — the team says this cannot wait: the ticket becomes urgent.
//   repeated  «🔁 متكررة»    — the same client has raised the same kind of problem again, or
//                              the ticket was already closed once and came back.
// Each is its own kind of notification (lib/notificationAudience.js), with its own title, so
// the administration tells them apart on the bell without opening either.

const KINDS = Object.freeze({
  critical: { label: 'مهم جدا', icon: '🚨', priority: 'urgent', notification: 'escalation_critical' },
  repeated: { label: 'متكررة', icon: '🔁', priority: 'high', notification: 'escalation_repeated' },
});
const WINDOW_DAYS = 60;

/**
 * How many times this problem has come back: other tickets of the same client and kind of
 * problem in the last 60 days, plus one when this ticket was reopened after being closed.
 */
async function repeatsOf(db, tenantId, ticket) {
  const keys = [];
  const params = [tenantId, ticket.id, WINDOW_DAYS];
  if (ticket.subscriber_id) { keys.push('t.subscriber_id = ?'); params.push(ticket.subscriber_id); }
  if (ticket.subscriber_email) { keys.push('LOWER(TRIM(t.subscriber_email)) = ?'); params.push(String(ticket.subscriber_email).toLowerCase().trim()); }
  let others = [];
  if (keys.length) {
    params.push(ticket.category || 'general');
    [others] = await db.query(
      `SELECT t.id, t.subject, t.created_at FROM support_tickets t
        WHERE t.tenant_id = ? AND t.id <> ? AND t.deleted_at IS NULL
          AND t.created_at >= NOW() - INTERVAL ? DAY AND (${keys.join(' OR ')}) AND t.category = ?
        ORDER BY t.created_at DESC LIMIT 5`, params);
  }
  const [[reopened]] = await db.query(
    `SELECT COUNT(*) AS n FROM ticket_events WHERE tenant_id = ? AND ticket_id = ? AND event_type = 'status_changed'
        AND to_value = 'open' AND from_value IN ('resolved','closed')`, [tenantId, ticket.id]);
  const again = Number(reopened?.n) || 0;
  return { count: others.length + again, previous: others.map(row => row.subject).filter(Boolean), reopened: again > 0 };
}

/** The kind the escalation is: the one asked for, else «متكررة» when it is a repeat, else «مهم جدا». */
function kindOf(asked, repeats) {
  if (KINDS[asked]) return asked;
  return repeats.count > 0 ? 'repeated' : 'critical';
}

/** The title and text of the notification for this kind. */
function notificationFor(kind, { ticket, repeats, reason, by }) {
  const meta = KINDS[kind];
  const who = ticket.subscriber_name || ticket.subscriber_email || 'عميل';
  const head = kind === 'repeated'
    ? `${meta.icon} مشكلة متكررة — ${who}${repeats.count ? ` (رجعت ${repeats.count === 1 ? 'مرة واحدة' : repeats.count > 10 ? `${repeats.count} مرة` : `${repeats.count} مرات`})` : ''}`
    : `${meta.icon} مهم جدا — تصعيد للإدارة`;
  const text = [
    `${who}: ${ticket.subject || 'تذكرة'}`,
    kind === 'repeated' && repeats.previous.length ? `سبق: ${repeats.previous.slice(0, 3).join(' | ')}` : '',
    reason ? `السبب: ${reason}` : '',
    by ? `صعّدها: ${by}` : '',
  ].filter(Boolean).join(' — ');
  return { type: meta.notification, title: head, message: text };
}

module.exports = { KINDS, WINDOW_DAYS, repeatsOf, kindOf, notificationFor };
