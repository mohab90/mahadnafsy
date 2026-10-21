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
 *                                     department  ─▶ pickAssignee() = in turn
 *                                        │                             active staff
 *                                        ▼                             of that dept
 *                                     assigned agent + sla_due_at (by priority)
 *
 * Cross-department hand-off is just re-categorising / re-routing a ticket: change
 * category → department recomputes → pickAssignee finds the new owner, and every
 * hop is written to ticket_events (see logTicketEvent) so the journey is auditable.
 */
const { uuidv4 } = require('./id');
const { cairoToday } = require('./dates');
const { hasPermission } = require('../constants/permissions');

// Permissions counted in hours (lib/hrPolicy.js): the employee is at work that day.
const HOURLY_LEAVE_TYPES = Object.freeze(['LATE_PERMIT', 'EARLY_LEAVE', 'PERMISSION']);

// Every inbound problem type, its Arabic label, target department + default priority.
const CATEGORY_META = Object.freeze({
  billing:        { label: 'مدفوعات وفواتير', department: 'collection',  priority: 'high'   },
  refund:         { label: 'طلب استرداد',      department: 'accounting',  priority: 'high'   },
  complaint:      { label: 'شكوى',             department: 'management',  priority: 'high'   },
  technical:      { label: 'مشكلة تقنية',      department: 'support',     priority: 'high'   },
  course_access:  { label: 'وصول للدورة',      department: 'support',     priority: 'high'   },
  sales_inquiry:  { label: 'استفسار مبيعات',   department: 'sales',       priority: 'medium' },
  hr_inquiry:     { label: 'استفسار موارد بشرية', department: 'hr',       priority: 'medium' },
  consultation:   { label: 'استشارة',          department: 'support',     priority: 'medium' },
  certificate:    { label: 'شهادات',           department: 'support',     priority: 'medium' },
  general:        { label: 'عام',              department: 'support',     priority: 'medium' },
  // «فتح تيكت مشكلة» from the transfer menu, Dokki or online: the account's
  // owner could not handle it, so customer service hears the client out.
  client_problem: { label: 'مشكلة عميل',       department: 'support',     priority: 'high'   },
});

// Which staff roles staff each department queue (first match wins for labelling).
// A problem goes to the team that handles it, in turn, never to the managers:
// «مازلت لسه بتوزع المشاكل علي المديرين ليه؟» (14 Oct 2026). With nobody of the team
// on duty it waits in the department's queue, unassigned, where the managers see it.
// Management, HR and the two branches keep their manager: that is who they are for.
const DEPARTMENT_ROLES = Object.freeze({
  support:     ['support'],
  collection:  ['collection'],
  accounting:  ['accountant'],
  sales:       ['sales'],
  instruction: ['instructor', 'trainer'],
  management:  ['manager', 'admin'],
  daqqi:       ['daqqi_manager', 'reception_daqqi'],
  tagamoa:     ['tagamoa_manager', 'reception_tagamoa'],
  // Falls back to a manager so an HR enquiry is never left with no owner in an
  // institute that has only one HR employee (or none on a given day).
  hr:          ['hr', 'manager'],
});

const DEPARTMENT_LABEL = Object.freeze({
  support: 'الدعم الفني', collection: 'التحصيل', accounting: 'الحسابات',
  sales: 'المبيعات', instruction: 'التدريب', management: 'الإدارة', daqqi: 'الدقي', tagamoa: 'التجمع',
  hr: 'الموارد البشرية',
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
 * SET terms that put a reopened ticket back on the clock, for an UPDATE whose
 * `status` assignment comes AFTER them (MySQL reads the old status here).
 * `when` is a literal SQL condition, no placeholders.
 *
 * A ticket a client wrote on again went back to «open» still carrying its old
 * resolved_at and first response: the reports counted it resolved, the SLA
 * sweep (which looks for no first response) never saw it, and it waited with no
 * deadline. Reopened, it is a new wait: answered and resolved again from now.
 */
function reopenTicketSql(when = "status IN ('resolved','closed')") {
  const hours = Object.entries(SLA_HOURS)
    .map(([priority, h]) => `WHEN '${priority}' THEN ${Number(h)}`).join(' ');
  return `resolved_at=IF(${when}, NULL, resolved_at),
          first_response_at=IF(${when}, NULL, first_response_at),
          sla_due_at=IF(${when}, NOW() + INTERVAL (CASE LOWER(priority) ${hours} ELSE ${SLA_HOURS.medium} END) HOUR, sla_due_at),
          sla_breach_notified_at=IF(${when}, NULL, sla_breach_notified_at),
          sla_breached=IF(${when}, 0, sla_breached)`;
}

/**
 * Pick the least-loaded active agent for a department (fewest currently-open
 * tickets). Returns { id, name } or null (→ leave in the dept queue, unassigned).
 *
 * FOR UPDATE on the chosen staff row, because without it this is a read two
 * requests can make in the same instant and both act on. The load count is
 * derived from support_tickets, and the ticket that changes it is inserted
 * after this returns — so two tickets arriving together both saw the same agent
 * as least loaded and both went to them, defeating the routing this function
 * exists to provide.
 *
 * The lock serialises the pick: the second caller waits for the first to commit,
 * then re-reads and sees the count it just changed. Three of the four call sites
 * pass an open transaction connection, which is what gives the lock a lifetime;
 * the fourth is the SLA sweep, where it releases immediately under autocommit
 * and the escalation it performs is idempotent regardless.
 */
async function pickAssignee(pool, tenantId, department, { today = cairoToday() } = {}) {
  const roles = DEPARTMENT_ROLES[department];
  if (!roles || !roles.length) return null;
  const placeholders = roles.map(() => '?').join(',');
  // Nobody on an approved day off (an hours-long إذن is still a working day):
  // an urgent ticket went to an agent on leave and sat unanswered past its SLA.
  // Only someone who can open the ticket: every ticket screen asks for
  // manage_inbox, which the HR role does not hold — an HR enquiry routed to the
  // HR employee reached somebody who could not read it. With nobody left, the
  // manager the department falls back to (or its queue) takes it.
  const [rows] = await pool.query(
    // In turn: whoever was handed a ticket longest ago (never first), the open
    // load breaking a tie. By load alone, one agent holding old open tickets
    // received nothing: «متوزعش المشاكل علي حازم ووليد فقط — فريق خدمه العملاء
    // ال3» (10 Oct 2026).
    `SELECT s.id, s.name, s.role, s.permissions_json, s.tenant_id,
            (SELECT MAX(t.created_at) FROM support_tickets t
               WHERE t.tenant_id=s.tenant_id AND t.assigned_to=s.id AND t.deleted_at IS NULL) AS last_at,
            (SELECT COUNT(*) FROM support_tickets t
               WHERE t.tenant_id=s.tenant_id AND t.assigned_to=s.id
                 AND t.deleted_at IS NULL AND t.status IN ('open','in_progress')) AS load_count
       FROM staff s
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
        AND LOWER(TRIM(s.role)) IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM leaves lv
                         WHERE lv.tenant_id=s.tenant_id AND lv.staff_id=s.id AND lv.status='APPROVED'
                           AND lv.type NOT IN (${HOURLY_LEAVE_TYPES.map(() => '?').join(',')})
                           AND lv.start_date<=? AND lv.end_date>=?)
      ORDER BY last_at IS NOT NULL, last_at ASC, load_count ASC, s.name ASC
      FOR UPDATE`,
    [tenantId, ...roles.map(role => role.toLowerCase()), ...HOURLY_LEAVE_TYPES, today, today]
  );
  const pick = rows.find(row => hasPermission(row, 'manage_inbox'));
  return pick ? { id: pick.id, name: pick.name } : null;
}

/**
 * Append one entry to a ticket's timeline. Best-effort (never throws into the
 * request path). Every assign/route/reply/status/escalate/convert calls this.
 */
async function logTicketEvent(pool, { tenantId = 'tenant-default', ticketId, type, actorId = null, actorName = null, from = null, to = null, detail = null }) {
  await pool.query(
    `INSERT INTO ticket_events (id, tenant_id, ticket_id, event_type, actor_id, actor_name, from_value, to_value, detail)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [uuidv4(), tenantId, ticketId, type, actorId, actorName,
     from == null ? null : String(from).slice(0, 255),
     to == null ? null : String(to).slice(0, 255), detail]
  );
}

module.exports = {
  CATEGORY_META, DEPARTMENT_ROLES, DEPARTMENT_LABEL, SLA_HOURS,
  resolveDepartment, defaultPriority, slaHoursFor, computeSlaDue,
  pickAssignee, logTicketEvent, reopenTicketSql,
};
