'use strict';
/**
 * Shared automation-workflow execution engine (MKT-04).
 *
 * Before this, the exact same "match a trigger, run its action steps" logic
 * was independently implemented twice: routes/automation.js's manual
 * POST /run button (20 triggers, 9 actions, multi-step JSON support), and
 * server.js's daily automatic run (5 triggers, 4 actions,
 * single-action only, hand-copied and already drifted — e.g. its
 * add_followup_reminder writes lead_timeline directly instead of going
 * through logLeadEvent()). A fix applied to one silently never reached the
 * other. This module is the one engine both callers now use.
 */
const { pool } = require('./db');
const { tryJson } = require('./helpers');
const { sendWhatsApp } = require('./whatsapp');
const { logLeadEvent } = require('./crm');
const { transitionLead } = require('./leadState');
const { assignLead } = require('./leadAssignment');
const { appendLeadInteraction } = require('./leadInteractions');
const { uuidv4 } = require('./id');
const logger = require('./logger');

// tenantId: scope to one tenant (the manual "run now" button, an admin's own
// session) or omit/pass null to run across every tenant with enabled
// workflows (the daily cron). actor is attached to lead-history entries so
// they're distinguishable from a human action.
async function runAutomationWorkflows({ tenantId = null, actor = 'automation' } = {}) {
  const params = [];
  let where = 'enabled = 1';
  if (tenantId) { where += ' AND tenant_id=?'; params.push(tenantId); }
  const [workflows] = await pool.query(
    `SELECT id, tenant_id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
     last_triggered_at, trigger_count, created_at
     FROM automation_workflows WHERE ${where} ORDER BY created_at ASC`, params
  );
  const results = [];

  for (const wf of workflows) {
    // Per-workflow guard: a single broken trigger (e.g. a stale table/column ref)
    // must NOT abort the whole automation run and silently kill every other workflow.
    try {
      const tid = wf.tenant_id;
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
            SELECT lead_id, MAX(date) AS last_date FROM communications WHERE tenant_id=? GROUP BY lead_id
          ) c ON c.lead_id = l.id
          WHERE l.tenant_id=? AND l.hidden = 0
            AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number')
            AND DATEDIFF(NOW(), COALESCE(c.last_date, l.last_follow_up, l.created_at)) >= ?
        `, [tid, tid, days]);
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
        `, [tid, threshold]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscription_expiring_soon') {
        isSubscriberTrigger = true;
        const days = parseInt(actionCfg.days || '7');
        // Rewritten onto the tables that exist.
        //
        // This asked subscriber_role_history for expires_at, and subscribers
        // for status and course_title. There is no such table, and neither
        // column exists — not in the schema and not in any migration. The query
        // threw 1054 on every run, the per-workflow catch swallowed it, and the
        // workflow went on showing "enabled" in the admin with a trigger count
        // that never moved. Access expiry lives on enrollments.expiry_date, the
        // course name on courses.title, and a live customer is is_active=1.
        const [rows] = await pool.query(`
          SELECT s.id, s.name, s.email, s.phone,
            MIN(c.title) AS course_title,
            MIN(e.expiry_date) AS expires_at
          FROM subscribers s
          JOIN enrollments e ON e.subscriber_id = s.id AND e.tenant_id = s.tenant_id
            AND e.status = 'active'
          LEFT JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id
          WHERE s.tenant_id=? AND s.is_active = 1 AND s.deleted_at IS NULL
            AND e.expiry_date IS NOT NULL
            AND DATEDIFF(e.expiry_date, NOW()) BETWEEN 0 AND ?
          GROUP BY s.id, s.name, s.email, s.phone
        `, [tid, days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'new_lead') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND hidden = 0 AND status = 'new'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'lead_converted') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND hidden = 0 AND status = 'converted'
            AND updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
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
        `, [tid]);
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
          WHERE s.tenant_id=? AND s.is_active = 1 AND s.deleted_at IS NULL
          GROUP BY s.id, s.name, s.email, s.phone
          HAVING last_progress IS NULL OR DATEDIFF(NOW(), last_progress) >= ?
        `, [tid, days]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'new_subscriber') {
        isSubscriberTrigger = true;
        const sinceDays = parseInt(actionCfg.days || '1');
        // subscribers has no course_title. The course a new customer joined on
        // comes through their enrolment; a customer with none simply has NULL
        // here rather than failing the whole query, which is what the LEFT JOINs
        // are for. This is the trigger the admin's "new workflow" button
        // defaults to, so every workflow ever created from that default has
        // been inert since the day it was saved.
        const [rows] = await pool.query(`
          SELECT s.id, s.name, s.phone, s.email, MIN(c.title) AS course_title
          FROM subscribers s
          LEFT JOIN enrollments e ON e.subscriber_id = s.id AND e.tenant_id = s.tenant_id
            AND e.status = 'active'
          LEFT JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id
          WHERE s.tenant_id=? AND s.deleted_at IS NULL
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          GROUP BY s.id, s.name, s.phone, s.email
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'subscriber_course_completed') {
        isSubscriberTrigger = true;
        const sinceHours = parseInt(actionCfg.hours || '24');
        // The completion row already names the course, so this one does not
        // need the enrolment at all — it was reaching for a subscribers column
        // that has never existed.
        const [rows] = await pool.query(`
          SELECT DISTINCT s.id, s.name, s.phone, s.email, c.title AS course_title
          FROM course_completions lp
          INNER JOIN subscribers s ON s.id = lp.subscriber_id AND s.tenant_id = lp.tenant_id
          LEFT JOIN courses c ON c.id = lp.course_id AND c.tenant_id = lp.tenant_id
          WHERE lp.tenant_id=? AND s.deleted_at IS NULL
            AND lp.completed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        `, [tid, sinceHours]);
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
        `, [tid, fromStatus, days]);
        matchedLeads = rows;
      }

      // ── Auto-stage: leads with no follow-up scheduled ─────────────────────
      else if (wf.trigger === 'lead_no_followup') {
        const [rows] = await pool.query(`
          SELECT id, name, email, phone, status, assigned_sales_name
          FROM leads
          WHERE tenant_id=? AND (next_follow_up_date IS NULL OR next_follow_up_date < DATE_SUB(NOW(), INTERVAL 3 DAY))
            AND status NOT IN ('won','lost','unqualified')
        `, [tid]);
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
        `, [tid, tid, parseInt(actionCfg.hours || '24')]);
        matchedLeads = rows;
      }

      // ── Consultation triggers ──────────────────────────────────────────────
      else if (wf.trigger === 'new_consultation') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.client_phone AS phone, c.client_email AS email,
            t.name AS therapist_name
          FROM consultations c
          LEFT JOIN therapists t ON t.id = c.therapist_id AND t.tenant_id=c.tenant_id
          WHERE c.tenant_id=? AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_cancelled') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.client_phone AS phone, c.client_email AS email
          FROM consultations c
          WHERE c.tenant_id=? AND c.status IN ('cancelled','canceled')
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_confirmed') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.client_phone AS phone, c.client_email AS email,
            t.name AS therapist_name
          FROM consultations c
          LEFT JOIN therapists t ON t.id = c.therapist_id AND t.tenant_id=c.tenant_id
          WHERE c.tenant_id=? AND c.status = 'confirmed'
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      else if (wf.trigger === 'consultation_completed') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT c.id, c.client_name AS name, c.client_phone AS phone, c.client_email AS email
          FROM consultations c
          WHERE c.tenant_id=? AND c.status = 'completed'
            AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      // ── Payment triggers ───────────────────────────────────────────────────
      else if (wf.trigger === 'new_payment') {
        isSubscriberTrigger = true;
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT DISTINCT s.id, s.name, s.phone, s.email,
            COALESCE(p.item_title, c.title) AS course_title
          FROM payments p
          INNER JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
          LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
          WHERE p.tenant_id=? AND (p.status = 'paid' OR p.status IS NULL)
            AND p.deleted_at IS NULL AND s.deleted_at IS NULL
            AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      // ── Join request trigger ───────────────────────────────────────────────
      else if (wf.trigger === 'new_join_request') {
        const sinceDays = parseInt(actionCfg.days || '1');
        const [rows] = await pool.query(`
          SELECT id, name, phone, email, specialty AS course_title
          FROM join_us_applications
          WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [tid, sinceDays]);
        matchedLeads = rows;
      }

      // ── Conversation idle ──────────────────────────────────────────────────
      else if (wf.trigger === 'conversation_idle_x_hours') {
        const hours = parseInt(actionCfg.days || actionCfg.hours || '4');
        const [rows] = await pool.query(`
          SELECT l.id, l.name, l.phone, l.email, l.status, l.assigned_sales_name
          FROM leads l
          LEFT JOIN (
            SELECT lead_id, MAX(date) AS last_date FROM communications WHERE tenant_id=? GROUP BY lead_id
          ) c ON c.lead_id = l.id
          WHERE l.tenant_id=? AND l.hidden = 0
            AND l.status NOT IN ('converted','lost')
            AND TIMESTAMPDIFF(HOUR, COALESCE(c.last_date, l.created_at), NOW()) >= ?
        `, [tid, tid, hours]);
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
              [newDate.toISOString().slice(0, 10), lead.id, tid]
            );
            await logLeadEvent(lead.id, 'followup_set', `Automation scheduled follow-up for ${newDate.toISOString().slice(0, 10)}`, { workflowId: wf.id, automation: true }, tid);
            actionsRun++;
          }

          else if (step.action === 'update_lead_status' && (cfg.status || actionCfg.status) && lead.id) {
            const nextStatus = cfg.status || actionCfg.status;
            await transitionLead({
              tenantId: tid, leadId: lead.id, toStatus: nextStatus,
              actor, reason: `Automation changed status to ${nextStatus}`,
              metadata: { workflowId: wf.id, automation: true },
            });
            actionsRun++;
          }

          else if (step.action === 'auto_move_stage' && (cfg.targetStage || actionCfg.targetStage) && lead.id) {
            const nextStatus = cfg.targetStage || actionCfg.targetStage;
            await transitionLead({
              tenantId: tid, leadId: lead.id, toStatus: nextStatus,
              actor, reason: `Automation moved stage to ${nextStatus}`,
              metadata: { workflowId: wf.id, automation: true },
            });
            actionsRun++;
          }

          else if (step.action === 'create_task' && lead.id) {
            await pool.query(
              `INSERT INTO tasks (id, tenant_id, title, description, related_lead_id, priority, status, due_date, created_by)
               VALUES (UUID(),?,?,?,?,?,?,?,?)`,
              [tid, sub(cfg.task_title || actionCfg.task_title || `متابعة: ${lead.name}`),
               msg || null, lead.id,
               cfg.priority || actionCfg.priority || 'medium', 'todo',
               (() => { const d = new Date(); d.setDate(d.getDate() + parseInt(cfg.due_days || actionCfg.due_days || '2')); return d.toISOString().slice(0, 10); })(),
               'automation']
            );
            actionsRun++;
          }

          else if (step.action === 'add_note' && msg && lead.id) {
            await appendLeadInteraction({
              tenantId: tid,
              leadId: lead.id,
              interaction: { type: 'note', notes: `[أتوميشن: ${wf.name}] ${msg}`, outcome: 'auto' },
              actor: { name: actor, automation: true, workflowId: wf.id },
            });
            actionsRun++;
          }

          else if (step.action === 'send_whatsapp' && msg && lead.phone) {
            try {
              const cleanPhone = String(lead.phone).replace(/\D/g, '');
              if (cleanPhone.length >= 10) {
                await sendWhatsApp(cleanPhone, msg, { tenantId: tid, category: 'automation' });
                actionsRun++;
              }
            } catch (_) { /* best-effort */ }
          }

          else if (step.action === 'assign_staff' && (cfg.staffId || actionCfg.staffId) && lead.id && !isSubscriberTrigger) {
            const staffId = cfg.staffId || actionCfg.staffId;
            const assignment = await assignLead({
              tenantId: tid, leadId: lead.id, salesId: staffId,
              actor, reason: `Automation assigned lead to ${staffId}`,
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
                [tid, lead.id || null, msg]
              );
            } catch (_) { /* table may not exist */ }
            actionsRun++;
          }

          else if (step.action === 'notify_admin') {
            try {
              await pool.query(
                `INSERT IGNORE INTO automation_log (id, tenant_id, workflow_id, lead_id, action, triggered_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [uuidv4(), tid, wf.id, lead.id || null, wf.action]
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
          [actionsRun, new Date().toISOString(), wf.id, tid]
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

  return results;
}

module.exports = { runAutomationWorkflows };
