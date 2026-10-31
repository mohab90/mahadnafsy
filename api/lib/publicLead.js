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
const { getNextSalesRep, SINGLE_LEAD_LOADS_TTL_MS } = require('./leadAssignment');
const { leadPhoneClause } = require('./leadMatching');
const { completeForBranch, toIdentity } = require('./phoneNumber');
const { attributionValues, fillAttributionSql } = require('./visitAttribution');

// The one form clients are kept in (lib/phoneNumber.js toIdentity), so the desk
// and the conversion find this lead by the client's number; as typed only when
// it has no digits to keep.
const storedPhone = (phone, branch) => toIdentity(completeForBranch(phone, branch)).slice(0, 30) || String(phone).trim().slice(0, 30);

/** Returns { id, existing }, or { busy: true } when the same number is being filed right now. */
async function capturePublicLead(input, db = pool) {
  const result = await fileLead(input, db);
  // The welcome message is queued only after this request's connection is back
  // in the pool. Queuing it from inside — while still holding the connection and
  // the number's lock — needed a second connection: forty forms at once held all
  // twenty, each waited for a twenty-first, and the API stopped answering until
  // it was restarted.
  if (result.created) {
    await require('./lifecycle').trigger('lead_created', { name: input.name, phone: input.phone, tenantId: input.tenantId });
  }
  return result.created ? { id: result.id, existing: false, assignedSalesId: result.assignedSalesId } : result;
}

async function fileLead({ tenantId, name, phone, notes, source, branch, attribution = null }, db) {
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
    const identityMatch = leadPhoneClause(normPhone);
    if (identityMatch) {
      const [[existing]] = await conn.query(
        `SELECT id FROM leads WHERE tenant_id=? AND ${identityMatch.sql} AND hidden = 0 LIMIT 1 FOR UPDATE`,
        [tenantId, ...identityMatch.params]
      );
      if (existing) {
        // The visit that first brought them is kept; a later form fills only what is empty.
        await conn.query(
          `UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE CONCAT(notes, '\n', ?) END,
                  ${fillAttributionSql()}, updated_at = NOW() WHERE id = ? AND tenant_id=?`,
          [note, note, ...attributionValues(attribution), existing.id, tenantId]
        );
        await logLeadEvent(existing.id, 'note_added', 'Public form submitted again', { source: origin }, tenantId, conn);
        await conn.commit();
        transactionStarted = false;
        return { id: existing.id, existing: true };
      }
    }
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let code = null;
    try { code = await getNextClientCode(conn, tenantId); } catch (_) { /* a lead without a code is still a lead */ }
    const normalizedBranch = normalizeBranch(branch, 'OTHER');
    const rep = await getNextSalesRep(tenantId, conn, { branch: normalizedBranch, lead: { source: origin, courseIds: [] }, loadsTtlMs: SINGLE_LEAD_LOADS_TTL_MS });
    await conn.execute(
      `INSERT INTO leads (id, tenant_id, client_code, name, phone, notes, status, interest_level, source, lead_type, branch, branch_id, assigned_sales_id, assigned_sales_name,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, 'new', 'medium', ?, 'general', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [id, tenantId, code, String(name).trim().slice(0, 120), storedPhone(phone, normalizedBranch), note, origin,
        normalizedBranch, branchIdForBranch(normalizedBranch), rep?.id || null, rep?.name || null, ...attributionValues(attribution)]
    );
    await logLeadEvent(id, 'created', 'Public lead captured', { source: origin, assignedSalesId: rep?.id || null }, tenantId, conn);
    await conn.commit();
    transactionStarted = false;
    return { id, created: true, assignedSalesId: rep?.id || null };
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    conn.release();
  }
}

module.exports = { capturePublicLead };
