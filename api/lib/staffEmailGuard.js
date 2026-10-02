'use strict';

/**
 * Is this address a member of staff's?
 *
 * Staff authority is resolved BY EMAIL ALONE (lib/authTenant.js#findActiveStaff):
 * whoever can sign in as an account carrying a staff member's address is that
 * staff member, manager and administrator included. So any route that gives an
 * address a login — or changes the address or password of one — has to refuse
 * an address that belongs to staff. /api/auth/register, /api/user/signup and
 * /api/admin/staff-account always did. The routes that edit a customer's
 * credentials, welcome a new customer and convert a lead did not, and an
 * online manager could use the first of them to take over a manager's seat.
 *
 * One function, so the next route that creates a login asks the same question.
 */
async function staffOwnsEmail(db, tenantId, email, adminEmails = []) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (adminEmails.some(address => String(address).trim().toLowerCase() === normalized)) return true;
  const [[row]] = await db.query(
    `SELECT id FROM staff
      WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND deleted_at IS NULL LIMIT 1`,
    [tenantId, normalized],
  );
  return Boolean(row);
}

const STAFF_EMAIL_REFUSAL = Object.freeze({
  status: 403,
  body: {
    error: 'لا يمكن إنشاء أو تعديل حساب دخول على بريد موظف — استخدم شاشة حسابات الموظفين',
    code: 'STAFF_INVITATION_REQUIRED',
  },
});

module.exports = { staffOwnsEmail, STAFF_EMAIL_REFUSAL };
