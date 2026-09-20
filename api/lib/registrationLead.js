'use strict';

/**
 * A person who signs up belongs in the client base.
 *
 * Registration used to write a login row and nothing else, so the account
 * appeared under «التسجيلات» and nowhere the desk works. Measured on
 * production: 238 of 1,764 login accounts were in neither the client database
 * nor the leads, and were not staff — people who had signed up that same day
 * among them. Nobody was going to call them, because nobody could see them.
 *
 * A signup is a potential client — a lead — until they book and pay, and that
 * is what this writes. The one routine serves both callers: the signup itself,
 * and «التسجيلات» when somebody converts a registration by hand. Two copies of
 * this would drift, and the one that drifts is the automatic one nobody reads.
 *
 * It never writes a second record for somebody already known: the shared
 * contact matcher decides that, because a phone stored as 01006627192 and one
 * typed as +201006627192 are the same person, and the campaign that found them
 * first must keep the record.
 */

const { uuidv4 } = require('./id');
const { findLeadByContact } = require('./leadMatching');
const { getNextClientCode } = require('./mappers');
const { getNextSalesRep } = require('./leadAssignment');
const { branchIdForBranch, defaultDigitalBranch } = require('./branches');
const { toIdentity } = require('./phoneNumber');

/**
 * @param {import('mysql2/promise').Connection} conn  inside the caller's transaction
 * @param {{ tenantId: string, user: { id?: string, name?: string, email?: string, phone?: string }, branch?: string }} input
 * @returns {Promise<{ created: boolean, leadId: string|null, reason?: string }>}
 */
async function ensureLeadForUser(conn, { tenantId, user, branch } = {}) {
  const phone = toIdentity(user?.phone) || null;
  const email = String(user?.email || '').trim().toLowerCase() || null;
  if (!phone && !email) return { created: false, leadId: null, reason: 'no contact' };

  // Already a client? Then they are not a new lead — they are further along.
  const [[client]] = await conn.query(
    `SELECT id FROM subscribers
      WHERE tenant_id=? AND deleted_at IS NULL
        AND ((? IS NOT NULL AND phone=?) OR (? IS NOT NULL AND LOWER(TRIM(email))=?))
      LIMIT 1`,
    [tenantId, phone, phone, email, email],
  );
  if (client) return { created: false, leadId: null, reason: 'already a client' };

  const existing = await findLeadByContact(conn, { tenantId, phone: user?.phone, email: user?.email });
  if (existing) return { created: false, leadId: existing.id || null, reason: 'already a lead' };

  const resolvedBranch = defaultDigitalBranch(branch);
  const leadId = uuidv4();
  const clientCode = await getNextClientCode(conn);
  const salesRep = await getNextSalesRep(tenantId, conn, { branch: resolvedBranch }).catch(() => null);
  await conn.query(
    `INSERT INTO leads
       (id, tenant_id, client_code, name, email, phone, source, status, hidden,
        branch, branch_id, assigned_sales_id, assigned_sales_name, created_at)
     VALUES (?,?,?,?,?,?,'تسجيل دخول','new',0,?,?,?,?,NOW())`,
    [
      leadId, tenantId, clientCode,
      String(user?.name || '').trim() || String(user?.phone || '').trim() || 'عميل جديد',
      email, phone, resolvedBranch, branchIdForBranch(resolvedBranch),
      salesRep?.id || null, salesRep?.name || null,
    ],
  );
  return { created: true, leadId };
}

module.exports = { ensureLeadForUser };
