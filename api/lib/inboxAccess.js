'use strict';

// Who may see which conversation in the team inbox (owner's decision, 11 Nov 2026): each employee sees ONLY the conversations of their
// own leads — the same data scope the leads list applies (lib/leadAccess.js leadScope) — and nothing of other employees' work. The owner
// and the managers whose scope is «everything» still see all of it; a branch-scoped role sees its branch.
//
// A conversation is visible to a caller who is not «everything» when ANY of these holds:
//   - it is assigned to them (they were handed it, or took it, or the automatic distribution gave it to them);
//   - its lead is inside their lead scope, or its client is inside their client scope (the same rule the client lists use);
//   - it is linked to no lead and no client yet (an unknown number) and they are a triager: the people whose scope is «everything»
//     plus the staff the inbox settings name (teamInboxSettings.triageStaffIds). There was no earlier rule for this: the old «pool»
//     mode simply showed every unlinked, unassigned conversation to every rep.
//
// The same rule decides who is told about a new message (inboxRecipients): a conversation nobody owns used to be broadcast to every
// account that holds the leads permission.

const { pool } = require('./db');
const { leadScope } = require('./leadAccess');
const { teamInboxSettings } = require('./teamInboxSettings');
const { resolveDataScope, canUseChannel } = require('../constants/permissions');

/** What this caller's data scope lets them see in the inbox. `wide`: they oversee others' conversations (everything, or a branch). */
async function inboxAccess(req, db = pool) {
  const settings = await teamInboxSettings(req.tenantId, db);
  const lead = leadScope(req, 'l');
  const me = req.staffRecord?.id || null;
  const all = lead.scope === 'all';
  const wide = all || String(lead.scope).startsWith('branch:');
  return { settings, lead, me, all, wide, triage: all || Boolean(me && settings.triageStaffIds.includes(me)), req };
}

/**
 * An SQL condition to AND into any query over `inbox_threads t LEFT JOIN leads l … LEFT JOIN subscribers s …`, and its parameters.
 * Empty for «everything».
 */
function threadScopeSql(access) {
  if (access.all) return { sql: '', params: [] };
  // Required lazily: routes/admin/stafflists is a large module and only this rule needs its client scope.
  const client = require('../routes/admin/stafflists').staffClientTools.subscriberScope(access.req);
  const parts = ['t.assigned_staff_id = ?'];
  const params = [access.me || ''];
  parts.push(`(l.id IS NOT NULL${access.lead.sql})`);
  params.push(...access.lead.params);
  if (client.clause) { parts.push(`(s.id IS NOT NULL AND ${client.clause})`); params.push(...client.params); }
  parts.push('(t.lead_id IS NULL AND t.subscriber_id IS NULL AND ? = 1)');
  params.push(access.triage ? 1 : 0);
  return { sql: `(${parts.join(' OR ')})`, params };
}

/** The staff who answer unlinked conversations: everyone whose scope is «everything» and who uses the inbox, plus those the settings name. */
async function triageStaff(tenantId, db = pool) {
  const [rows] = await db.query(
    'SELECT id, role, data_scope, permissions_json FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL', [tenantId]);
  const named = new Set((await teamInboxSettings(tenantId, db)).triageStaffIds);
  return rows.filter(row => named.has(row.id)
    || (resolveDataScope(row, { fallback: 'none' }) === 'all' && canUseChannel(row, 'inbox'))).map(row => row.id);
}

/**
 * Who to tell about a message on a conversation: its assigned rep, else the rep who owns the lead (or the client), else the triagers.
 * Never a broadcast — a notification with no recipient reaches every account of its audience.
 */
async function inboxRecipients(tenantId, { assignedStaffId = null, leadId = null, subscriberId = null }, db = pool) {
  if (assignedStaffId) return [assignedStaffId];
  const owners = [];
  if (leadId) {
    const [[row]] = await db.query('SELECT assigned_sales_id, assigned_cs_id FROM leads WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, leadId]);
    if (row) owners.push(row.assigned_sales_id, row.assigned_cs_id);
  }
  if (subscriberId) {
    const [[row]] = await db.query('SELECT assigned_sales_id, assigned_cs_id FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, subscriberId]);
    if (row) owners.push(row.assigned_sales_id, row.assigned_cs_id);
  }
  const owned = [...new Set(owners.filter(Boolean))];
  if (owned.length) {
    const [active] = await db.query(
      `SELECT id FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND id IN (${owned.map(() => '?').join(',')})`, [tenantId, ...owned]);
    if (active.length) return active.map(row => row.id);
  }
  return triageStaff(tenantId, db);
}

/** createNotification to each of the people who may see the conversation, one notice each. */
async function notifyInbox({ type, title, message, data = {}, tenantId, thread }, db = pool) {
  const { createNotification } = require('./notification');
  const to = await inboxRecipients(tenantId, thread, db);
  await Promise.all(to.map(staffId => createNotification(type, title, message, data, tenantId, staffId)));
  return to;
}

module.exports = { inboxAccess, inboxRecipients, notifyInbox, threadScopeSql, triageStaff };
