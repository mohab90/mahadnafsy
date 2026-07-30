'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ module: 'crm-coaching-route' });
const { leadScope } = require('../lib/leadAccess');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

const router = express.Router();
const view = [requireAuth, requireAdminOrStaff, requirePermission('view_reports')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_leads')];
const review = [...manage, requirePermission('view_reports')];
const actor = req => String(req.staffRecord?.id || req.user?.email || req.user?.uid || 'system');
const TYPES = new Set(['recording', 'transcript', 'email', 'whatsapp', 'note']);
const fail = (res, error, label) => {
  logger.error(label, error);
  res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
};

async function scopedCommunication(conn, req, communicationId, lock = false) {
  const scope = leadScope(req, 'l');
  if (scope.none) return null;
  const scopedRequirement = scope.sql ? ' AND c.lead_id IS NOT NULL' : '';
  const [[row]] = await conn.query(
    `SELECT c.*,l.name AS lead_name
       FROM communications c
       LEFT JOIN leads l ON l.id=c.lead_id AND l.tenant_id=c.tenant_id
      WHERE c.id=? AND c.tenant_id=?${scopedRequirement}${scope.sql}
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [communicationId, req.tenantId, ...scope.params]
  );
  return row || null;
}

router.get('/api/admin/crm/coaching', ...view, async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const scope = leadScope(req, 'l');
    if (scope.none) return res.json({ staff: [], recentCommunications: [] });
    const [staff] = await pool.query(
      `SELECT cr.staff_id,st.name AS staff_name,COUNT(*) AS review_count,
              ROUND(AVG(cr.total_score),2) AS average_score,
              ROUND(AVG(cr.discovery_score),2) AS discovery_score,
              ROUND(AVG(cr.empathy_score),2) AS empathy_score,
              ROUND(AVG(cr.accuracy_score),2) AS accuracy_score,
              ROUND(AVG(cr.next_step_score),2) AS next_step_score
         FROM crm_coaching_reviews cr
         JOIN communications c ON c.id=cr.communication_id AND c.tenant_id=cr.tenant_id
         LEFT JOIN leads l ON l.id=c.lead_id AND l.tenant_id=c.tenant_id
         LEFT JOIN staff st ON st.id=cr.staff_id AND st.tenant_id=cr.tenant_id
        WHERE cr.tenant_id=? AND cr.created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)${scope.sql}
        GROUP BY cr.staff_id,st.name ORDER BY average_score DESC`,
      [req.tenantId, days, ...scope.params]
    );
    const scopedRequirement = scope.sql ? ' AND c.lead_id IS NOT NULL' : '';
    const [recentCommunications] = await pool.query(
      `SELECT c.id,c.lead_id,c.type,c.date,c.notes,c.outcome,c.next_follow_up,c.staff_id,
              l.name AS lead_name,st.name AS staff_name,
              COUNT(DISTINCT ce.id) AS evidence_count,COUNT(DISTINCT cr.id) AS review_count
         FROM communications c
         LEFT JOIN leads l ON l.id=c.lead_id AND l.tenant_id=c.tenant_id
         LEFT JOIN staff st ON st.id=c.staff_id AND st.tenant_id=c.tenant_id
         LEFT JOIN crm_communication_evidence ce ON ce.communication_id=c.id AND ce.tenant_id=c.tenant_id
         LEFT JOIN crm_coaching_reviews cr ON cr.communication_id=c.id AND cr.tenant_id=c.tenant_id
        WHERE c.tenant_id=? AND c.date>=DATE_SUB(NOW(),INTERVAL ? DAY)${scopedRequirement}${scope.sql}
        GROUP BY c.id ORDER BY c.date DESC LIMIT 200`,
      [req.tenantId, days, ...scope.params]
    );
    res.json({ staff, recentCommunications });
  } catch (error) {
    fail(res, error, 'CRM coaching dashboard failed');
  }
});

router.post('/api/admin/crm/communications/:id/evidence', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const evidenceType = String(req.body?.evidence_type || '').toLowerCase();
    const evidenceUrl = String(req.body?.evidence_url || '').trim();
    const contentText = String(req.body?.content_text || '').trim();
    if (!TYPES.has(evidenceType)) return res.status(400).json({ error: 'Unsupported evidence type' });
    if (!evidenceUrl && !contentText) return res.status(400).json({ error: 'Evidence URL or content is required' });
    if (evidenceUrl && (!/^https:\/\//i.test(evidenceUrl) || evidenceUrl.length > 2000)) {
      return res.status(400).json({ error: 'Evidence URL must use HTTPS' });
    }
    if (contentText.length > 100000) return res.status(400).json({ error: 'Evidence content is too large' });
    await conn.beginTransaction();
    const communication = await scopedCommunication(conn, req, req.params.id, true);
    if (!communication) {
      await conn.rollback();
      return res.status(404).json({ error: 'Communication not found' });
    }
    const id = crypto.randomUUID();
    const checksum = crypto.createHash('sha256')
      .update(evidenceType).update('\0').update(evidenceUrl).update('\0').update(contentText)
      .digest('hex');
    await conn.query(
      `INSERT INTO crm_communication_evidence
         (id,tenant_id,communication_id,evidence_type,evidence_url,content_text,content_sha256,captured_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, communication.id, evidenceType, evidenceUrl || null, contentText || null, checksum, actor(req)]
    );
    await conn.commit();
    res.status(201).json({ ok: true, id, content_sha256: checksum });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Evidence already exists' });
    fail(res, error, 'CRM coaching evidence failed');
  } finally {
    conn.release();
  }
});

router.post('/api/admin/crm/coaching/reviews', ...review, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const scores = ['discovery', 'empathy', 'accuracy', 'next_step'].map(key => Number(req.body?.[`${key}_score`]));
    if (!scores.every(score => Number.isInteger(score) && score >= 0 && score <= 5)) {
      return res.status(400).json({ error: 'All coaching scores must be integers from 0 to 5' });
    }
    await conn.beginTransaction();
    const communication = await scopedCommunication(conn, req, req.body?.communication_id, true);
    if (!communication) {
      await conn.rollback();
      return res.status(404).json({ error: 'Communication not found' });
    }
    if (!communication.staff_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'Communication must be attributed to a staff member' });
    }
    if (actor(req) === String(communication.staff_id)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Coaching review requires a separate reviewer', code: 'COACHING_REVIEW_SOD' });
    }
    const [[evidence]] = await conn.query(
      `SELECT id FROM crm_communication_evidence
        WHERE id=? AND communication_id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.body?.evidence_id, communication.id, req.tenantId]
    );
    if (!evidence) {
      await conn.rollback();
      return res.status(400).json({ error: 'Review requires evidence linked to this communication' });
    }
    const total = Number((scores.reduce((sum, score) => sum + score, 0) / 20 * 100).toFixed(2));
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO crm_coaching_reviews
         (id,tenant_id,communication_id,evidence_id,staff_id,reviewer_id,
          discovery_score,empathy_score,accuracy_score,next_step_score,total_score,comments)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, communication.id, evidence.id, communication.staff_id, actor(req),
        ...scores, total, String(req.body?.comments || '').slice(0, 2000) || null,
      ]
    );
    await conn.commit();
    res.status(201).json({ ok: true, id, total_score: total });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Reviewer already reviewed this communication' });
    fail(res, error, 'CRM coaching review failed');
  } finally {
    conn.release();
  }
});

module.exports = router;
