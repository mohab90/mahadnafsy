'use strict';
/**
 * Shared "ensure a subscriber exists" step for every payment entry point.
 *
 * Root cause this closes: a customer can pay (Paymob, manual transfer proof,
 * installment) before ever having a `subscribers` row — registration only
 * creates a `users` + `leads` row (see api/routes/auth.js), and a subscriber
 * is otherwise only created when an admin manually converts a lead. Every
 * payment path used to handle this differently; payment-proofs.js got it
 * right (create-if-missing, linked to the matching lead when one exists),
 * public-orders.js's Paymob path did not (silently skipped enrollment when
 * no subscriber was found — see the LMS-01 issue backlog entry). This
 * extracts the proven logic into one function so every entry point behaves
 * the same way.
 */
const { uuidv4 } = require('./id');
const { getNextClientCode } = require('./mappers');

// Must run inside an existing transaction on `conn` (uses FOR UPDATE locks).
// Returns { id, lead_id, branch, branch_id } — either the existing subscriber
// row or a newly-created one linked to a matching lead when found.
async function ensureSubscriberForOrder(conn, {
  tenantId, uid = null, email, name, phone = '', fallbackBranch = 'ONLINE_EGYPT', fallbackBranchId = null,
}) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail) throw new Error('ensureSubscriberForOrder requires a customer email');

  let [[sub]] = await conn.query(
    'SELECT id, lead_id, branch, branch_id, assigned_sales_id, tenant_id FROM subscribers WHERE tenant_id=? AND (firebase_uid=? OR LOWER(TRIM(email))=?) LIMIT 1 FOR UPDATE',
    [tenantId, uid || '', normalizedEmail]
  );
  if (sub) {
    if (uid) await conn.query('UPDATE subscribers SET firebase_uid=COALESCE(firebase_uid,?) WHERE id=? AND tenant_id=?', [uid, sub.id, tenantId]);
    return sub;
  }

  const [[lead]] = await conn.query(
    'SELECT id, branch, branch_id, assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name FROM leads WHERE tenant_id=? AND LOWER(TRIM(email))=? AND hidden=0 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
    [tenantId, normalizedEmail]
  );
  const subscriberId = uuidv4();
  const clientCode = await getNextClientCode(conn);
  const branch = lead?.branch || fallbackBranch;
  const branchId = lead?.branch_id || fallbackBranchId || null;
  await conn.query(
    `INSERT INTO subscribers
       (id, firebase_uid, client_code, lead_id, name, email, phone, branch, branch_id,
        assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
        is_active, tenant_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NOW())`,
    [subscriberId, uid || null, clientCode, lead?.id || null, name || normalizedEmail.split('@')[0],
     normalizedEmail, phone || '', branch, branchId,
     lead?.assigned_sales_id || null, lead?.assigned_sales_name || null,
     lead?.assigned_cs_id || null, lead?.assigned_cs_name || null, tenantId]
  );
  return {
    id: subscriberId,
    lead_id: lead?.id || null,
    branch,
    branch_id: branchId,
    assigned_sales_id: lead?.assigned_sales_id || null,
    tenant_id: tenantId,
  };
}

module.exports = { ensureSubscriberForOrder };
