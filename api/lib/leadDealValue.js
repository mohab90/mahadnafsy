'use strict';
// Single source of truth for lead deal-value sync. Accepts BOTH call styles for
// backward compatibility: syncLeadDealValue(subscriberId) OR syncLeadDealValue(pool, subscriberId).
const { pool: defaultPool } = require('./db');
const logger = require('./logger').child({ lib: 'leadDealValue' });

async function syncLeadDealValue(arg1, arg2) {
  // Overload resolution: a pool-like first arg → (pool, id); otherwise → (id).
  const pool = arg1 && typeof arg1.query === 'function' ? arg1 : defaultPool;
  const subscriberId = arg1 && typeof arg1.query === 'function' ? arg2 : arg1;
  if (!subscriberId) return;
  try {
    const [[totRow]] = await pool.query(
      'SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE subscriber_id = ? AND amount > 0',
      [subscriberId],
    );
    const total = Number(totRow?.total || 0);
    if (!total) return;

    const [[sub]] = await pool.query('SELECT id, lead_id, phone, email FROM subscribers WHERE id = ? LIMIT 1', [subscriberId]);
    if (!sub) return;

    let leadId = sub.lead_id;
    if (!leadId && (sub.phone || sub.email)) {
      const normPhone = sub.phone ? sub.phone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
      const q = normPhone
        ? "SELECT id FROM leads WHERE (REGEXP_REPLACE(phone,'[^0-9]','') LIKE ? OR LOWER(email)=LOWER(?)) AND hidden=0 ORDER BY created_at DESC LIMIT 1"
        : 'SELECT id FROM leads WHERE LOWER(email)=LOWER(?) AND hidden=0 ORDER BY created_at DESC LIMIT 1';
      const params = normPhone ? [`%${normPhone.slice(-9)}`, sub.email || ''] : [sub.email];
      const [[found]] = await pool.query(q, params);
      leadId = found?.id || null;
    }
    if (!leadId) return;

    await pool.query('UPDATE leads SET deal_value = ? WHERE id = ?', [total, leadId]);
    logger.info('lead deal_value synced', { leadId, subscriberId, total });
  } catch (error) {
    logger.warn('syncLeadDealValue error', { error: error.message });
  }
}

module.exports = { syncLeadDealValue };
