'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../../middleware/auth');

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
router.get('/api/admin/leads/scoring', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [leads] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.source, l.branch,
             l.next_follow_up_date AS follow_up_date, l.created_at, l.lead_type,
             st.name AS assigned_staff,
             (SELECT COUNT(*) FROM communications lc WHERE lc.lead_id = l.id) AS comm_count
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_sales_id
      WHERE l.status NOT IN ('converted','lost','junk')
      ORDER BY l.created_at DESC LIMIT 1000`);

    const now = Date.now();
    const scored = leads.map(l => {
      let score = 0;
      if (l.phone)  score += 30;
      if (l.email)  score += 10;
      const st = (l.status || '').toLowerCase(); // DB stores ENUM uppercase (INTERESTED/CONTACTED)
      if (st === 'interested')  score += 20;
      else if (st === 'follow_up' || st === 'contacted') score += 10;
      if (l.follow_up_date && new Date(l.follow_up_date) > new Date()) score += 15;
      if (l.comm_count > 0) score += 10;
      if (now - new Date(l.created_at).getTime() < 14 * 24 * 60 * 60 * 1000) score += 5;
      return { ...l, score, grade: score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D' };
    });

    scored.sort((a, b) => b.score - a.score);
    res.json(scored);
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/leads/scoring/config — get current scoring weights
router.get('/api/admin/leads/scoring/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[row]] = await pool.query("SELECT value FROM site_config WHERE `key` = 'lead_scoring_config'").catch(() => [[null]]);
    const defaults = {
      has_phone: 30, has_email: 10,
      status_interested: 20, status_follow_up: 10,
      future_followup: 15, has_comms: 10, fresh_14d: 5,
      interest_high: 25, interest_medium: 10,
      has_course: 10
    };
    const config = row?.value ? { ...defaults, ...JSON.parse(row.value) } : defaults;
    res.json(config);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/leads/scoring/config — update scoring weights
router.put('/api/admin/leads/scoring/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('lead_scoring_config', ?) ON DUPLICATE KEY UPDATE `value` = ?",
      [JSON.stringify(req.body), JSON.stringify(req.body)]
    );
    res.json({ ok: true, message: 'Scoring config saved. Run /recalculate to apply.' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/scoring/recalculate — bulk recalculate all active lead scores
router.post('/api/admin/leads/scoring/recalculate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[cfgRow]] = await pool.query("SELECT value FROM site_config WHERE `key` = 'lead_scoring_config'").catch(() => [[null]]);
    const weights = cfgRow?.value ? JSON.parse(cfgRow.value) : {};
    const W = {
      has_phone: 30, has_email: 10,
      status_interested: 20, status_follow_up: 10,
      future_followup: 15, has_comms: 10, fresh_14d: 5,
      interest_high: 25, interest_medium: 10,
      has_course: 10,
      ...weights
    };

    const [leads] = await pool.query(`
      SELECT l.id, l.phone, l.email, l.status, l.interest_level,
             l.next_follow_up_date AS follow_up_date, l.created_at, l.enrolled_course_id,
             (SELECT COUNT(*) FROM communications lc WHERE lc.lead_id = l.id) AS comm_count
      FROM leads l
      WHERE l.hidden = 0 AND l.status NOT IN ('lost','junk')
    `);

    const now = Date.now();
    let updated = 0;
    // Compute all scores in JS, then batch UPDATE with CASE WHEN (1 query instead of N)
    const scoreMap = leads.map(l => {
      let score = 0;
      if (l.phone)  score += W.has_phone;
      if (l.email)  score += W.has_email;
      const st = (l.status || '').toLowerCase();
      if (st === 'interested')  score += W.status_interested;
      else if (st === 'follow_up' || st === 'contacted') score += W.status_follow_up;
      if (l.follow_up_date && new Date(l.follow_up_date) > new Date()) score += W.future_followup;
      if (Number(l.comm_count) > 0)  score += W.has_comms;
      if (now - new Date(l.created_at).getTime() < 14 * 86400000) score += W.fresh_14d;
      const il = (l.interest_level || '').toUpperCase();
      if (il === 'HIGH')   score += W.interest_high;
      else if (il === 'MEDIUM') score += W.interest_medium;
      if (l.enrolled_course_id) score += W.has_course;
      return { id: l.id, score: Math.min(Math.max(Math.round(score), 0), 100) };
    });
    // Process in chunks of 500 to avoid oversized CASE WHEN queries
    const SCORE_CHUNK = 500;
    for (let si = 0; si < scoreMap.length; si += SCORE_CHUNK) {
      const chunk = scoreMap.slice(si, si + SCORE_CHUNK);
      const caseWhen = chunk.map(() => 'WHEN id=? THEN ?').join(' ');
      const caseParams = chunk.flatMap(r => [r.id, r.score]);
      const ids = chunk.map(r => r.id);
      await pool.query(
        `UPDATE leads SET score = CASE ${caseWhen} END WHERE id IN (${ids.map(() => '?').join(',')})`,
        [...caseParams, ...ids]
      );
    }
    updated = scoreMap.length;

    res.json({ ok: true, updated, message: `Recalculated scores for ${updated} leads` });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/leads/scoring/leaderboard?limit= — top leads by score
router.get('/api/admin/leads/scoring/leaderboard', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const [rows] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.source, l.branch,
             l.score, l.interest_level, l.next_follow_up_date AS follow_up_date, l.created_at,
             l.enrolled_course_id,
             c.title AS course_title,
             l.assigned_sales_name
      FROM leads l
      LEFT JOIN courses c ON c.id = l.enrolled_course_id
      WHERE l.hidden = 0 AND l.status NOT IN ('lost','junk','converted')
      ORDER BY l.score DESC
      LIMIT ?
    `, [limit]);
    const graded = rows.map(r => ({
      ...r,
      grade: r.score >= 70 ? 'A' : r.score >= 50 ? 'B' : r.score >= 30 ? 'C' : 'D'
    }));
    res.json({ leads: graded, total: graded.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
