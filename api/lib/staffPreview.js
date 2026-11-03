'use strict';

// The employee an owner previews (middleware/auth.js applyPreview): the staff row and the login it runs as. Kept out of the middleware, which looks staff up only through
// findActiveStaff (tests/authTenantIsolation.test.js).

/** @returns {Promise<{ staff: { id, name, email }, loginId: string } | null>} null when the employee is not active or has no login. */
async function loadPreviewTarget(db, tenantId, staffId) {
  const [[staff]] = await db.query(
    'SELECT id, name, email FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1', [tenantId, staffId]);
  const email = String(staff?.email || '').toLowerCase().trim();
  if (!staff || !email) return null;
  const [[login]] = await db.query('SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [tenantId, email]);
  return login ? { staff: { ...staff, email }, loginId: login.id } : null;
}

module.exports = { loadPreviewTarget };
