'use strict';

// Each subscriber's installment plans, from installment_plans, for the lists.
//
// The subscriber lists took `installmentPlans` from crm_json, where one client's
// plan was ever written; the plans the installments routes create live in their
// own table, so the «الأقساط» column could not show a plan made the proper way.

const { pool } = require('./db');
const { mapInstallmentPlan } = require('./installmentMath');

async function installmentPlansBySubscriber(tenantId, subscriberIds, db = pool) {
  const byId = new Map();
  const ids = [...new Set((subscriberIds || []).filter(Boolean))];
  if (!ids.length) return byId;
  const [rows] = await db.query(
    `SELECT ip.id, ip.subscriber_id, ip.course_id, ip.bundle_id, ip.title, ip.total_amount, ip.currency,
            ip.installments_count, ip.installment_amounts, ip.due_dates, ip.paid_dates, ip.paid_amounts,
            ip.notes, ip.created_at, COALESCE(c.title, b.title) AS course_title
       FROM installment_plans ip
       LEFT JOIN courses c ON c.id=ip.course_id AND c.tenant_id=ip.tenant_id
       LEFT JOIN bundles b ON b.id=ip.bundle_id AND b.tenant_id=ip.tenant_id
      WHERE ip.tenant_id=? AND ip.subscriber_id IN (${ids.map(() => '?').join(',')})
      ORDER BY ip.created_at`,
    [tenantId, ...ids]
  );
  for (const row of rows) {
    const plan = { ...mapInstallmentPlan(row), courseId: row.course_id || (row.bundle_id ? `bundle:${row.bundle_id}` : undefined) };
    const list = byId.get(row.subscriber_id) || [];
    list.push(plan);
    byId.set(row.subscriber_id, list);
  }
  return byId;
}

// A subscriber's crm with its table plans in place of whatever crm_json held.
// The one client whose plan lives only in crm_json keeps it.
function withInstallmentPlans(crm, plans) {
  return plans && plans.length ? { ...crm, installmentPlans: plans } : crm;
}

module.exports = { installmentPlansBySubscriber, withInstallmentPlans };
