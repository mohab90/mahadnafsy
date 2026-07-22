'use strict';
// Tenant-bound deal-value sync. Accepts syncLeadDealValue(subscriberId, tenantId)
// or syncLeadDealValue(pool, subscriberId, tenantId, strict).
const { pool: defaultPool } = require('./db');
const logger = require('./logger').child({ lib: 'leadDealValue' });

async function syncLeadDealValue(arg1, arg2, arg3, arg4 = false) {
  // Overload resolution: a pool-like first arg → (pool, id); otherwise → (id).
  const pool = arg1 && typeof arg1.query === 'function' ? arg1 : defaultPool;
  const subscriberId = arg1 && typeof arg1.query === 'function' ? arg2 : arg1;
  const tenantId = arg1 && typeof arg1.query === 'function' ? arg3 : arg2;
  const strict = arg1 && typeof arg1.query === 'function' ? arg4 : Boolean(arg3);
  if (!subscriberId || !tenantId) return false;
  try {
    const [[totRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp),0) AS total FROM payments
        WHERE subscriber_id=? AND tenant_id=? AND status='paid' AND deleted_at IS NULL AND amount_egp>0`,
      [subscriberId, tenantId],
    );
    const total = Number(totRow?.total || 0);
    if (!total) return false;

    const [[sub]] = await pool.query('SELECT id, lead_id, phone, email FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
    if (!sub) return false;

    let leadId = sub.lead_id;
    if (!leadId && (sub.phone || sub.email)) {
      const normPhone = sub.phone ? sub.phone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
      const q = normPhone
        ? "SELECT id FROM leads WHERE tenant_id=? AND (REGEXP_REPLACE(phone,'[^0-9]','') LIKE ? OR LOWER(email)=LOWER(?)) AND hidden=0 ORDER BY created_at DESC LIMIT 1"
        : 'SELECT id FROM leads WHERE tenant_id=? AND LOWER(email)=LOWER(?) AND hidden=0 ORDER BY created_at DESC LIMIT 1';
      const params = normPhone ? [tenantId, `%${normPhone.slice(-9)}`, sub.email || ''] : [tenantId, sub.email];
      const [[found]] = await pool.query(q, params);
      leadId = found?.id || null;
    }
    if (!leadId) return false;

    await pool.query('UPDATE leads SET deal_value=? WHERE id=? AND tenant_id=?', [total, leadId, tenantId]);
    logger.info('lead deal_value synced', { leadId, subscriberId, total });
    return true;
  } catch (error) {
    logger.warn('syncLeadDealValue error', { error: error.message });
    if (strict) throw error;
    return false;
  }
}

module.exports = { syncLeadDealValue };
