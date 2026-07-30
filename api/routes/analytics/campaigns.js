'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { leadScope } = require('../../lib/leadAccess');
const { hasPermission } = require('../../constants/permissions');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Campaign Analytics ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/reports/campaign?from=&to=
// Returns: leads by source, utm_campaign performance, monthly trend, conversion funnel
router.get('/api/admin/reports/campaign', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), requirePermission('view_reports'), async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const scope = leadScope(req, 'l');
    if (scope.none) return res.json({
      period: { from, to },
      summary: { total_leads: 0, converted: 0, conversion_rate: 0 },
      by_source: [], by_campaign: [], monthly_trend: [], revenue_by_source: [], top_courses: [],
    });

    // By referral source
    const [bySource] = await pool.query(`
      SELECT
        COALESCE(l.source, 'غير محدد') AS source,
        COUNT(*) AS total_leads,
        SUM(CASE WHEN l.status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted,
        SUM(CASE WHEN l.status = 'lost' THEN 1 ELSE 0 END) AS lost
      FROM leads l
      WHERE l.tenant_id=? AND DATE(l.created_at) BETWEEN ? AND ?${scope.sql}
      GROUP BY l.source ORDER BY total_leads DESC
    `, [req.tenantId, from, to, ...scope.params]);

    // By UTM campaign
    const [byCampaign] = await pool.query(`
      SELECT
        COALESCE(l.utm_campaign, 'بدون حملة') AS campaign,
        COALESCE(l.utm_source,   'غير محدد')   AS utm_source,
        COALESCE(l.utm_medium,   'غير محدد')   AS utm_medium,
        COUNT(*) AS total_leads,
        SUM(CASE WHEN l.status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted
      FROM leads l
      WHERE l.tenant_id=? AND DATE(l.created_at) BETWEEN ? AND ?${scope.sql}
      GROUP BY l.utm_campaign, l.utm_source, l.utm_medium
      ORDER BY total_leads DESC
      LIMIT 100
    `, [req.tenantId, from, to, ...scope.params]);

    // Monthly new leads + conversions trend
    const [monthlyTrend] = await pool.query(`
      SELECT
        DATE_FORMAT(l.created_at, '%Y-%m') AS month,
        COUNT(*) AS new_leads,
        SUM(CASE WHEN l.status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted
      FROM leads l
      WHERE l.tenant_id=? AND DATE(l.created_at) BETWEEN ? AND ?${scope.sql}
      GROUP BY month ORDER BY month ASC
    `, [req.tenantId, from, to, ...scope.params]);

    // Revenue by source (joins leads → subscribers → payments)
    let revenueBySource = [];
    if (req.isSuperAdmin || hasPermission(req.staffRecord, 'view_financial')) {
      [revenueBySource] = await pool.query(`
        SELECT
          COALESCE(l.source, 'غير محدد') AS source,
          COUNT(DISTINCT p.id)            AS payment_count,
          COALESCE(SUM(p.amount_egp), 0)  AS revenue
        FROM payments p
        JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        JOIN leads l ON l.id = s.lead_id AND l.tenant_id = p.tenant_id
        WHERE p.tenant_id=? AND p.status IN ('paid','confirmed')
          AND DATE(p.date) BETWEEN ? AND ?${scope.sql}
        GROUP BY l.source ORDER BY revenue DESC
      `, [req.tenantId, from, to, ...scope.params]);
    }

    // Top interested courses
    const [topCourses] = await pool.query(`
      SELECT
        c.title, COUNT(*) AS interested_count,
        SUM(CASE WHEN l.status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted
      FROM leads l
      JOIN courses c ON c.id = l.enrolled_course_id AND c.tenant_id = l.tenant_id
      WHERE l.tenant_id=? AND DATE(l.created_at) BETWEEN ? AND ?${scope.sql}
      GROUP BY l.enrolled_course_id, c.title ORDER BY interested_count DESC LIMIT 20
    `, [req.tenantId, from, to, ...scope.params]);

    const totalLeads     = bySource.reduce((s, r) => s + Number(r.total_leads), 0);
    const totalConverted = bySource.reduce((s, r) => s + Number(r.converted), 0);

    res.json({
      period: { from, to },
      summary: {
        total_leads: totalLeads,
        converted: totalConverted,
        conversion_rate: totalLeads > 0 ? parseFloat((totalConverted / totalLeads * 100).toFixed(1)) : 0
      },
      by_source: bySource.map(r => ({
        ...r,
        conversion_rate: Number(r.total_leads) > 0 ? parseFloat((Number(r.converted) / Number(r.total_leads) * 100).toFixed(1)) : 0
      })),
      by_campaign: byCampaign.map(r => ({
        ...r,
        conversion_rate: Number(r.total_leads) > 0 ? parseFloat((Number(r.converted) / Number(r.total_leads) * 100).toFixed(1)) : 0
      })),
      monthly_trend: monthlyTrend,
      revenue_by_source: revenueBySource,
      top_courses: topCourses
    });
  } catch (e) { logger.error('[reports/campaign]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/leads/:id/utm — attach UTM params to a lead
router.patch('/api/admin/leads/:id/utm', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    const { utm_source, utm_medium, utm_campaign, utm_content, utm_term, referral_url } = req.body;
    const scope = leadScope(req, 'l');
    const [result] = await pool.query(
      `UPDATE leads l SET
         utm_source   = COALESCE(?, utm_source),
         utm_medium   = COALESCE(?, utm_medium),
         utm_campaign = COALESCE(?, utm_campaign),
         utm_content  = COALESCE(?, utm_content),
         utm_term     = COALESCE(?, utm_term),
         referral_url = COALESCE(?, referral_url)
       WHERE l.id = ? AND l.tenant_id = ?${scope.sql}`,
      [utm_source || null, utm_medium || null, utm_campaign || null,
       utm_content || null, utm_term || null, referral_url || null, req.params.id, req.tenantId,
       ...scope.params]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Drip Campaigns (Lead Nurture Sequences) ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get  ('/api/admin/drip-sequences', requireAuth, requireAdmin, async (req, res) => {
  try { const [rows] = await pool.query(
    'SELECT id, name, description, trigger_status, is_active, steps, created_at, created_by FROM drip_sequences WHERE tenant_id=? ORDER BY created_at DESC',
    [req.tenantId]
  ); res.json(rows.map(r => ({ ...r, steps: tryJson(r.steps, []) }))); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post  ('/api/admin/drip-sequences', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, trigger_status, steps=[], is_active=1 } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = require('crypto').randomUUID();
    await pool.query('INSERT INTO drip_sequences (id,tenant_id,name,description,trigger_status,is_active,steps,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.tenantId, name, description||null, trigger_status||null, is_active?1:0, JSON.stringify(steps), req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put  ('/api/admin/drip-sequences/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, trigger_status, steps, is_active } = req.body;
    const [result] = await pool.query('UPDATE drip_sequences SET name=COALESCE(?,name),description=COALESCE(?,description),trigger_status=COALESCE(?,trigger_status),steps=COALESCE(?,steps),is_active=COALESCE(?,is_active) WHERE id=? AND tenant_id=?',
      [name||null, description||null, trigger_status||null, steps?JSON.stringify(steps):null, is_active??null, req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Sequence not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/drip-sequences/:id', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM drip_enrollments WHERE sequence_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    const [result] = await conn.query('DELETE FROM drip_sequences WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'Sequence not found' }); }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { try { await conn.rollback(); } catch (_) {} logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
  finally { conn.release(); }
});
router.post('/api/admin/drip-sequences/:id/enroll', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { lead_id, subscriber_id, email } = req.body;
    if (Boolean(lead_id) === Boolean(subscriber_id)) {
      return res.status(400).json({ error: 'Exactly one lead_id or subscriber_id is required' });
    }
    await conn.beginTransaction();
    const [[seq]] = await conn.query(
      `SELECT id,name,description,trigger_status,is_active,steps,created_at,created_by
         FROM drip_sequences
        WHERE id=? AND tenant_id=? AND is_active=1
        LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!seq) {
      await conn.rollback();
      return res.status(404).json({ error: 'Sequence not found' });
    }
    const steps = tryJson(seq.steps, []);
    if (!steps.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'No steps defined' });
    }
    let recipientEmail = String(email || '').trim();
    if (lead_id) {
      const [[lead]] = await conn.query(
        'SELECT email FROM leads WHERE id=? AND tenant_id=? AND hidden=0 LIMIT 1 FOR UPDATE',
        [lead_id, req.tenantId]
      );
      if (!lead) {
        await conn.rollback();
        return res.status(404).json({ error: 'Lead not found' });
      }
      recipientEmail = lead.email || recipientEmail;
    }
    if (subscriber_id) {
      const [[subscriber]] = await conn.query(
        'SELECT email FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [subscriber_id, req.tenantId]
      );
      if (!subscriber) {
        await conn.rollback();
        return res.status(404).json({ error: 'Subscriber not found' });
      }
      recipientEmail = subscriber.email || recipientEmail;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      await conn.rollback();
      return res.status(400).json({ error: 'A valid CRM email is required' });
    }
    const [[active]] = await conn.query(
      `SELECT id FROM drip_enrollments
        WHERE tenant_id=? AND sequence_id=?
          AND ((lead_id=? AND ? IS NOT NULL) OR (subscriber_id=? AND ? IS NOT NULL))
          AND completed_at IS NULL AND unsubscribed_at IS NULL AND failed_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id, lead_id || null, lead_id || null, subscriber_id || null, subscriber_id || null]
    );
    if (active) {
      await conn.rollback();
      return res.status(409).json({ error: 'CRM subject is already active in this sequence', enrollment_id: active.id });
    }
    const delayDays = Math.max(Number(steps[0].delay_days) || 0, 0);
    const id = require('crypto').randomUUID();
    await conn.query(
      `INSERT INTO drip_enrollments
         (id,tenant_id,sequence_id,lead_id,subscriber_id,email,current_step,next_send_at)
       VALUES (?,?,?,?,?,?,0,DATE_ADD(NOW(),INTERVAL ? DAY))`,
      [id, req.tenantId, req.params.id, lead_id || null, subscriber_id || null, recipientEmail, delayDays]
    );
    await conn.commit();
    res.json({ ok: true, enrollment_id: id });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});
router.get('/api/admin/drip-enrollments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sequence_id } = req.query;
    let q = 'SELECT de.*, ds.name AS sequence_name FROM drip_enrollments de JOIN drip_sequences ds ON ds.id=de.sequence_id AND ds.tenant_id=de.tenant_id WHERE de.tenant_id=?';
    const params = [req.tenantId];
    if (sequence_id) { q += ' AND de.sequence_id=?'; params.push(sequence_id); }
    q += ' ORDER BY de.started_at DESC LIMIT 500';
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
module.exports = router;
