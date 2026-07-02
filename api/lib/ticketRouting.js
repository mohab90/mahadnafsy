'use strict';
/**
 * Customer-Service routing engine.
 * ────────────────────────────────────────────────────────────────────────────
 * This is the brain that moves a customer problem into the RIGHT department and
 * (optionally) onto the right agent, and sets its response deadline (SLA).
 *
 * Flow it powers:
 *   website / dashboard / whatsapp  ─▶  ticket (category)
 *                                        │ resolveDepartment(category)
 *                                        ▼
 *                                     department  ─▶ pickAssignee() = least-loaded
 *                                        │                             active staff
 *                                        ▼                             of that dept
 *                                     assigned agent + sla_due_at (by priority)
 *
 * Cross-department hand-off is just re-categorising / re-routing a ticket: change
 * category → department recomputes → pickAssignee finds the new owner, and every
 * hop is written to ticket_events (see logTicketEvent) so the journey is auditable.
 */
const { uuidv4 } = require('./id');

// Every inbound problem type, its Arabic label, target department + default priority.
const CATEGORY_META = Object.freeze({
  billing:        { label: 'مدفوعات وفواتير', department: 'collection',  priority: 'high'   },
  refund:         { label: 'طلب استرداد',      department: 'accounting',  priority: 'high'   },
  complaint:      { label: 'شكوى',             department: 'management',  priority: 'high'   },
  technical:      { label: 'مشكلة تقنية',      department: 'support',     priority: 'high'   },
  course_access:  { label: 'وصول للدورة',      department: 'support',     priority: 'high'   },
  sales_inquiry:  { label: 'استفسار مبيعات',   department: 'sales',       priority: 'medium' },
  consultation:   { label: 'استشارة',          department: 'support',     priority: 'medium' },
  certificate:    { label: 'شهادات',           department: 'support',     priority: 'medium' },
  general:        { label: 'عام',              department: 'support',     priority: 'medium' },
});

// Which staff roles staff each department queue (first match wins for labelling).
const DEPARTMENT_ROLES = Object.freeze({
  support:     ['support', 'online_manager'],
  collection:  ['collection', 'sales_collection_manager'],
  accounting:  ['accountant', 'sales_collection_manager'],
  sales:       ['sales', 'sales_collection_manager'],
  instruction: ['instructor', 'trainer'],
  management:  ['manager', 'admin'],
  daqqi:       ['daqqi_manager', 'reception_daqqi'],
});

const DEPARTMENT_LABEL = Object.freeze({
  support: 'الدعم الفني', collection: 'التحصيل', accounting: 'الحسابات',
  sales: 'المبيعات', instruction: 'التدريب', management: 'الإدارة', daqqi: 'الدقي',
});

// First-response SLA (wall-clock hours) by priority.
const SLA_HOURS = Object.freeze({ urgent: 2, high: 4, medium: 24, low: 72 });

function resolveDepartment(category) {
  return (CATEGORY_META[category] || CATEGORY_META.general).department;
}
function defaultPriority(category) {
  return (CATEGORY_META[category] || CATEGORY_META.general).priority;
}
function slaHoursFor(priority) {
  return SLA_HOURS[String(priority || 'medium').toLowerCase()] ?? SLA_HOURS.medium;
}
/** Response deadline as a JS Date, `hours` after `from` (default now). */
function computeSlaDue(priority, from = new Date()) {
  return new Date(from.getTime() + slaHoursFor(priority) * 3600 * 1000);
}

/**
 * Pick the least-loaded active agent for a department (fewest currently-open
 * tickets). Returns { id, name } or null (→ leave in the dept queue, unassigned).
 */
async function pickAssignee(pool, tenantId, department) {
  const roles = DEPARTMENT_ROLES[department];
  if (!roles || !roles.length) return null;
  const placeholders = roles.map(() => '?').join(',');
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name,
              (SELECT COUNT(*) FROM support_tickets t
                 WHERE t.assigned_to = s.id AND t.status IN ('open','in_progress')) AS load_count
         FROM staff s
        WHERE s.is_active = 1
          AND LOWER(TRIM(s.role)) IN (${placeholders})
        ORDER BY load_count ASC, s.name ASC
        LIMIT 1`,
      roles.map(r => r.toLowerCase())
    );
    return rows.length ? { id: rows[0].id, name: rows[0].name } : null;
  } catch {
    return null; // routing is best-effort; ticket still lands in the dept queue
  }
}

/**
 * Append one entry to a ticket's timeline. Best-effort (never throws into the
 * request path). Every assign/route/reply/status/escalate/convert calls this.
 */
async function logTicketEvent(pool, { tenantId = 'tenant-default', ticketId, type, actorId = null, actorName = null, from = null, to = null, detail = null }) {
  try {
    await pool.query(
      `INSERT INTO ticket_events (id, tenant_id, ticket_id, event_type, actor_id, actor_name, from_value, to_value, detail)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), tenantId, ticketId, type, actorId, actorName,
       from == null ? null : String(from).slice(0, 255),
       to == null ? null : String(to).slice(0, 255), detail]
    );
  } catch { /* timeline is non-critical */ }
}

module.exports = {
  CATEGORY_META, DEPARTMENT_ROLES, DEPARTMENT_LABEL, SLA_HOURS,
  resolveDepartment, defaultPriority, slaHoursFor, computeSlaDue,
  pickAssignee, logTicketEvent,
};
