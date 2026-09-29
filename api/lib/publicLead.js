'use strict';

// A lead from outside the desk: the site's forms, the chatbot, an external
// webhook (/api/leads-public), a course question on the contact form, and the
// assistant's «استفسار عن كورس». The same number again is the same lead — the
// note is appended — and a new one goes to the next sales rep.

const crypto = require('crypto');
const { pool } = require('./db');
const { getNextClientCode } = require('./mappers');
const { normalizePhone } = require('./helpers');
const { branchIdForBranch, normalizeBranch } = require('./branches');
const { logLeadEvent } = require('./crm');
const { getNextSalesRep } = require('./leadAssignment');
const { phoneIdentityClause } = require('./leadMatching');

/** Returns { id, existing }, or { busy: true } when the same number is being filed right now. */
async function capturePublicLead({ tenantId, name, phone, notes, source, branch }, db = pool) {
  const conn = await db.getConnection();
  let transactionStarted = false;
  const normPhone = normalizePhone(phone);
  const lockName = `lead-public:${crypto.createHash('sha256').update(`${tenantId}:${normPhone || phone}`).digest('hex').slice(0, 40)}`;
  let locked = false;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?,5) AS acquired', [lockName]);
    if (Number(lock?.acquired) !== 1) return { busy: true };
    locked = true;
    await conn.beginTransaction();
    transactionStarted = true;
    const note = String(notes || '').trim().slice(0, 500);
    const origin = String(source || 'chatbot').slice(0, 50);
    const identityMatch = phoneIdentityClause(normPhone);
    if (identityMatch) {
      const [[existing]] = await conn.query(
        `SELECT id FROM leads WHERE tenant_id=? AND ${identityMatch.sql} AND hidden = 0 LIMIT 1 FOR UPDATE`,
        [tenantId, ...identityMatch.params]
      );
      if (existing) {
        await conn.query(
          `UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE CONCAT(notes, '\n', ?) END, updated_at = NOW() WHERE id = ? AND tenant_id=?`,
          [note, note, existing.id, tenantId]
        );
        await logLeadEvent(existing.id, 'note_added', 'Public form submitted again', { source: origin }, tenantId, conn);
        await conn.commit();
        transactionStarted = false;
        return { id: existing.id, existing: true };
      }
    }
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let code = null;
    try { code = await getNextClientCode(conn); } catch (_) { /* a lead without a code is still a lead */ }
    const normalizedBranch = normalizeBranch(branch, 'OTHER');
    const rep = await getNextSalesRep(tenantId, conn, { branch: normalizedBranch, lead: { source: origin, courseIds: [] } });
    await conn.execute(
      `INSERT INTO leads (id, tenant_id, client_code, name, phone, notes, status, interest_level, source, lead_type, branch, branch_id, assigned_sales_id, assigned_sales_name, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, 'new', 'medium', ?, 'general', ?, ?, ?, ?, NOW(), 0)`,
      [id, tenantId, code, String(name).trim().slice(0, 120), String(phone).trim().slice(0, 30), note, origin,
        normalizedBranch, branchIdForBranch(normalizedBranch), rep?.id || null, rep?.name || null]
    );
    await logLeadEvent(id, 'created', 'Public lead captured', { source: origin, assignedSalesId: rep?.id || null }, tenantId, conn);
    await conn.commit();
    transactionStarted = false;
    await require('./lifecycle').trigger('lead_created', { name, phone, tenantId });
    return { id, existing: false, assignedSalesId: rep?.id || null };
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    conn.release();
  }
}

module.exports = { capturePublicLead };
