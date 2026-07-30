'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ module: 'crm-sequences-route' });
const { tryJson } = require('../lib/helpers');
const { leadScope } = require('../lib/leadAccess');
const { logLeadEventStrict } = require('../lib/crm');
const {
  normalizeSequenceSteps,
  assertTimezone,
  assertEmail,
} = require('../lib/crmSequences');
const {
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
} = require('../middleware/auth');

const router = express.Router();
const view = [requireAuth, requireAdminOrStaff, requirePermission('view_leads')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_leads')];
const actor = req => req.staffRecord?.id || req.user?.email || req.user?.uid || 'system';
const fail = (res, error, fallback) => {
  logger.error(fallback, error);
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
};

router.get('/api/admin/crm/sequences', ...view, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ds.id,ds.name,ds.description,ds.trigger_status,ds.is_active,ds.steps,
              ds.version,ds.timezone,ds.exit_on_reply,ds.created_at,ds.updated_at,
              COUNT(de.id) AS enrolled_count,
              SUM(de.status='active') AS active_count,
              SUM(de.status='paused') AS paused_count,
              SUM(de.status='completed') AS completed_count,
              SUM(de.status='failed') AS failed_count
         FROM drip_sequences ds
         LEFT JOIN drip_enrollments de
           ON de.sequence_id=ds.id AND de.tenant_id=ds.tenant_id
        WHERE ds.tenant_id=? AND ds.archived_at IS NULL
        GROUP BY ds.id
        ORDER BY ds.updated_at DESC,ds.created_at DESC`,
      [req.tenantId]
    );
    res.json(rows.map(row => ({ ...row, steps: tryJson(row.steps, []) })));
  } catch (error) {
    fail(res, error, 'CRM sequence list failed');
  }
});

router.post('/api/admin/crm/sequences', ...manage, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const steps = normalizeSequenceSteps(req.body?.steps || []);
    const timezone = assertTimezone(req.body?.timezone);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO drip_sequences
         (id,tenant_id,name,description,trigger_status,is_active,steps,timezone,exit_on_reply,created_by,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        req.tenantId,
        name.slice(0, 200),
        String(req.body?.description || '').trim() || null,
        String(req.body?.trigger_status || '').trim().slice(0, 100) || null,
        req.body?.is_active === false || req.body?.is_active === 0 ? 0 : 1,
        JSON.stringify(steps),
        timezone,
        req.body?.exit_on_reply === false || req.body?.exit_on_reply === 0 ? 0 : 1,
        actor(req),
        actor(req),
      ]
    );
    res.status(201).json({ ok: true, id, version: 1 });
  } catch (error) {
    fail(res, error, 'CRM sequence creation failed');
  }
});

router.patch('/api/admin/crm/sequences/:id', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[sequence]] = await conn.query(
      'SELECT * FROM drip_sequences WHERE id=? AND tenant_id=? AND archived_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!sequence) {
      await conn.rollback();
      return res.status(404).json({ error: 'Sequence not found' });
    }
    const hasSteps = Object.prototype.hasOwnProperty.call(req.body || {}, 'steps');
    const steps = hasSteps ? normalizeSequenceSteps(req.body.steps) : tryJson(sequence.steps, []);
    const timezone = Object.prototype.hasOwnProperty.call(req.body || {}, 'timezone')
      ? assertTimezone(req.body.timezone)
      : sequence.timezone;
    await conn.query(
      `UPDATE drip_sequences
          SET name=?,description=?,trigger_status=?,is_active=?,steps=?,
              version=version+?,timezone=?,exit_on_reply=?,updated_by=?
        WHERE id=? AND tenant_id=?`,
      [
        String(req.body?.name ?? sequence.name).trim().slice(0, 200),
        req.body?.description === undefined ? sequence.description : String(req.body.description || '').trim() || null,
        req.body?.trigger_status === undefined ? sequence.trigger_status : String(req.body.trigger_status || '').trim().slice(0, 100) || null,
        req.body?.is_active === undefined ? sequence.is_active : (req.body.is_active ? 1 : 0),
        JSON.stringify(steps),
        hasSteps ? 1 : 0,
        timezone,
        req.body?.exit_on_reply === undefined ? sequence.exit_on_reply : (req.body.exit_on_reply ? 1 : 0),
        actor(req),
        req.params.id,
        req.tenantId,
      ]
    );
    await conn.commit();
    res.json({ ok: true, version: Number(sequence.version) + (hasSteps ? 1 : 0) });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM sequence update failed');
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/crm/sequences/:id', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `UPDATE drip_sequences
          SET archived_at=NOW(),is_active=0,updated_by=?
        WHERE id=? AND tenant_id=? AND archived_at IS NULL`,
      [actor(req), req.params.id, req.tenantId]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: 'Sequence not found' });
    }
    await conn.query(
      `UPDATE drip_enrollments
          SET status='unenrolled',unenrolled_at=NOW(),exit_reason='sequence_archived',last_activity_at=NOW()
        WHERE tenant_id=? AND sequence_id=? AND status IN ('active','paused')`,
      [req.tenantId, req.params.id]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM sequence archive failed');
  } finally {
    conn.release();
  }
});

router.post('/api/admin/crm/sequences/:id/enroll', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const leadId = req.body?.lead_id || null;
    const subscriberId = req.body?.subscriber_id || null;
    if (Boolean(leadId) === Boolean(subscriberId)) {
      return res.status(400).json({ error: 'Exactly one lead_id or subscriber_id is required' });
    }
    await conn.beginTransaction();
    const [[sequence]] = await conn.query(
      `SELECT id,steps,version FROM drip_sequences
        WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!sequence) {
      await conn.rollback();
      return res.status(404).json({ error: 'Sequence not found' });
    }
    const steps = normalizeSequenceSteps(tryJson(sequence.steps, []));
    if (!steps.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'No steps defined' });
    }
    let recipient;
    if (leadId) {
      const scope = leadScope(req, 'l');
      const [[lead]] = await conn.query(
        `SELECT l.id,l.email FROM leads l
          WHERE l.id=? AND l.tenant_id=? AND l.hidden=0${scope.sql}
          LIMIT 1 FOR UPDATE`,
        [leadId, req.tenantId, ...scope.params]
      );
      if (!lead) {
        await conn.rollback();
        return res.status(404).json({ error: 'Lead not found' });
      }
      recipient = lead.email || req.body?.email;
    } else {
      const [[subscriber]] = await conn.query(
        `SELECT id,email FROM subscribers
          WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [subscriberId, req.tenantId]
      );
      if (!subscriber) {
        await conn.rollback();
        return res.status(404).json({ error: 'Subscriber not found' });
      }
      recipient = subscriber.email || req.body?.email;
    }
    const email = assertEmail(recipient);
    const [[active]] = await conn.query(
      `SELECT id,sequence_id FROM drip_enrollments
        WHERE tenant_id=? AND status IN ('active','paused')
          AND ((lead_id=? AND ? IS NOT NULL) OR (subscriber_id=? AND ? IS NOT NULL))
        LIMIT 1 FOR UPDATE`,
      [req.tenantId, leadId, leadId, subscriberId, subscriberId]
    );
    if (active) {
      await conn.rollback();
      return res.status(409).json({
        error: 'CRM subject is already active in a sequence',
        enrollment_id: active.id,
        sequence_id: active.sequence_id,
      });
    }
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO drip_enrollments
         (id,tenant_id,sequence_id,lead_id,subscriber_id,email,status,sequence_version,
          steps_snapshot,enrolled_by,current_step,next_send_at,last_activity_at)
       VALUES (?,?,?,?,?,?,'active',?,?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY),NOW())`,
      [
        id,
        req.tenantId,
        sequence.id,
        leadId,
        subscriberId,
        email,
        sequence.version,
        JSON.stringify(steps),
        actor(req),
        0,
        Math.max(Number(steps[0].delay_days) || 0, 0),
      ]
    );
    if (leadId) {
      await logLeadEventStrict(
        leadId,
        'sequence_enrolled',
        'تم تسجيل العميل في تسلسل متابعة',
        { sequenceId: sequence.id, sequenceVersion: sequence.version, enrollmentId: id },
        req.tenantId,
        conn
      );
    }
    await conn.commit();
    res.status(201).json({ ok: true, enrollment_id: id });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM sequence enrollment failed');
  } finally {
    conn.release();
  }
});

router.get('/api/admin/crm/sequence-enrollments', ...view, async (req, res) => {
  try {
    const scope = leadScope(req, 'l');
    if (scope.none) return res.json([]);
    const params = [req.tenantId];
    let filter = '';
    if (req.query.sequence_id) {
      filter += ' AND de.sequence_id=?';
      params.push(req.query.sequence_id);
    }
    if (req.query.status) {
      filter += ' AND de.status=?';
      params.push(String(req.query.status));
    }
    const scoped = scope.sql
      ? ` AND de.lead_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM leads l
           WHERE l.id=de.lead_id AND l.tenant_id=de.tenant_id${scope.sql}
        )`
      : '';
    params.push(...scope.params);
    const [rows] = await pool.query(
      `SELECT de.*,ds.name AS sequence_name,
              (SELECT COUNT(*) FROM crm_sequence_step_executions ex
                WHERE ex.tenant_id=de.tenant_id AND ex.enrollment_id=de.id) AS executed_steps
         FROM drip_enrollments de
         JOIN drip_sequences ds ON ds.id=de.sequence_id AND ds.tenant_id=de.tenant_id
        WHERE de.tenant_id=?${filter}${scoped}
        ORDER BY de.started_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'CRM sequence enrollment list failed');
  }
});

router.post('/api/admin/crm/sequence-enrollments/:id/actions', ...manage, async (req, res) => {
  const action = String(req.body?.action || '').toLowerCase();
  if (!['pause', 'resume', 'unenroll'].includes(action)) {
    return res.status(400).json({ error: 'action must be pause, resume or unenroll' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[enrollment]] = await conn.query(
      `SELECT * FROM drip_enrollments
        WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!enrollment) {
      await conn.rollback();
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    const transitions = {
      pause: {
        from: ['active'],
        sql: `status='paused',paused_at=NOW(),pause_reason=?,last_activity_at=NOW()`,
        params: [String(req.body?.reason || 'manual_pause').slice(0, 500)],
      },
      resume: {
        from: ['paused'],
        sql: `status='active',paused_at=NULL,pause_reason=NULL,
              next_send_at=DATE_ADD(NOW(),INTERVAL ? MINUTE),last_activity_at=NOW()`,
        params: [Math.min(Math.max(Number(req.body?.delay_minutes) || 0, 0), 10080)],
      },
      unenroll: {
        from: ['active', 'paused'],
        sql: `status='unenrolled',unenrolled_at=NOW(),exit_reason=?,last_activity_at=NOW()`,
        params: [String(req.body?.reason || 'manual_unenroll').slice(0, 100)],
      },
    };
    const transition = transitions[action];
    if (!transition.from.includes(enrollment.status)) {
      await conn.rollback();
      return res.status(409).json({ error: `Cannot ${action} enrollment from ${enrollment.status}` });
    }
    await conn.query(
      `UPDATE drip_enrollments SET ${transition.sql} WHERE id=? AND tenant_id=?`,
      [...transition.params, enrollment.id, req.tenantId]
    );
    if (enrollment.lead_id) {
      await logLeadEventStrict(
        enrollment.lead_id,
        `sequence_${action}`,
        `Sequence enrollment ${action}`,
        { enrollmentId: enrollment.id, sequenceId: enrollment.sequence_id },
        req.tenantId,
        conn
      );
    }
    await conn.commit();
    res.json({ ok: true, status: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'unenrolled' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM sequence action failed');
  } finally {
    conn.release();
  }
});

module.exports = router;
