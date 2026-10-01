'use strict';

// «ليدز من غير سيلز». A lead that arrives after every rep has reached the cap
// the owner set («التوزيع») is left unassigned — rightly — and nothing came
// back for it: 54 in the week to 1 Oct, 1,824 «new» ones in all. Every hour of
// the working day, the room left under those same caps goes to the newest
// waiting leads of the last week, by the same rules as a lead arriving
// (lib/leadAssignment.js createBatchAssigner): never past a cap, never to a rep
// switched off, never against a rep's course or source rules.

const { pool } = require('./db');
const logger = require('./logger').child({ lib: 'lead-backlog' });
const { assignLead, createBatchAssigner } = require('./leadAssignment');
const { normalizeBranch } = require('./branches');
const { cairoClock } = require('./dates');

const WINDOW_DAYS = 7;

async function assignLeadBacklog(tenantId) {
  const [leads] = await pool.query(
    `SELECT id, branch, source, interested_course_ids_json, crm_json FROM leads
      WHERE tenant_id=? AND deleted_at IS NULL AND hidden=0 AND status='new' AND assigned_sales_id IS NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY created_at DESC LIMIT 300`, [tenantId, WINDOW_DAYS]);
  const byBranch = new Map();
  for (const lead of leads) {
    const branch = normalizeBranch(lead.branch, 'ONLINE_EGYPT');
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(lead);
  }
  let assigned = 0;
  for (const [branch, waiting] of byBranch) {
    const assigner = await createBatchAssigner(tenantId, pool, { branch });
    for (const lead of waiting) {
      if (assigner.exhausted()) break;
      const rep = assigner.next(lead);
      if (!rep) continue;
      try {
        const result = await assignLead({
          tenantId, leadId: lead.id, salesId: rep.id, actor: 'التوزيع التلقائي',
          reason: 'ليد كان مستني — اتوزع من المتبقي من حد اليوم',
        });
        if (result.changed) assigned++;
      } catch (error) {
        logger.warn('backlog assignment failed', { leadId: lead.id, err: error.message });
      }
    }
    await assigner.flush();
  }
  if (assigned) logger.info('assigned waiting leads', { tenantId, assigned, waiting: leads.length });
  return { waiting: leads.length, assigned };
}

/** The scheduler's hourly tick: working hours only, every tenant with waiting leads. */
async function runLeadBacklog(now = new Date()) {
  const hour = Math.floor(cairoClock(now).minutes / 60);
  if (!(hour >= 9 && hour < 21)) return;
  const [tenants] = await pool.query(
    `SELECT DISTINCT tenant_id FROM leads
      WHERE deleted_at IS NULL AND status='new' AND assigned_sales_id IS NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [WINDOW_DAYS]);
  for (const { tenant_id: tenantId } of tenants) {
    await assignLeadBacklog(tenantId).catch(error => logger.warn('backlog run failed', { tenantId, err: error.message }));
  }
}

module.exports = { assignLeadBacklog, runLeadBacklog };
