'use strict';

const { pool } = require('./db');
const { withStaffNames } = require('./staffNames');

const parseDetail = value => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

// «رحلة العميل … محتاجه اشبه بالتايم لاين ويبقي فيه تفاصيل اكتر» (8 Oct 2026).
// Every arm carries `actor` — «مين اللى نفذ المهمه» is part of the history — and
// a `detail` object: how a payment was made and whether it was an instalment, at
// what level a course was opened, a ticket's priority. A payment is titled by its
// course or track (it read «COURSE» where the row had no item title).
//
// The client arm is lib/clientHistory.js — deleted and transferred courses,
// refunds. With the desk's own record — calls and notes with the client, the lead
// they came from — it is the staff's: the client reading their own timeline
// (/api/me/timeline) gets none of it, nor any actor or detail.
async function listCustomerTimeline(tenantId, subscriberId, db = pool, { staff = false } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT 'payment' AS category,CONCAT('payment_',p.status) AS event_type,p.id AS entity_id,
              p.created_at AS occurred_at,
              COALESCE(NULLIF(p.item_title,''),c.title,b.title,p.payment_type,'Payment') AS title,
              p.status,p.amount,p.currency,p.staff_name AS actor,
              JSON_OBJECT('method',p.payment_method,'installment',p.is_installment,'type',p.payment_type,
                          'note',p.note,'expected',p.course_expected) AS detail
       FROM payments p
       LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
       LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
       WHERE p.tenant_id=? AND p.subscriber_id=? AND p.deleted_at IS NULL
       UNION ALL
       SELECT 'learning',CONCAT('entitlement_',ee.event_type),ee.enrollment_id,ee.created_at,
              COALESCE(c.title,'Course access'),ee.event_type,NULL,NULL,ee.actor,
              JSON_OBJECT('source',ee.source,'meta',ee.meta_json)
       FROM entitlement_events ee
       LEFT JOIN courses c ON c.id=ee.course_id AND c.tenant_id=ee.tenant_id
       WHERE ee.tenant_id=? AND ee.subscriber_id=?
       UNION ALL
       SELECT 'certificate',CONCAT('certificate_',ce.event_type),ce.completion_id,ce.created_at,
              COALESCE(c.title,'Certificate'),ce.event_type,NULL,NULL,ce.actor,
              JSON_OBJECT('reason',ce.reason,'code',ce.new_code)
       FROM certificate_lifecycle_events ce
       JOIN course_completions cc ON cc.id=ce.completion_id AND cc.tenant_id=ce.tenant_id
       LEFT JOIN courses c ON c.id=cc.course_id AND c.tenant_id=cc.tenant_id
       WHERE ce.tenant_id=? AND cc.subscriber_id=?
       UNION ALL
       SELECT 'support',CONCAT('support_',st.status),st.id,st.created_at,
              st.subject,st.status,NULL,NULL,st.assigned_to_name,
              JSON_OBJECT('priority',st.priority,'channel',st.channel,'code',st.ticket_code,'resolution',st.resolution_note)
       FROM support_tickets st
       WHERE st.tenant_id=? AND st.subscriber_id=? AND st.deleted_at IS NULL
       UNION ALL
       SELECT 'order',CONCAT('order_',o.status),o.id,o.created_at,
              COALESCE(o.item_title,'Order'),o.status,o.amount,o.currency,o.staff_name,
              JSON_OBJECT('method',o.payment_method)
       FROM orders o
       WHERE o.tenant_id=? AND o.subscriber_id=? AND o.deleted_at IS NULL
       UNION ALL
       SELECT 'client',a.action,a.id,a.at,a.label,a.action,NULL,NULL,a.actor,NULL
       FROM activity_logs a
       WHERE a.tenant_id=? AND a.entity='subscriber' AND a.entity_id=?
     ) timeline
     ORDER BY occurred_at DESC,entity_id DESC LIMIT 150`,
    [tenantId, subscriberId, tenantId, subscriberId, tenantId, subscriberId,
      tenantId, subscriberId, tenantId, subscriberId, tenantId, subscriberId]
  );
  if (!staff) {
    return rows.filter(row => row.category !== 'client')
      .map(({ actor: _actor, detail: _detail, ...row }) => row);
  }

  // The desk's own record: what was said to the client, and the lead they were.
  // A WhatsApp message the system logged on its own is the conversation, not a
  // contact somebody recorded, and stays out.
  const [desk = []] = await db.query(
    `SELECT * FROM (
       SELECT 'contact' AS category,CONCAT('contact_',LOWER(m.type)) AS event_type,m.id AS entity_id,
              m.date AS occurred_at,COALESCE(NULLIF(m.notes,''),'') AS title,m.outcome AS status,
              NULL AS amount,NULL AS currency,m.staff_id AS actor,
              JSON_OBJECT('direction',m.direction,'next',m.next_follow_up) AS detail
       FROM communications m
       WHERE m.tenant_id=? AND m.provider_message_id IS NULL
         AND (m.subscriber_id=? OR m.lead_id=(SELECT lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1))
       UNION ALL
       SELECT 'lead','lead_created',l.id,l.created_at,COALESCE(NULLIF(l.source,''),''),l.status,NULL,NULL,
              l.assigned_sales_name,JSON_OBJECT('rep',l.assigned_sales_name,'branch',l.branch)
       FROM leads l
       WHERE l.tenant_id=? AND l.id=(SELECT lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1)
     ) desk
     ORDER BY occurred_at DESC LIMIT 100`,
    [tenantId, subscriberId, subscriberId, tenantId, tenantId, subscriberId, tenantId]
  ).catch(() => [[]]);

  const all = [...rows, ...(Array.isArray(desk) ? desk : [])]
    .map(row => ({ ...row, detail: parseDetail(row.detail) }))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
    .slice(0, 200);
  // A staff id where the desk signed, the signed-in address where it did not
  // («فتح كورس · بواسطة hana@…»): both read as the employee's name.
  return withStaffNames(tenantId, all, 'actor', db);
}

module.exports = { listCustomerTimeline };
