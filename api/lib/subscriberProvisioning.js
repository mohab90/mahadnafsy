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
const { toIdentity } = require('./phoneNumber');
const logger = require('./logger');

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
  // subscribers has UNIQUE (tenant_id, phone). This used to insert `phone || ''`
  // with the number exactly as typed, so a payment could not be recorded when
  //   * the customer gave no phone: '' is a value, and production already holds
  //     one subscriber with phone '' — every later blank collided with it; or
  //   * the number already belonged to another subscriber under a different
  //     email — the returning customer who signed up again.
  // Either way the insert failed, the transaction that marks the order paid and
  // opens the course rolled back with it, and the webhook still answered 200, so
  // Paymob never retried: money taken, nothing recorded. Found on staging by
  // signing a second capture for a phone the first had used.
  //
  // So: the identity form, NULL when there is none (NULLs never collide), and a
  // number someone else already holds is left off this record with a note for
  // staff rather than attaching the purchase to whoever owns the number — that
  // could be a different person, and the payer signed in with this email.
  const phoneKey = toIdentity(phone) || null;
  let phoneForRow = phoneKey;
  let reviewNote = null;
  if (phoneKey) {
    const [[holder]] = await conn.query(
      'SELECT id, client_code FROM subscribers WHERE tenant_id=? AND phone=? LIMIT 1 FOR UPDATE',
      [tenantId, phoneKey]
    );
    if (holder) {
      phoneForRow = null;
      reviewNote = `رقم الهاتف ${phoneKey} مسجّل بالفعل للعميل ${holder.client_code || holder.id} — تم تسجيل الدفعة على هذا الحساب بدون الرقم؛ راجِع الحسابين للدمج.`;
      logger.warn('[subscriber-provisioning] phone already held by another subscriber — created without it', {
        tenantId, holderId: holder.id,
      });
    }
  }

  const subscriberId = uuidv4();
  const clientCode = await getNextClientCode(conn);
  const branch = lead?.branch || fallbackBranch;
  const branchId = lead?.branch_id || fallbackBranchId || null;
  const insert = (phoneValue, note) => conn.query(
    `INSERT INTO subscribers
       (id, firebase_uid, client_code, lead_id, name, email, phone, branch, branch_id,
        assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
        notes, is_active, tenant_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NOW())`,
    [subscriberId, uid || null, clientCode, lead?.id || null, name || normalizedEmail.split('@')[0],
     normalizedEmail, phoneValue, branch, branchId,
     lead?.assigned_sales_id || null, lead?.assigned_sales_name || null,
     lead?.assigned_cs_id || null, lead?.assigned_cs_name || null, note, tenantId]
  );
  try {
    await insert(phoneForRow, reviewNote);
  } catch (error) {
    // Two first-time payers with the same new number can both pass the lookup
    // above. A failed statement does not end a MySQL transaction, so the second
    // is recorded without the number instead of losing the payment.
    if (!(error && error.code === 'ER_DUP_ENTRY' && /uq_subs_tenant_phone/.test(error.message) && phoneForRow)) throw error;
    logger.warn('[subscriber-provisioning] phone taken between check and insert — created without it', { tenantId });
    await insert(null, `رقم الهاتف ${phoneForRow} سُجّل لعميل آخر في نفس اللحظة — تم تسجيل الدفعة بدون الرقم؛ راجِع للدمج.`);
  }
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
