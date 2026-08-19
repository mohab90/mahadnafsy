'use strict';
// Tenant-bound deal-value sync. Accepts syncLeadDealValue(subscriberId, tenantId)
// or syncLeadDealValue(pool, subscriberId, tenantId, strict).
const { pool: defaultPool } = require('./db');
const { findLeadByContact } = require('./leadMatching');
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
      // The total below is written onto whatever lead this returns, so matching
      // by anything looser than the number itself puts one customer's money on
      // another customer's record — see lib/leadMatching.js.
      const found = await findLeadByContact(pool, {
        tenantId, phone: sub.phone, email: sub.email,
      });
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
