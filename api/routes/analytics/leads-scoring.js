'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { getTenantSetting, setTenantSetting } = require('../../lib/tenantSettings');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

const DEFAULT_WEIGHTS = Object.freeze({
  has_phone: 30, has_email: 10,
  status_interested: 20, status_follow_up: 10,
  future_followup: 15, has_comms: 10, fresh_14d: 5,
  interest_high: 25, interest_medium: 10, has_course: 10,
});

function scoreLead(lead, weights = DEFAULT_WEIGHTS) {
  const W = { ...DEFAULT_WEIGHTS, ...weights };
  let score = 0;
  if (lead.phone) score += Number(W.has_phone) || 0;
  if (lead.email) score += Number(W.has_email) || 0;
  const status = String(lead.status || '').toLowerCase();
  if (status === 'interested') score += Number(W.status_interested) || 0;
  else if (status === 'follow_up' || status === 'contacted') score += Number(W.status_follow_up) || 0;
  if (lead.follow_up_date && new Date(lead.follow_up_date) > new Date()) score += Number(W.future_followup) || 0;
  if (Number(lead.comm_count) > 0) score += Number(W.has_comms) || 0;
  if (Date.now() - new Date(lead.created_at).getTime() < 14 * 86400000) score += Number(W.fresh_14d) || 0;
  const interest = String(lead.interest_level || '').toUpperCase();
  if (interest === 'HIGH') score += Number(W.interest_high) || 0;
  else if (interest === 'MEDIUM') score += Number(W.interest_medium) || 0;
  if (lead.enrolled_course_id) score += Number(W.has_course) || 0;
  return Math.min(Math.max(Math.round(score), 0), 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Lead Scoring ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/leads/scoring — return all active leads with computed score + grade
// Scoring rubric (100 pts max):
//   +30 has phone
//   +10 has email
//   +20 status = interested / +30 status = converted / +10 status = follow_up
//   +15 has follow_up_date in future
//   +10 has at least 1 communication
//   +5  added within last 14 days (fresh)
router.get('/api/admin/leads/scoring', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    const ownershipSql = req.staffRecord?.role === 'SALES' ? ' AND l.assigned_sales_id = ?' : '';
    const params = [req.tenantId, ...(req.staffRecord?.role === 'SALES' ? [req.staffRecord.id] : [])];
    const [leads] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.source, l.branch,
             l.next_follow_up_date AS follow_up_date, l.created_at, l.lead_type,
             l.interest_level, l.enrolled_course_id,
             st.name AS assigned_staff,
             (SELECT COUNT(*) FROM communications lc WHERE lc.lead_id = l.id) AS comm_count
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.hidden = 0 AND l.status NOT IN ('converted','lost','junk')${ownershipSql}
      ORDER BY l.created_at DESC LIMIT 1000`, params);

    const weights = await getTenantSetting('lead_scoring_config', { tenantId: req.tenantId, fallback: DEFAULT_WEIGHTS });
    const scored = leads.map(l => {
      const score = scoreLead(l, weights);
      return { ...l, score, grade: score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D' };
    });

    scored.sort((a, b) => b.score - a.score);
    res.json(scored);
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/leads/scoring/config — get current scoring weights
router.get('/api/admin/leads/scoring/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = await getTenantSetting('lead_scoring_config', { tenantId: req.tenantId, fallback: DEFAULT_WEIGHTS });
    res.json({ ...DEFAULT_WEIGHTS, ...(config || {}) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/leads/scoring/config — update scoring weights
router.put('/api/admin/leads/scoring/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sanitized = {};
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      if (req.body?.[key] == null) continue;
      const value = Number(req.body[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) return res.status(400).json({ error: `Invalid weight: ${key}` });
      sanitized[key] = value;
    }
    await setTenantSetting('lead_scoring_config', { ...DEFAULT_WEIGHTS, ...sanitized }, {
      tenantId: req.tenantId,
      actorId: req.user?.uid || req.user?.email || null,
    });
    res.json({ ok: true, message: 'Scoring config saved. Run /recalculate to apply.' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/scoring/recalculate — bulk recalculate all active lead scores
router.post('/api/admin/leads/scoring/recalculate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const weights = await getTenantSetting('lead_scoring_config', { tenantId: req.tenantId, fallback: DEFAULT_WEIGHTS });

    const [leads] = await pool.query(`
      SELECT l.id, l.phone, l.email, l.status, l.interest_level,
             l.next_follow_up_date AS follow_up_date, l.created_at, l.enrolled_course_id,
             (SELECT COUNT(*) FROM communications lc WHERE lc.lead_id = l.id) AS comm_count
      FROM leads l
      WHERE l.tenant_id = ? AND l.hidden = 0 AND l.status NOT IN ('lost','junk')
    `, [req.tenantId]);

    let updated = 0;
    // Compute all scores in JS, then batch UPDATE with CASE WHEN (1 query instead of N)
    const scoreMap = leads.map(l => {
      return { id: l.id, score: scoreLead(l, weights) };
    });
    // Process in chunks of 500 to avoid oversized CASE WHEN queries
    const SCORE_CHUNK = 500;
    for (let si = 0; si < scoreMap.length; si += SCORE_CHUNK) {
      const chunk = scoreMap.slice(si, si + SCORE_CHUNK);
      const caseWhen = chunk.map(() => 'WHEN id=? THEN ?').join(' ');
      const caseParams = chunk.flatMap(r => [r.id, r.score]);
      const ids = chunk.map(r => r.id);
      await pool.query(
        `UPDATE leads SET score = CASE ${caseWhen} END WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`,
        [...caseParams, req.tenantId, ...ids]
      );
    }
    updated = scoreMap.length;

    res.json({ ok: true, updated, message: `Recalculated scores for ${updated} leads` });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/leads/scoring/leaderboard?limit= — top leads by score
router.get('/api/admin/leads/scoring/leaderboard', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const [rows] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.source, l.branch,
             l.score, l.interest_level, l.next_follow_up_date AS follow_up_date, l.created_at,
             l.enrolled_course_id,
             c.title AS course_title,
             l.assigned_sales_name
      FROM leads l
      LEFT JOIN courses c ON c.id = l.enrolled_course_id AND c.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.hidden = 0 AND l.status NOT IN ('lost','junk','converted')
        ${req.staffRecord?.role === 'SALES' ? 'AND l.assigned_sales_id = ?' : ''}
      ORDER BY l.score DESC
      LIMIT ?
    `, [req.tenantId, ...(req.staffRecord?.role === 'SALES' ? [req.staffRecord.id] : []), limit]);
    const graded = rows.map(r => ({
      ...r,
      grade: r.score >= 70 ? 'A' : r.score >= 50 ? 'B' : r.score >= 30 ? 'C' : 'D'
    }));
    res.json({ leads: graded, total: graded.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
