'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { runAutomationWorkflows } = require('../lib/automationEngine');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');

// ── Automation Workflows ──────────────────────────────────────────────────────
router.get('/api/admin/automation-workflows', requireAuth, requireAdmin, requirePermission('manage_automation'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
       last_triggered_at, trigger_count, created_at
       FROM automation_workflows WHERE tenant_id=? ORDER BY created_at DESC LIMIT 500`, [req.tenantId]);
    res.json(rows.map(r => ({
      ...r, enabled: !!r.enabled,
      conditions: tryJson(r.conditions, []),
      action_config: tryJson(r.action_config, {}),
    })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/automation-workflows', requireAuth, requireAdmin, requirePermission('manage_automation'), async (req, res) => {
  try {
    const w = req.body;
    const id = w.id || uuidv4();
    const [[foreign]] = await pool.query('SELECT id FROM automation_workflows WHERE id=? AND tenant_id<>? LIMIT 1', [id, req.tenantId]);
    if (foreign) return res.status(409).json({ error: 'Workflow id is unavailable' });
    const [[existing]] = await pool.query('SELECT id FROM automation_workflows WHERE id=? AND tenant_id=? LIMIT 1', [id, req.tenantId]);
    const values = [String(w.name||'').slice(0, 200), String(w.trigger||'').slice(0, 100), String(w.action||'').slice(0, 100), w.enabled?1:0,
      JSON.stringify(w.conditions||[]), JSON.stringify(w.actionConfig||w.action_config||{}), w.lastTriggeredAt||null, Number(w.triggerCount)||0];
    if (existing) {
      await pool.query(
        `UPDATE automation_workflows SET name=?, \`trigger\`=?, action=?, enabled=?, conditions_json=?, action_config_json=?, last_triggered_at=?, trigger_count=?
         WHERE id=? AND tenant_id=?`, [...values, id, req.tenantId]
      );
    } else {
      await pool.query(
        `INSERT INTO automation_workflows (id, tenant_id, name, \`trigger\`, action, enabled, conditions_json, action_config_json, last_triggered_at, trigger_count, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, req.tenantId, ...values, w.createdAt||new Date().toISOString()]
      );
    }
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/automation-workflows/:id', requireAuth, requireAdmin, requirePermission('manage_automation'), async (req, res) => {
  try { const [result] = await pool.query('DELETE FROM automation_workflows WHERE id = ? AND tenant_id=?', [req.params.id, req.tenantId]); if (!result.affectedRows) return res.status(404).json({ error: 'Workflow not found' }); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Automation Engine: Execute enabled workflows ──────────────────────────────
// POST /api/admin/automation-workflows/run  — the manual "تشغيل الآن" button.
// Delegates to lib/automationEngine.js — the SAME code the daily cron
// (lib/serverCronJobs.js) calls, scoped to just this admin's tenant (MKT-04).
router.post('/api/admin/automation-workflows/run', requireAuth, requireAdmin, requirePermission('manage_automation'), async (req, res) => {
  try {
    const results = await runAutomationWorkflows({ tenantId: req.tenantId, actor: req.user?.email || 'automation' });
    res.json({ ok: true, ran: results.length, results });
  } catch (e) {
    logger.error('[automation-run]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/automation-workflows/run-single  — test run one workflow
router.post('/api/admin/automation-workflows/run-single/:id', requireAuth, requireAdmin, requirePermission('manage_automation'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
       last_triggered_at, trigger_count, created_at
       FROM automation_workflows WHERE id = ? AND tenant_id=?`, [req.params.id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: 'workflow not found' });
    // Delegate to run logic by temporarily enabling
    const wf = rows[0];
    // Return match count only (dry run)
    let matchedLeads = 0;
    const actionCfg = tryJson(wf.action_config, {});
    if (wf.trigger === 'no_contact_x_days') {
      const days = parseInt(actionCfg.days || '7');
      const [[{ cnt }]] = await pool.query(`
        SELECT COUNT(*) AS cnt FROM leads l
        LEFT JOIN (SELECT lead_id, MAX(date) AS last_date FROM communications GROUP BY lead_id) c ON c.lead_id = l.id
        WHERE l.tenant_id=? AND l.hidden = 0 AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number')
          AND DATEDIFF(NOW(), COALESCE(c.last_date, l.last_follow_up, l.created_at)) >= ?
      `, [req.tenantId, days]);
      matchedLeads = cnt;
    } else if (wf.trigger === 'new_lead') {
      const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM leads WHERE tenant_id=? AND hidden=0 AND status='new' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [req.tenantId, parseInt(actionCfg.days||'1')]);
      matchedLeads = cnt;
    }
    res.json({ ok: true, dryRun: true, workflowId: wf.id, trigger: wf.trigger, action: wf.action, matchedLeads });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
