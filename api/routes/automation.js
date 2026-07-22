'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { sendWhatsApp } = require('../lib/whatsapp');
const { logLeadEvent } = require('../lib/crm');
const { transitionLead } = require('../lib/leadState');
const { assignLead } = require('../lib/leadAssignment');
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
// POST /api/admin/automation-workflows/run  — runs all enabled workflows against DB
// Returns a summary of matched leads and actions taken
router.post('/api/admin/automation-workflows/run', requireAuth, requireAdmin, requirePermission('manage_automation'), async (req, res) => {
  try {
    const [workflows] = await pool.query(
      `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
       last_triggered_at, trigger_count, created_at
       FROM automation_workflows WHERE tenant_id=? AND enabled = 1 ORDER BY created_at ASC`,
      [req.tenantId]
    );
    const results = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const wf of workflows) {
     // Per-workflow guard: a single broken trigger (e.g. a stale table/column ref)
     // must NOT abort the whole automation run and silently kill every other workflow.
     try {
      const actionCfg = tryJson(wf.action_config, {});
      let matchedLeads = [];
      // leads/subscribers share the same shape; subscribers get a flag for WA routing
      let isSubscriberTrigger = false;

      // ── Trigger matching ─────────────────────────────
      if (wf.trigger === 'no_contact_x_days') {
        const days = parseInt(actionCfg.days || '7');
        const [rows] = await pool.query(`
          SELECT l.id, l.name, l.phone, l.email, l.status, l.assigned_sales_name
          FROM leads l
          LEFT JOIN (
            SELECT lead_id, MAX(date) AS last_date FROM communications GROUP BY lead_id
          ) c ON c.lead_id = l.id
          WHERE l.tenant_id=? AND l.hidden = 0
            AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number')
            AND DATEDIFF(NOW(), COALESCE(c.last_date, l.last_follow_up, l.created_at)) >= ?
        `, [req.tenantId, days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'lead_score_threshold') {
        const threshold = parseInt(actionCfg.scoreThreshold || '70');
        const [rows] = await pool.query(`
          SELECT l.id, l.name, l.phone, l.email, l.status, l.interest_level,
            l.assigned_sales_name,
            (CASE l.status
              WHEN 'interested_booking' THEN 100 WHEN 'interested_followup' THEN 80
              WHEN 'interested' THEN 60 WHEN 'contacted' THEN 40
              WHEN 'new' THEN 20 ELSE 10 END
            + CASE l.interest_level WHEN 'high' THEN 30 WHEN 'medium' THEN 15 ELSE 5 END
            ) AS score
          FROM leads l
          WHERE l.tenant_id=? AND l.hidden = 0 AND l.status NOT IN ('converted','lost')
          HAVING score >= ?
        `, [req.tenantId, threshold]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscription_expiring_soon') {
        isSubscriberTrigger = true;
        const days = parseInt(actionCfg.days || '7');
        const [rows] = await pool.query(`
          SELECT s.id, s.name, s.email, s.phone, s.course_title,
            srh.expires_at
          FROM subscribers s
          LEFT JOIN subscriber_role_history srh ON srh.subscriber_id = s.id
          WHERE s.tenant_id=? AND s.status = 'active'
            AND srh.expires_at IS NOT NULL
            AND DATEDIFF(srh.expires_at, NOW()) BETWEEN 0 AND ?
          GROUP BY s.id
        `, [req.tenantId, days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'new_lead') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND hidden = 0 AND status = 'new'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'lead_converted') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND hidden = 0 AND status = 'converted'
            AND updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'lead_status_changed') {
        // Match leads that changed status recently (last 24h)
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND hidden = 0
            AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND status NOT IN ('converted','lost')
        `, [req.tenantId]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscriber_inactive_x_days' || wf.trigger === 'course_progress_stalled') {
        isSubscriberTrigger = true;
        const days = parseInt(actionCfg.days || '30');
        const [rows] = await pool.query(`
          SELECT s.id, s.name, s.email, s.phone,
            MAX(lp.completed_at) AS last_progress
          FROM subscribers s
          LEFT JOIN lecture_completions lp ON lp.subscriber_id = s.id AND lp.tenant_id = s.tenant_id
          WHERE s.tenant_id=? AND s.status = 'active'
          GROUP BY s.id
          HAVING last_progress IS NULL OR DATEDIFF(NOW(), last_progress) >= ?
        `, [req.tenantId, days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'new_subscriber') {
        isSubscriberTrigger = true;
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, course_title
          FROM subscribers
          WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscriber_course_completed') {
        isSubscriberTrigger = true;
        const sinceHours = parseInt(actionCfg.hours || '24');
        const [rows] = await pool.query(`
          SELECT DISTINCT s.id, s.name, s.phone, s.email, s.course_title
          FROM course_completions lp
          INNER JOIN subscribers s ON s.id = lp.subscriber_id AND s.tenant_id = lp.tenant_id
          WHERE lp.tenant_id=?
            AND lp.completed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        `, [req.tenantId, sinceHours]);
        matchedLeads = rows;
      }

      // ── Auto-stage: leads stuck in a stage for X days ──────────────────────
      else if (wf.trigger === 'lead_stuck_in_stage') {
        const days = parseInt(actionCfg.days || '7');
        const fromStatus = actionCfg.from_status || 'new';
        const [rows] = await pool.query(`
          SELECT id, name, email, phone, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND status = ?
            AND updated_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, fromStatus, days]);
        matchedLeads = rows;
      }

      // ── Auto-stage: leads with no follow-up scheduled ─────────────────────
      else if (wf.trigger === 'lead_no_followup') {
        const [rows] = await pool.query(`
          SELECT id, name, email, phone, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND (next_follow_up_date IS NULL OR next_follow_up_date < DATE_SUB(NOW(), INTERVAL 3 DAY))
            AND status NOT IN ('won','lost','unqualified')
        `, [req.tenantId]);
        matchedLeads = rows;
      }

      // ── Quiz passed ────────────────────────────────────────────────────────
      else if (wf.trigger === 'quiz_passed') {
        const [rows] = await pool.query(`
          SELECT DISTINCT l.id, l.name, l.email, l.phone, l.status, l.assigned_sales_name
          FROM leads l
          INNER JOIN quiz_attempts qa ON LOWER(TRIM(qa.subscriber_id)) IN (
            SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=LOWER(TRIM(l.email))
          )
          WHERE l.tenant_id=? AND qa.passed=1 AND qa.taken_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        `, [req.tenantId, req.tenantId, parseInt(actionCfg.hours || '24')]);
        matchedLeads = rows;
      }

      // ── Consultation triggers ──────────────────────────────────────────────
      else if (wf.trigger === 'new_consultation') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email,
            t.display_name AS therapist_name
          FROM consultations c
          LEFT JOIN therapists t ON t.id = c.therapist_id AND t.tenant_id=c.tenant_id
          WHERE c.tenant_id=? AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_cancelled') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email
          FROM consultations c
          WHERE c.tenant_id=? AND c.status IN ('cancelled','canceled')
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_confirmed') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email,
            t.display_name AS therapist_name
          FROM consultations c
          LEFT JOIN therapists t ON t.id = c.therapist_id AND t.tenant_id=c.tenant_id
          WHERE c.tenant_id=? AND c.status = 'confirmed'
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_completed') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email
          FROM consultations c
          WHERE c.tenant_id=? AND c.status = 'completed'
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      // ── Payment triggers ───────────────────────────────────────────────────
      else if (wf.trigger === 'new_payment') {
        isSubscriberTrigger = true;
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT DISTINCT s.id, s.name, s.phone, s.email, s.course_title
          FROM payments p
          INNER JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
          WHERE p.tenant_id=? AND (p.status = 'paid' OR p.status IS NULL)
            AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      // ── Join request trigger ───────────────────────────────────────────────
      else if (wf.trigger === 'new_join_request') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, specialty AS course_title
          FROM join_us_applications
          WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [req.tenantId, sinceDays]);
        matchedLeads = rows;
      }

      // ── Conversation idle ──────────────────────────────────────────────────
      else if (wf.trigger === 'conversation_idle_x_hours') {
        const hours = parseInt(actionCfg.days || actionCfg.hours || '4');
        const [rows] = await pool.query(`
          SELECT l.id, l.name, l.phone, l.email, l.status, l.assigned_sales_name
          FROM leads l
          LEFT JOIN (
            SELECT lead_id, MAX(date) AS last_date FROM communications GROUP BY lead_id
          ) c ON c.lead_id = l.id
          WHERE l.tenant_id=? AND l.hidden = 0
            AND l.status NOT IN ('converted','lost')
            AND TIMESTAMPDIFF(HOUR, COALESCE(c.last_date, l.created_at), NOW()) >= ?
        `, [req.tenantId, hours]);
        matchedLeads = rows;
      }

      // ── Action execution ─────────────────────────────
      // Parse multi-step workflow from stored JSON; fall back to single action
      let steps = [];
      try { steps = JSON.parse(actionCfg.steps || '[]'); } catch (_) {}
      if (!steps.length) steps = [{ id: 's0', type: 'action', action: wf.action, config: actionCfg }];
      const actionSteps = steps.filter(s => s.type === 'action');

      let actionsRun = 0;
      for (const lead of matchedLeads) {
        const vars = {
          name:    lead.name || '',
          phone:   lead.phone || '',
          email:   lead.email || '',
          course:  lead.course_title || lead.therapist_name || '',
          sales:   lead.assigned_sales_name || '',
        };
        const sub = (tpl) => (tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || '');

        for (const step of actionSteps) {
          const cfg = step.config || {};
          const msg = sub(cfg.message || '');

          if (step.action === 'add_followup_reminder' && lead.id) {
            const newDate = new Date();
            newDate.setDate(newDate.getDate() + parseInt(cfg.days || actionCfg.days || '3'));
            await pool.query(
              'UPDATE leads SET next_follow_up_date = ? WHERE id = ? AND tenant_id=? AND (next_follow_up_date IS NULL OR next_follow_up_date < NOW())',
              [newDate.toISOString().slice(0, 10), lead.id, req.tenantId]
            );
            await logLeadEvent(lead.id, 'followup_set', `Automation scheduled follow-up for ${newDate.toISOString().slice(0, 10)}`, { workflowId: wf.id, automation: true }, req.tenantId);
            actionsRun++;
          }

          else if (step.action === 'update_lead_status' && (cfg.status || actionCfg.status) && lead.id) {
            const nextStatus = cfg.status || actionCfg.status;
            await transitionLead({
              tenantId: req.tenantId, leadId: lead.id, toStatus: nextStatus,
              actor: 'automation', reason: `Automation changed status to ${nextStatus}`,
              metadata: { workflowId: wf.id, automation: true },
            });
            actionsRun++;
          }

          else if (step.action === 'auto_move_stage' && (cfg.targetStage || actionCfg.targetStage) && lead.id) {
            const nextStatus = cfg.targetStage || actionCfg.targetStage;
            await transitionLead({
              tenantId: req.tenantId, leadId: lead.id, toStatus: nextStatus,
              actor: 'automation', reason: `Automation moved stage to ${nextStatus}`,
              metadata: { workflowId: wf.id, automation: true },
            });
            actionsRun++;
          }

          else if (step.action === 'create_task' && lead.id) {
            await pool.query(
              `INSERT INTO tasks (id, tenant_id, title, description, related_lead_id, priority, status, due_date, created_by)
               VALUES (UUID(),?,?,?,?,?,?,?,?)`,
              [req.tenantId, sub(cfg.task_title || actionCfg.task_title || `متابعة: ${lead.name}`),
               msg || null, lead.id,
               cfg.priority || actionCfg.priority || 'medium', 'todo',
               (() => { const d = new Date(); d.setDate(d.getDate() + parseInt(cfg.due_days || actionCfg.due_days || '2')); return d.toISOString().slice(0,10); })(),
               'automation']
            );
            actionsRun++;
          }

          else if (step.action === 'add_note' && msg && lead.id) {
            const noteId = `auto-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
            await pool.query(
              `INSERT IGNORE INTO communications (id, lead_id, type, date, notes, outcome)
               VALUES (?, ?, 'note', ?, ?, 'auto')`,
              [noteId, lead.id, todayStr, `[أتوميشن: ${wf.name}] ${msg}`]
            );
            actionsRun++;
          }

          else if (step.action === 'send_whatsapp' && msg && lead.phone) {
            try {
              const cleanPhone = String(lead.phone).replace(/\D/g, '');
              if (cleanPhone.length >= 10) {
                await sendWhatsApp(cleanPhone, msg, { tenantId: req.tenantId });
                actionsRun++;
              }
            } catch (_) { /* best-effort */ }
          }

          else if (step.action === 'assign_staff' && (cfg.staffId || actionCfg.staffId) && lead.id && !isSubscriberTrigger) {
            const staffId = cfg.staffId || actionCfg.staffId;
            const assignment = await assignLead({
              tenantId: req.tenantId, leadId: lead.id, salesId: staffId,
              actor: req.user?.email || 'automation', reason: `Automation assigned lead to ${staffId}`,
              metadata: { workflowId: wf.id, automation: true },
            });
            if (!assignment.changed) continue;
            actionsRun++;
          }

          else if (step.action === 'send_notification' && msg) {
            // Store in-app notification (best-effort)
            try {
              await pool.query(
                `INSERT IGNORE INTO notifications (id, tenant_id, subscriber_id, message, type, created_at)
                 VALUES (UUID(), ?, ?, ?, 'automation', NOW())`,
                [req.tenantId, lead.id || null, msg]
              );
            } catch (_) { /* table may not exist */ }
            actionsRun++;
          }

          else if (step.action === 'notify_admin') {
            try {
              await pool.query(
                `INSERT IGNORE INTO automation_log (id, tenant_id, workflow_id, lead_id, action, triggered_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [uuidv4(), req.tenantId, wf.id, lead.id || null, wf.action]
              );
            } catch (_) { /* table may not exist */ }
            actionsRun++;
          }
        }
      }

      // ── Update workflow stats ─────────────────────────
      if (actionsRun > 0) {
        await pool.query(
          'UPDATE automation_workflows SET trigger_count = trigger_count + ?, last_triggered_at = ? WHERE id = ? AND tenant_id=?',
          [actionsRun, new Date().toISOString(), wf.id, req.tenantId]
        );
      }

      results.push({
        workflowId: wf.id,
        name: wf.name,
        trigger: wf.trigger,
        action: wf.action,
        matchedLeads: matchedLeads.length,
        actionsRun,
      });
     } catch (wfErr) {
        logger.warn('[automation-run] workflow skipped', { id: wf.id, name: wf.name, err: wfErr.message });
        results.push({ workflowId: wf.id, name: wf.name, trigger: wf.trigger, action: wf.action, error: wfErr.message });
     }
    }

    res.json({ ok: true, ran: results.length, results });
  } catch (e) {
    logger.error('[automation-run]', e.message);
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
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
