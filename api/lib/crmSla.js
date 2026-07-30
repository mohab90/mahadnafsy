'use strict';

const { pool } = require('./db');
const outbox = require('./outbox');
const logger = require('./logger').child({ lib: 'crmSla' });

async function enqueueOverdueLeadAlerts(limit = 200) {
  const [rows] = await pool.query(
    `SELECT l.tenant_id,l.id,l.name,l.next_follow_up_date,l.assigned_sales_id,
            s.name AS staff_name,s.email AS staff_email,s.phone AS staff_phone
       FROM leads l
       JOIN staff s ON s.id=l.assigned_sales_id AND s.tenant_id=l.tenant_id AND s.is_active=1 AND s.deleted_at IS NULL
      WHERE l.hidden=0 AND l.deleted_at IS NULL AND l.next_follow_up_date<CURDATE()
        AND l.status NOT IN ('converted','lost','archived','disqualified','not_interested','wrong_number')
      ORDER BY l.next_follow_up_date ASC LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 200, 1), 500)]
  );
  const today = new Date().toISOString().slice(0, 10);
  let queued = 0;
  for (const row of rows) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(row.next_follow_up_date).getTime()) / 86400000));
    const message = `متابعة CRM متأخرة ${days} يوم: ${row.name || row.id}`;
    if (row.staff_email) {
      await outbox.enqueue({
        channel: 'email', recipient: row.staff_email, subject: 'تنبيه متابعة CRM متأخرة', payload: { body: message }, tenantId: row.tenant_id,
        dedupeKey: `crm-sla:${row.tenant_id}:${row.id}:${today}:email`, refType: 'crm_sla', refId: row.id,
      });
      queued++;
    }
    if (row.staff_phone) {
      await outbox.enqueue({
        channel: 'whatsapp', recipient: row.staff_phone, payload: { message }, tenantId: row.tenant_id,
        dedupeKey: `crm-sla:${row.tenant_id}:${row.id}:${today}:whatsapp`, refType: 'crm_sla', refId: row.id,
      });
      queued++;
    }
  }
  if (queued) logger.info('overdue lead alerts queued', { queued, leads: rows.length });
  return queued;
}

module.exports = { enqueueOverdueLeadAlerts };
