'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { normalizePhone, tryJson } = require('./helpers');
const { logLeadEventStrict } = require('./crm');

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function mergeJson(targetRaw, sourceRows) {
  const target = tryJson(targetRaw, {});
  const sources = sourceRows.map(row => tryJson(row.crm_json, {}));
  const merged = { ...sources.reduce((acc, crm) => ({ ...acc, ...crm }), {}), ...target };
  delete merged.communications;
  return merged;
}

function duplicateGroups(rows) {
  const parent = new Map(rows.map(row => [row.id, row.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, root); id = next; }
    return root;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const phones = new Map();
  const emails = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    const email = normalizedEmail(row.email);
    if (phone.length >= 7) { if (phones.has(phone)) union(row.id, phones.get(phone)); else phones.set(phone, row.id); }
    if (email) { if (emails.has(email)) union(row.id, emails.get(email)); else emails.set(email, row.id); }
  }
  const grouped = new Map();
  for (const row of rows) {
    const root = find(row.id);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(row);
  }
  return [...grouped.values()].filter(group => group.length > 1).map(group => {
    const ranked = [...group].sort((a, b) =>
      Number(b.score || 0) - Number(a.score || 0) ||
      Number(Boolean(b.client_code)) - Number(Boolean(a.client_code)) ||
      new Date(a.created_at || 0) - new Date(b.created_at || 0)
    );
    return { targetId: ranked[0].id, leads: ranked };
  });
}

async function findLeadDuplicateGroups(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT id,name,email,phone,status,score,client_code,created_at
       FROM leads WHERE tenant_id=? AND hidden=0 AND merged_into_lead_id IS NULL
      ORDER BY created_at ASC LIMIT 10000`,
    [tenantId]
  );
  return duplicateGroups(rows);
}

async function listLeadMergeHistory(tenantId, limit = 50, db = pool) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await db.query(
    `SELECT a.id,a.target_lead_id AS targetId,a.source_lead_id AS sourceId,a.actor,
            a.created_at AS createdAt,a.reverted_at AS revertedAt,a.reverted_by AS revertedBy,
            target.name AS targetName,source.name AS sourceName
       FROM lead_merge_audit a
       JOIN leads target ON target.id=a.target_lead_id AND target.tenant_id=a.tenant_id
       JOIN leads source ON source.id=a.source_lead_id AND source.tenant_id=a.tenant_id
      WHERE a.tenant_id=?
      ORDER BY a.created_at DESC LIMIT ?`,
    [tenantId, safeLimit]
  );
  return rows;
}

async function mergeLeads({ tenantId, targetId, sourceIds, actor = null }) {
  const sources = [...new Set((sourceIds || []).map(String))].filter(id => id && id !== String(targetId));
  if (!tenantId || !targetId || !sources.length || sources.length > 100) {
    const error = new Error('targetId and 1-100 sourceIds are required'); error.statusCode = 400; throw error;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = [String(targetId), ...sources];
    const [rows] = await conn.query(
      `SELECT * FROM leads WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')}) FOR UPDATE`,
      [tenantId, ...ids]
    );
    const target = rows.find(row => String(row.id) === String(targetId));
    const sourceRows = rows.filter(row => sources.includes(String(row.id)));
    if (!target || sourceRows.length !== sources.length) {
      const error = new Error('One or more leads do not belong to this tenant'); error.statusCode = 404; throw error;
    }
    const interested = [...new Set([target, ...sourceRows].flatMap(row => {
      try { return JSON.parse(row.interested_course_ids_json || '[]'); } catch { return []; }
    }))];
    const notes = [...new Set([target.notes, ...sourceRows.map(row => row.notes)].filter(Boolean))].join('\n---\n');
    const fallback = (field) => target[field] || sourceRows.find(row => row[field])?.[field] || null;
    await conn.query(
      `UPDATE leads SET name=?,email=?,phone=?,source=?,notes=?,client_code=?,assigned_sales_id=?,assigned_sales_name=?,
         assigned_cs_id=?,assigned_cs_name=?,branch=?,interest_level=?,interested_course_ids_json=?,crm_json=?,
         deal_value=?,score=?,updated_at=NOW()
       WHERE id=? AND tenant_id=?`,
      [fallback('name') || '', fallback('email'), fallback('phone'), fallback('source'), notes || null,
        fallback('client_code'), fallback('assigned_sales_id'), fallback('assigned_sales_name'),
        fallback('assigned_cs_id'), fallback('assigned_cs_name'), fallback('branch'), fallback('interest_level'),
        JSON.stringify(interested), JSON.stringify(mergeJson(target.crm_json, sourceRows)),
        Math.max(...[target, ...sourceRows].map(row => Number(row.deal_value) || 0)),
        Math.max(...[target, ...sourceRows].map(row => Number(row.score) || 0)), targetId, tenantId]
    );
    const relationUpdates = [
      ['communications', 'lead_id'], ['lead_timeline', 'lead_id'], ['automation_log', 'lead_id'],
      ['drip_enrollments', 'lead_id'], ['inbox_conversations', 'linked_lead_id'],
      ['retargeting_log', 'lead_id'], ['subscribers', 'lead_id'], ['support_tickets', 'lead_id'],
      ['tasks', 'related_lead_id'],
    ];
    for (const source of sourceRows) {
      const relations = {};
      for (const [table, column] of relationUpdates) {
        const [related] = await conn.query(
          `SELECT id FROM ${table} WHERE tenant_id=? AND ${column}=? FOR UPDATE`,
          [tenantId, source.id]
        );
        relations[table] = related.map(row => row.id);
        await conn.query(
          `UPDATE ${table} SET ${column}=? WHERE tenant_id=? AND ${column}=?`,
          [targetId, tenantId, source.id]
        );
      }
      await conn.query(
        'UPDATE leads SET hidden=1, merged_into_lead_id=?, updated_at=NOW() WHERE id=? AND tenant_id=?',
        [targetId, source.id, tenantId]
      );
      await conn.query(
        `INSERT INTO lead_merge_audit (id,tenant_id,target_lead_id,source_lead_id,actor,snapshot_json)
         VALUES (?,?,?,?,?,?)`,
        [uuidv4(), tenantId, targetId, source.id, actor, JSON.stringify({ lead: source, relations })]
      );
    }
    await conn.query(
      `INSERT INTO lead_timeline (id,tenant_id,lead_id,event_type,description,meta_json,at)
       VALUES (?,?,?,'merged',?,?,NOW())`,
      [uuidv4(), tenantId, targetId, `Merged ${sourceRows.length} duplicate lead(s)`, JSON.stringify({ sourceIds: sources, actor })]
    );
    await conn.commit();
    return { targetId, merged: sourceRows.length, sourceIds: sources };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

async function unmergeLead({ tenantId, sourceId, actor = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[audit]] = await conn.query(
      `SELECT * FROM lead_merge_audit
       WHERE tenant_id=? AND source_lead_id=? AND reverted_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [tenantId, sourceId]
    );
    if (!audit) {
      const error = new Error('Active merge audit not found'); error.statusCode = 404; throw error;
    }
    const snapshot = tryJson(audit.snapshot_json, {});
    if (!snapshot.relations || !snapshot.lead) {
      const error = new Error('Legacy merge cannot be safely reversed automatically'); error.statusCode = 409; throw error;
    }
    const [[source]] = await conn.query(
      `SELECT id,merged_into_lead_id FROM leads
       WHERE tenant_id=? AND id=? AND hidden=1 LIMIT 1 FOR UPDATE`,
      [tenantId, sourceId]
    );
    if (!source || String(source.merged_into_lead_id) !== String(audit.target_lead_id)) {
      const error = new Error('Merged source lead state is inconsistent'); error.statusCode = 409; throw error;
    }
    const relationColumns = {
      communications: 'lead_id',
      lead_timeline: 'lead_id',
      automation_log: 'lead_id',
      drip_enrollments: 'lead_id',
      inbox_conversations: 'linked_lead_id',
      retargeting_log: 'lead_id',
      subscribers: 'lead_id',
      support_tickets: 'lead_id',
      tasks: 'related_lead_id',
    };
    for (const [table, ids] of Object.entries(snapshot.relations)) {
      const column = relationColumns[table];
      if (!column || !Array.isArray(ids) || !ids.length) continue;
      await conn.query(
        `UPDATE ${table} SET ${column}=?
         WHERE tenant_id=? AND ${column}=? AND id IN (${ids.map(() => '?').join(',')})`,
        [sourceId, tenantId, audit.target_lead_id, ...ids]
      );
    }
    await conn.query(
      'UPDATE leads SET hidden=0,merged_into_lead_id=NULL,updated_at=NOW() WHERE id=? AND tenant_id=?',
      [sourceId, tenantId]
    );
    await conn.query(
      'UPDATE lead_merge_audit SET reverted_at=NOW(),reverted_by=? WHERE id=? AND tenant_id=?',
      [actor, audit.id, tenantId]
    );
    await logLeadEventStrict(
      sourceId, 'merge_reverted', 'Duplicate merge reverted',
      { targetId: audit.target_lead_id, actor }, tenantId, conn
    );
    await conn.commit();
    return { sourceId, targetId: audit.target_lead_id, reverted: true };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

module.exports = {
  duplicateGroups,
  findLeadDuplicateGroups,
  listLeadMergeHistory,
  mergeLeads,
  unmergeLead,
};
