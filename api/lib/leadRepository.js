'use strict';

const { pool } = require('./db');

async function findLeadById({
  tenantId, leadId, db = pool, includeHidden = false, forUpdate = false,
}) {
  if (!tenantId || !leadId) return null;
  const [[lead]] = await db.query(
    `SELECT * FROM leads
      WHERE tenant_id=? AND id=?${includeHidden ? '' : ' AND hidden=0'}
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [tenantId, leadId]
  );
  return lead || null;
}

async function findLeadByIdentity({
  tenantId, phone = null, email = null, excludeId = null, db = pool, forUpdate = false,
}) {
  const clauses = [];
  const params = [tenantId];
  if (phone) { clauses.push('phone=?'); params.push(phone); }
  if (email) { clauses.push('LOWER(email)=LOWER(?)'); params.push(email); }
  if (!clauses.length) return null;
  if (excludeId) params.push(excludeId);
  const [[lead]] = await db.query(
    `SELECT * FROM leads
      WHERE tenant_id=? AND hidden=0 AND merged_into_lead_id IS NULL
        AND (${clauses.join(' OR ')})${excludeId ? ' AND id!=?' : ''}
      ORDER BY created_at ASC LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    params
  );
  return lead || null;
}

async function listLeadCommunications({ tenantId, leadIds, limitPerLead = 20, db = pool }) {
  const ids = [...new Set((leadIds || []).map(String).filter(Boolean))];
  if (!tenantId || !ids.length) return [];
  const safeLimit = Math.min(Math.max(Number(limitPerLead) || 20, 1), 300);
  const [rows] = await db.query(
    `SELECT id,lead_id,type,date,notes,outcome,next_follow_up,staff_id
       FROM (
         SELECT id,lead_id,type,date,notes,outcome,next_follow_up,staff_id,
                ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY date DESC,id DESC) AS row_num
           FROM communications
          WHERE tenant_id=? AND lead_id IN (${ids.map(() => '?').join(',')})
       ) recent
      WHERE row_num<=${safeLimit}
      ORDER BY lead_id,date ASC,id ASC`,
    [tenantId, ...ids]
  );
  return rows;
}

async function archiveLead({ tenantId, leadId, db = pool }) {
  const [result] = await db.query(
    `UPDATE leads SET hidden=1,updated_at=NOW()
      WHERE tenant_id=? AND id=? AND hidden=0`,
    [tenantId, leadId]
  );
  return Boolean(result.affectedRows);
}

module.exports = {
  archiveLead,
  findLeadById,
  findLeadByIdentity,
  listLeadCommunications,
};
