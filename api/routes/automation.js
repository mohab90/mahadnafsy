'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { sendWhatsApp } = require('../lib/whatsapp');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ── Automation Workflows ──────────────────────────────────────────────────────
router.get('/api/admin/automation-workflows', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
       last_triggered_at, trigger_count, created_at
       FROM automation_workflows ORDER BY created_at DESC LIMIT 500`);
    res.json(rows.map(r => ({
      ...r, enabled: !!r.enabled,
      conditions: tryJson(r.conditions, []),
      action_config: tryJson(r.action_config, {}),
    })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/automation-workflows', requireAuth, requireAdmin, async (req, res) => {
  try {
    const w = req.body;
    const id = w.id || uuidv4();
    await pool.query(
      `INSERT INTO automation_workflows (id, name, \`trigger\`, action, enabled, conditions_json, action_config_json, last_triggered_at, trigger_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), enabled=VALUES(enabled),
         conditions_json=VALUES(conditions_json), action_config_json=VALUES(action_config_json),
         last_triggered_at=VALUES(last_triggered_at), trigger_count=VALUES(trigger_count)`,
      [id, w.name||'', w.trigger||'', w.action||'', w.enabled?1:0,
       JSON.stringify(w.conditions||[]), JSON.stringify(w.actionConfig||w.action_config||{}),
       w.lastTriggeredAt||null, w.triggerCount||0, w.createdAt||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/automation-workflows/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM automation_workflows WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Automation Engine: Execute enabled workflows ──────────────────────────────
// POST /api/admin/automation-workflows/run  — runs all enabled workflows against DB
// Returns a summary of matched leads and actions taken
router.post('/api/admin/automation-workflows/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [workflows] = await pool.query(
      `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
       last_triggered_at, trigger_count, created_at
       FROM automation_workflows WHERE enabled = 1 ORDER BY created_at ASC`
    );
    const results = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const wf of workflows) {
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
          WHERE l.hidden = 0
            AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number')
            AND DATEDIFF(NOW(), COALESCE(c.last_date, l.last_follow_up, l.created_at)) >= ?
        `, [days]);
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
          WHERE l.hidden = 0 AND l.status NOT IN ('converted','lost')
          HAVING score >= ?
        `, [threshold]);
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
          WHERE s.status = 'active'
            AND srh.expires_at IS NOT NULL
            AND DATEDIFF(srh.expires_at, NOW()) BETWEEN 0 AND ?
          GROUP BY s.id
        `, [days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'new_lead') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE hidden = 0 AND status = 'new'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'lead_converted') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE hidden = 0 AND status = 'converted'
            AND updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'lead_status_changed') {
        // Match leads that changed status recently (last 24h)
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE hidden = 0
            AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND status NOT IN ('converted','lost')
        `);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscriber_inactive_x_days' || wf.trigger === 'course_progress_stalled') {
        isSubscriberTrigger = true;
        const days = parseInt(actionCfg.days || '30');
        const [rows] = await pool.query(`
          SELECT s.id, s.name, s.email, s.phone,
            MAX(lp.completed_at) AS last_progress
          FROM subscribers s
          LEFT JOIN lecture_progress lp ON lp.subscriber_id = s.id
          WHERE s.status = 'active'
          GROUP BY s.id
          HAVING last_progress IS NULL OR DATEDIFF(NOW(), last_progress) >= ?
        `, [days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'new_subscriber') {
        isSubscriberTrigger = true;
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, course_title
          FROM subscribers
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscriber_course_completed') {
        isSubscriberTrigger = true;
        const sinceHours = parseInt(actionCfg.hours || '24');
        const [rows] = await pool.query(`
          SELECT DISTINCT s.id, s.name, s.phone, s.email, s.course_title
          FROM lecture_progress lp
          INNER JOIN subscribers s ON s.id = lp.subscriber_id
          WHERE lp.completed = 1
            AND lp.completed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        `, [sinceHours]);
        matchedLeads = rows;
      }

      // ── Auto-stage: leads stuck in a stage for X days ──────────────────────
      else if (wf.trigger === 'lead_stuck_in_stage') {
        const days = parseInt(actionCfg.days || '7');
        const fromStatus = actionCfg.from_status || 'new';
        const [rows] = await pool.query(`
          SELECT id, name, email, phone, status, assigned_sales_name
          FROM leads
          WHERE status = ?
            AND updated_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [fromStatus, days]);
        matchedLeads = rows;
      }

      // ── Auto-stage: leads with no follow-up scheduled ─────────────────────
      else if (wf.trigger === 'lead_no_followup') {
        const [rows] = await pool.query(`
          SELECT id, name, email, phone, status, assigned_sales_name
          FROM leads
          WHERE (next_follow_up_date IS NULL OR next_follow_up_date < DATE_SUB(NOW(), INTERVAL 3 DAY))
            AND status NOT IN ('won','lost','unqualified')
        `);
        matchedLeads = rows;
      }

      // ── Quiz passed ────────────────────────────────────────────────────────
      else if (wf.trigger === 'quiz_passed') {
        const [rows] = await pool.query(`
          SELECT DISTINCT l.id, l.name, l.email, l.phone, l.status, l.assigned_sales_name
          FROM leads l
          INNER JOIN quiz_attempts qa ON LOWER(TRIM(qa.subscriber_id)) IN (
            SELECT id FROM subscribers WHERE LOWER(TRIM(email))=LOWER(TRIM(l.email))
          )
          WHERE qa.passed=1 AND qa.taken_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        `, [parseInt(actionCfg.hours || '24')]);
        matchedLeads = rows;
      }

      // ── Consultation triggers ──────────────────────────────────────────────
      else if (wf.trigger === 'new_consultation') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email,
            t.display_name AS therapist_name
          FROM consultations c
          LEFT JOIN therapists t ON t.id = c.therapist_id
          WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_cancelled') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email
          FROM consultations c
          WHERE c.status IN ('cancelled','canceled')
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_confirmed') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email,
            t.display_name AS therapist_name
          FROM consultations c
          LEFT JOIN therapists t ON t.id = c.therapist_id
          WHERE c.status = 'confirmed'
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_completed') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.phone, c.email
          FROM consultations c
          WHERE c.status = 'completed'
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      // ── Payment triggers ───────────────────────────────────────────────────
      else if (wf.trigger === 'new_payment') {
        isSubscriberTrigger = true;
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT DISTINCT s.id, s.name, s.phone, s.email, s.course_title
          FROM payments p
          INNER JOIN subscribers s ON s.id = p.subscriber_id
          WHERE (p.status = 'paid' OR p.status IS NULL)
            AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
        matchedLeads = rows;
      }

      // ── Join request trigger ───────────────────────────────────────────────
      else if (wf.trigger === 'new_join_request') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, position AS course_title
          FROM join_us
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [sinceDays]);
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
          WHERE l.hidden = 0
            AND l.status NOT IN ('converted','lost')
            AND TIMESTAMPDIFF(HOUR, COALESCE(c.last_date, l.created_at), NOW()) >= ?
        `, [hours]);
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
              'UPDATE leads SET next_follow_up_date = ? WHERE id = ? AND (next_follow_up_date IS NULL OR next_follow_up_date < NOW())',
              [newDate.toISOString().slice(0, 10), lead.id]
            );
            actionsRun++;
          }

          else if (step.action === 'update_lead_status' && (cfg.status || actionCfg.status) && lead.id) {
            await pool.query(
              'UPDATE leads SET status = ? WHERE id = ?',
              [cfg.status || actionCfg.status, lead.id]
            );
            actionsRun++;
          }

          else if (step.action === 'auto_move_stage' && (cfg.targetStage || actionCfg.targetStage) && lead.id) {
            await pool.query('UPDATE leads SET status=?, updated_at=NOW() WHERE id=?',
              [cfg.targetStage || actionCfg.targetStage, lead.id]);
            actionsRun++;
          }

          else if (step.action === 'create_task' && lead.id) {
            await pool.query(
              `INSERT INTO tasks (id, title, description, related_lead_id, priority, status, due_date, created_by)
               VALUES (UUID(),?,?,?,?,?,?,?)`,
              [sub(cfg.task_title || actionCfg.task_title || `متابعة: ${lead.name}`),
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
                await sendWhatsApp(cleanPhone, msg);
                actionsRun++;
              }
            } catch (_) { /* best-effort */ }
          }

          else if (step.action === 'assign_staff' && (cfg.staffId || actionCfg.staffId) && lead.id && !isSubscriberTrigger) {
            const staffId = cfg.staffId || actionCfg.staffId;
            const [staffRow] = await pool.query('SELECT name FROM staff WHERE id = ? LIMIT 1', [staffId]);
            const staffName = staffRow[0]?.name || '';
            await pool.query(
              'UPDATE leads SET assigned_sales_id=?, assigned_sales_name=? WHERE id=?',
              [staffId, staffName, lead.id]
            );
            actionsRun++;
          }

          else if (step.action === 'send_notification' && msg) {
            // Store in-app notification (best-effort)
            try {
              await pool.query(
                `INSERT IGNORE INTO notifications (id, subscriber_id, message, type, created_at)
                 VALUES (UUID(), ?, ?, 'automation', NOW())`,
                [lead.id || null, msg]
              );
            } catch (_) { /* table may not exist */ }
            actionsRun++;
          }

          else if (step.action === 'notify_admin') {
            try {
              await pool.query(
                `INSERT IGNORE INTO automation_log (id, workflow_id, lead_id, action, triggered_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [uuidv4(), wf.id, lead.id || null, wf.action]
              );
            } catch (_) { /* table may not exist */ }
            actionsRun++;
          }
        }
      }

      // ── Update workflow stats ─────────────────────────
      if (actionsRun > 0) {
        await pool.query(
          'UPDATE automation_workflows SET trigger_count = trigger_count + ?, last_triggered_at = ? WHERE id = ?',
          [actionsRun, new Date().toISOString(), wf.id]
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
    }

    res.json({ ok: true, ran: results.length, results });
  } catch (e) {
    logger.error('[automation-run]', e.message);
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/automation-workflows/run-single  — test run one workflow
router.post('/api/admin/automation-workflows/run-single/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
       last_triggered_at, trigger_count, created_at
       FROM automation_workflows WHERE id = ?`, [req.params.id]);
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
        WHERE l.hidden = 0 AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number')
          AND DATEDIFF(NOW(), COALESCE(c.last_date, l.last_follow_up, l.created_at)) >= ?
      `, [days]);
      matchedLeads = cnt;
    } else if (wf.trigger === 'new_lead') {
      const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM leads WHERE hidden=0 AND status='new' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [parseInt(actionCfg.days||'1')]);
      matchedLeads = cnt;
    }
    res.json({ ok: true, dryRun: true, workflowId: wf.id, trigger: wf.trigger, action: wf.action, matchedLeads });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Create automation_log table silently (best-effort on startup)
pool.query(`CREATE TABLE IF NOT EXISTS automation_log (
  id VARCHAR(100) PRIMARY KEY,
  workflow_id VARCHAR(100),
  lead_id VARCHAR(100),
  subscriber_id VARCHAR(100),
  action VARCHAR(100),
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_al_wf (workflow_id),
  INDEX idx_al_lead (lead_id)
) CHARACTER SET utf8mb4`).catch(() => {});

module.exports = router;
