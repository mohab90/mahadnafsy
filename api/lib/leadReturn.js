'use strict';

// A person whose lead was hidden or closed fills a form / signs up again: they are interested again, so the lead comes back
// to its rep. One routine for every public intake (the site form, the chatbot/contact form, signup, «تحويل التسجيل») so they
// cannot drift from the Facebook intake, which follows the same convention (lib/facebookLeadEvents.js).
//
// Rules (owner, 11 Nov 2026):
//   - hidden=0, out of the archive, status back to «new» when it had ended without a sale, due today;
//   - the assigned rep is told; a lead with no rep, or whose rep left, goes through the normal assignment;
//   - a MERGED copy is never revived (callers match merged_into_lead_id IS NULL — its surviving lead is the match);
//   - a lead that is a sale (converted/won) is never put back in the pipeline: that person is a client.

const { cairoToday } = require('./dates');
const { logLeadEventStrict } = require('./crm');
const { transitionLead } = require('./leadState');
const { insertNotification } = require('./notification');
const { TERMINAL_LEAD_STATUSES, CONVERTED_LEAD_STATUSES } = require('./leadStatuses');

/**
 * @param {import('mysql2/promise').Connection} conn  the caller's open transaction
 * @param {{tenantId: string, lead: {id: string, name?: string, status?: string, hidden?: number, assigned_sales_id?: string|null},
 *          via: string, pickRep: () => Promise<{id: string, name: string}|null>}} input
 *   lead needs id, status, hidden and assigned_sales_id; `via` is the human label of the form («نموذج الموقع»)
 * @returns {Promise<{reopened: boolean, owner: {id: string, name: string}|null}>}
 */
async function bringBackReturningLead(conn, { tenantId, lead, via, pickRep }) {
  const status = String(lead.status || '').toLowerCase();
  if (CONVERTED_LEAD_STATUSES.has(status)) return { reopened: false, owner: null };
  const reopened = Number(lead.hidden) === 1 || TERMINAL_LEAD_STATUSES.has(status);
  if (!reopened) return { reopened: false, owner: null };

  let owner = null;
  if (lead.assigned_sales_id) {
    const [[row]] = await conn.query(
      'SELECT id, name FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
      [tenantId, lead.assigned_sales_id]);
    owner = row || null;
  }
  if (!owner) owner = await pickRep();

  await conn.query(
    `UPDATE leads SET hidden=0, next_follow_up_date=?,
            assigned_sales_id=COALESCE(?,assigned_sales_id), assigned_sales_name=COALESCE(?,assigned_sales_name), updated_at=NOW()
      WHERE id=? AND tenant_id=?`,
    [cairoToday(), owner?.id || null, owner?.name || null, lead.id, tenantId]);
  if (TERMINAL_LEAD_STATUSES.has(status)) {
    // A fact that already happened (they came back), not a rep's move: the pipeline's rules do not apply.
    await transitionLead({
      tenantId, leadId: lead.id, toStatus: 'new', db: conn, force: true, actor: 'public',
      reason: `${via} — رجع تاني`, metadata: { previousStatus: status },
    });
  }
  await logLeadEventStrict(lead.id, 'reopened', `رجع من ${via} — اتفتح تاني ومتابعته النهارده`,
    { via, previousStatus: status || null, hidden: Number(lead.hidden) === 1 }, tenantId, conn);
  // In the caller's transaction, so the notice exists exactly when the lead is back.
  await insertNotification(conn, 'lead', '🔁 ليد رجع تاني', `${lead.name || 'ليد'} — رجع من ${via} ومتابعته النهارده`,
    { leadId: lead.id }, tenantId, owner?.id || null);
  return { reopened: true, owner };
}

module.exports = { bringBackReturningLead };
