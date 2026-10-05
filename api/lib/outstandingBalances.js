'use strict';
// Who owes the institute money, and how much: per client, what each course or
// track they were sold was agreed at, less what they have paid for it.
// Read by «أرصدة مستحقة», the payment reminders, and the period statement
// (lib/financeStatement.js). Moved here from routes/crm-tools.js unchanged.
const { pool } = require('./db');
const { priorPaidTotal } = require('./agreedPrice');

async function loadOutstandingBalances(tenantId, subscriberIds = null, scope = null) {
  const params = [tenantId, tenantId];
  let subscriberFilter = '';
  if (subscriberIds) {
    subscriberFilter = ' AND s.id IN (?)';
    params.push(subscriberIds);
  }
  if (scope?.branchId) {
    subscriberFilter += ' AND s.branch_id=?';
    params.push(scope.branchId);
  } else if (scope?.kind === 'assigned_sales' || scope?.kind === 'assigned_cs') {
    subscriberFilter += ` AND s.${scope.kind === 'assigned_sales' ? 'assigned_sales_id' : 'assigned_cs_id'}=?`;
    params.push(scope.staffId);
  }
  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.email, s.phone, s.client_code, s.assigned_sales_name, s.assigned_cs_name, s.crm_json,
            b.total_expected, b.total_paid, b.total_expected - b.total_paid AS outstanding
       FROM subscribers s
       JOIN (
         SELECT tenant_id, subscriber_id, SUM(expected) AS total_expected, SUM(paid) AS total_paid
           FROM (
             SELECT tenant_id, subscriber_id,
                    CASE
                      WHEN course_id IS NOT NULL THEN CONCAT(COALESCE(payment_type,'COURSE'), ':course:', course_id)
                      WHEN bundle_id IS NOT NULL THEN CONCAT(COALESCE(payment_type,'COURSE'), ':bundle:', bundle_id)
                     ELSE CONCAT(COALESCE(payment_type,'OTHER'), ':payment:', id)
                     END AS entitlement_key,
                     MAX(COALESCE(course_expected,0) * COALESCE(fx_rate_to_egp,0)) AS expected,
                     SUM(CASE WHEN status='paid' THEN COALESCE(amount_egp,0) ELSE 0 END) AS paid
                FROM payments
               WHERE tenant_id=? AND deleted_at IS NULL
               GROUP BY tenant_id, subscriber_id, entitlement_key, currency
              HAVING expected > 0
           ) entitlement_balances
          GROUP BY tenant_id, subscriber_id
       ) b ON b.subscriber_id=s.id AND b.tenant_id=s.tenant_id
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL${subscriberFilter}
        AND b.total_expected > b.total_paid
      ORDER BY outstanding DESC
      LIMIT 300`,
    params
  );
  // Less what they paid before the system (lib/agreedPrice.js priorPaid): not a
  // payment row, so the sums above cannot see it, but it is not owed.
  return rows
    .map(({ crm_json: crmJson, ...row }) => {
      const prior = priorPaidTotal(crmJson);
      return prior > 0
        ? { ...row, total_paid: Number(row.total_paid) + prior, outstanding: Number(row.outstanding) - prior }
        : row;
    })
    .filter(row => Number(row.outstanding) > 0);
}

module.exports = { loadOutstandingBalances };
