'use strict';

const { pool } = require('./db');
const { withStaffNames } = require('./staffNames');

// `actor` on every arm: «مين اللى نفذ المهمه» is part of the history, not a
// detail behind it. The client arm is lib/clientHistory.js — deleted and
// transferred courses, refunds asked for and made. Both are the desk's: the
// client reading their own timeline (/api/me/timeline) gets neither.
async function listCustomerTimeline(tenantId, subscriberId, db = pool, { staff = false } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT 'payment' AS category,CONCAT('payment_',p.status) AS event_type,p.id AS entity_id,
              p.created_at AS occurred_at,COALESCE(p.item_title,p.payment_type,'Payment') AS title,
              p.status,p.amount,p.currency,p.staff_name AS actor
       FROM payments p
       WHERE p.tenant_id=? AND p.subscriber_id=? AND p.deleted_at IS NULL
       UNION ALL
       SELECT 'learning',CONCAT('entitlement_',ee.event_type),ee.enrollment_id,ee.created_at,
              COALESCE(c.title,'Course access'),ee.event_type,NULL,NULL,ee.actor
       FROM entitlement_events ee
       LEFT JOIN courses c ON c.id=ee.course_id AND c.tenant_id=ee.tenant_id
       WHERE ee.tenant_id=? AND ee.subscriber_id=?
       UNION ALL
       SELECT 'certificate',CONCAT('certificate_',ce.event_type),ce.completion_id,ce.created_at,
              COALESCE(c.title,'Certificate'),ce.event_type,NULL,NULL,ce.actor
       FROM certificate_lifecycle_events ce
       JOIN course_completions cc ON cc.id=ce.completion_id AND cc.tenant_id=ce.tenant_id
       LEFT JOIN courses c ON c.id=cc.course_id AND c.tenant_id=cc.tenant_id
       WHERE ce.tenant_id=? AND cc.subscriber_id=?
       UNION ALL
       SELECT 'support',CONCAT('support_',st.status),st.id,st.created_at,
              st.subject,st.status,NULL,NULL,NULL
       FROM support_tickets st
       WHERE st.tenant_id=? AND st.subscriber_id=?
       UNION ALL
       SELECT 'order',CONCAT('order_',o.status),o.id,o.created_at,
              COALESCE(o.item_title,'Order'),o.status,o.amount,o.currency,NULL
       FROM orders o
       WHERE o.tenant_id=? AND o.subscriber_id=?
       UNION ALL
       SELECT 'client',a.action,a.id,a.at,a.label,a.action,NULL,NULL,a.actor
       FROM activity_logs a
       WHERE a.tenant_id=? AND a.entity='subscriber' AND a.entity_id=?
     ) timeline
     ORDER BY occurred_at DESC,entity_id DESC LIMIT 100`,
    [tenantId, subscriberId, tenantId, subscriberId, tenantId, subscriberId,
      tenantId, subscriberId, tenantId, subscriberId, tenantId, subscriberId]
  );
  if (!staff) return rows.filter(row => row.category !== 'client').map(({ actor: _actor, ...row }) => row);
  // A staff id where the desk signed, the signed-in address where it did not
  // («فتح كورس · بواسطة hana@…»): both read as the employee's name.
  return withStaffNames(tenantId, rows, 'actor', db);
}

module.exports = { listCustomerTimeline };
