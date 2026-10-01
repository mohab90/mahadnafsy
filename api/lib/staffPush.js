'use strict';

// «الإشعارات … مش بيوصل موبايل الموظف غير لو فاتح اللوحة». Every notification
// also goes to the phones its people turned on («فعّل الإشعارات على الجهاز ده»
// in the bell): one addressed to an employee reaches that employee, one for a
// team reaches whoever the bell would show it to (lib/notificationAudience.js),
// and the owner's phone gets everything the owner's bell does. Never blocks or
// fails the change that raised the notification.

const { pool } = require('./db');
const logger = require('./logger').child({ lib: 'staff-push' });
const { sendPushNotification } = require('./push');
const { TYPE_AUDIENCE, inAudience } = require('./notificationAudience');

const parse = value => (typeof value === 'string' ? JSON.parse(value) : value);

async function pushToStaff({ tenantId, type, title, message, recipientStaffId = null, url = '/dashboard' }) {
  const [rows] = await pool.query(
    `SELECT ps.id, ps.subscription_json, ps.is_admin, st.id AS staff_id, st.role, st.permissions_json, st.tenant_id
       FROM push_subscriptions ps
       LEFT JOIN staff st ON st.id = ps.staff_id AND st.tenant_id = ps.tenant_id AND st.deleted_at IS NULL AND st.is_active = 1
      WHERE ps.tenant_id = ? AND ps.is_active = 1 AND (ps.staff_id IS NOT NULL OR ps.is_admin = 1)`,
    [tenantId]);
  const audience = TYPE_AUDIENCE[type];
  const targets = rows.filter(row => {
    if (recipientStaffId) return row.staff_id === recipientStaffId;
    if (row.is_admin) return true;
    if (!row.staff_id) return false;
    return !audience || inAudience({ role: row.role, permissions_json: row.permissions_json, tenant_id: row.tenant_id }, audience);
  });
  const payload = { title: title || 'معهد الدراسات النفسية', body: String(message || '').slice(0, 240), url, tag: type || 'info' };
  let sent = 0;
  for (const row of targets) {
    try {
      await sendPushNotification(parse(row.subscription_json), payload);
      sent++;
      await pool.query('UPDATE push_subscriptions SET last_sent_at=NOW(), last_error=NULL WHERE id=? AND tenant_id=?', [row.id, tenantId]);
    } catch (error) {
      // 404/410: the browser dropped the subscription — stop sending to it.
      const gone = [404, 410].includes(Number(error?.statusCode));
      await pool.query(
        `UPDATE push_subscriptions SET last_error=?, is_active=IF(?, 0, is_active) WHERE id=? AND tenant_id=?`,
        [String(error?.message || error).slice(0, 500), gone ? 1 : 0, row.id, tenantId]).catch(() => {});
      if (!gone) logger.warn('push to staff failed', { err: error?.message });
    }
  }
  return sent;
}

module.exports = { pushToStaff };
