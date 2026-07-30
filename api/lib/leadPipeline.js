'use strict';

const { pool } = require('./db');
const { LEAD_STATUSES, normalizeLeadStatus } = require('./leadStatuses');

const labels = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم',
  interested_booking: 'مهتم بالحجز', interested_followup: 'مهتم ومتابعة',
  postpone_month: 'تأجيل أكثر من شهر', no_answer: 'لا يرد',
  no_answer_wa: 'لا يرد / واتس أرسل', no_answer_nowa: 'لا يرد / بدون واتس',
  wrong_number: 'رقم خطأ أو مغلق', with_colleague: 'مع زميل آخر',
  not_interested: 'غير مهتم', not_interested_hidden: 'غير مهتم / مخفي',
  closed: 'مغلق', converted: 'تحول لمشترك', lost: 'مفقود', won: 'تم البيع',
  unqualified: 'غير مؤهل', disqualified: 'مستبعد', archived: 'مؤرشف', other: 'أخرى',
};
const visible = new Set(['new', 'interested_booking', 'interested_followup', 'no_answer_wa', 'no_answer_nowa', 'not_interested']);
const terminal = new Set(['wrong_number', 'not_interested', 'not_interested_hidden', 'closed', 'converted', 'lost', 'won', 'unqualified', 'disqualified', 'archived']);

const DEFAULT_PIPELINE = [...LEAD_STATUSES].map((status, index) => ({
  status,
  label: labels[status] || status,
  position: (index + 1) * 10,
  showInPipeline: visible.has(status),
  isTerminal: terminal.has(status),
  allowedNext: ['*'],
}));

function parseAllowed(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : ['*'];
  } catch { return ['*']; }
}

async function listPipeline(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT status_key,label,position,show_in_pipeline,is_terminal,allowed_next_json
       FROM crm_pipeline_stages WHERE tenant_id=? ORDER BY position,status_key`,
    [tenantId]
  );
  const byStatus = new Map(rows.map(row => [row.status_key, row]));
  return DEFAULT_PIPELINE.map(fallback => {
    const row = byStatus.get(fallback.status);
    return row ? {
      status: row.status_key,
      label: row.label,
      position: Number(row.position),
      showInPipeline: Boolean(row.show_in_pipeline),
      isTerminal: Boolean(row.is_terminal),
      allowedNext: parseAllowed(row.allowed_next_json),
    } : fallback;
  }).sort((a, b) => a.position - b.position);
}

async function validateTransition(tenantId, fromStatus, toStatus, db = pool) {
  const from = normalizeLeadStatus(fromStatus);
  const to = normalizeLeadStatus(toStatus);
  const stages = await listPipeline(tenantId, db);
  const stage = stages.find(item => item.status === from);
  if (stage?.allowedNext.includes('*') || stage?.allowedNext.includes(to)) return true;
  const error = new Error(`Lead transition is not allowed: ${from} -> ${to}`);
  error.statusCode = 409;
  throw error;
}

async function savePipeline(tenantId, stages, db = pool) {
  if (!Array.isArray(stages) || !stages.length) {
    const error = new Error('Pipeline stages are required'); error.statusCode = 400; throw error;
  }
  const normalized = stages.map((stage, index) => {
    const status = normalizeLeadStatus(stage.status);
    const allowed = [...new Set((stage.allowedNext || ['*']).map(value =>
      value === '*' ? '*' : normalizeLeadStatus(value)
    ))];
    return {
      status,
      label: String(stage.label || labels[status] || status).trim().slice(0, 120),
      position: Number.isFinite(Number(stage.position)) ? Number(stage.position) : (index + 1) * 10,
      showInPipeline: Boolean(stage.showInPipeline),
      isTerminal: Boolean(stage.isTerminal),
      allowedNext: allowed.length ? allowed : ['*'],
    };
  });
  if (new Set(normalized.map(stage => stage.status)).size !== normalized.length) {
    const error = new Error('Duplicate pipeline status'); error.statusCode = 400; throw error;
  }
  for (const stage of normalized) {
    await db.query(
      `INSERT INTO crm_pipeline_stages
       (tenant_id,status_key,label,position,show_in_pipeline,is_terminal,allowed_next_json)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE label=VALUES(label),position=VALUES(position),
         show_in_pipeline=VALUES(show_in_pipeline),is_terminal=VALUES(is_terminal),
         allowed_next_json=VALUES(allowed_next_json)`,
      [tenantId, stage.status, stage.label, stage.position, stage.showInPipeline ? 1 : 0,
        stage.isTerminal ? 1 : 0, JSON.stringify(stage.allowedNext)]
    );
  }
  return listPipeline(tenantId, db);
}

module.exports = { DEFAULT_PIPELINE, listPipeline, savePipeline, validateTransition };
