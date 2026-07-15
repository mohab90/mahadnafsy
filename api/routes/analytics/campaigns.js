'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { sendEmail } = require('../../lib/email');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Campaign Analytics ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/reports/campaign?from=&to=
// Returns: leads by source, utm_campaign performance, monthly trend, conversion funnel
router.get('/api/admin/reports/campaign', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);

    // By referral source
    const [bySource] = await pool.query(`
      SELECT
        COALESCE(source, 'غير محدد') AS source,
        COUNT(*) AS total_leads,
        SUM(CASE WHEN status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost
      FROM leads
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY source ORDER BY total_leads DESC
    `, [from, to]);

    // By UTM campaign
    const [byCampaign] = await pool.query(`
      SELECT
        COALESCE(utm_campaign, 'بدون حملة') AS campaign,
        COALESCE(utm_source,   'غير محدد')   AS utm_source,
        COALESCE(utm_medium,   'غير محدد')   AS utm_medium,
        COUNT(*) AS total_leads,
        SUM(CASE WHEN status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted
      FROM leads
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY utm_campaign, utm_source, utm_medium
      ORDER BY total_leads DESC
      LIMIT 100
    `, [from, to]);

    // Monthly new leads + conversions trend
    const [monthlyTrend] = await pool.query(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        COUNT(*) AS new_leads,
        SUM(CASE WHEN status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted
      FROM leads
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY month ORDER BY month ASC
    `, [from, to]);

    // Revenue by source (joins leads → subscribers → payments)
    const [revenueBySource] = await pool.query(`
      SELECT
        COALESCE(l.source, 'غير محدد') AS source,
        COUNT(DISTINCT p.id)            AS payment_count,
        COALESCE(SUM(p.amount), 0)      AS revenue
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id
      LEFT JOIN leads l ON l.id = s.lead_id
      WHERE p.status IN ('paid','confirmed')
        AND DATE(p.date) BETWEEN ? AND ?
      GROUP BY l.source ORDER BY revenue DESC
    `, [from, to]);

    // Top interested courses
    const [topCourses] = await pool.query(`
      SELECT
        c.title, COUNT(*) AS interested_count,
        SUM(CASE WHEN l.status IN ('CONVERTED','converted','won') THEN 1 ELSE 0 END) AS converted
      FROM leads l
      JOIN courses c ON c.id = l.enrolled_course_id
      WHERE DATE(l.created_at) BETWEEN ? AND ?
      GROUP BY l.enrolled_course_id, c.title ORDER BY interested_count DESC LIMIT 20
    `, [from, to]);

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
router.patch('/api/admin/leads/:id/utm', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { utm_source, utm_medium, utm_campaign, utm_content, utm_term, referral_url } = req.body;
    await pool.query(
      `UPDATE leads SET
         utm_source   = COALESCE(?, utm_source),
         utm_medium   = COALESCE(?, utm_medium),
         utm_campaign = COALESCE(?, utm_campaign),
         utm_content  = COALESCE(?, utm_content),
         utm_term     = COALESCE(?, utm_term),
         referral_url = COALESCE(?, referral_url)
       WHERE id = ?`,
      [utm_source || null, utm_medium || null, utm_campaign || null,
       utm_content || null, utm_term || null, referral_url || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Drip Campaigns (Lead Nurture Sequences) ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get  ('/api/admin/drip-sequences', requireAuth, requireAdmin, async (req, res) => {
  try { const [rows] = await pool.query(
    'SELECT id, name, description, trigger_status, is_active, steps, created_at, created_by FROM drip_sequences ORDER BY created_at DESC'
  ); res.json(rows.map(r => ({ ...r, steps: tryJson(r.steps, []) }))); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post  ('/api/admin/drip-sequences', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, trigger_status, steps=[], is_active=1 } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = require('crypto').randomUUID();
    await pool.query('INSERT INTO drip_sequences (id,name,description,trigger_status,is_active,steps,created_by) VALUES (?,?,?,?,?,?,?)',
      [id, name, description||null, trigger_status||null, is_active?1:0, JSON.stringify(steps), req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put  ('/api/admin/drip-sequences/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, trigger_status, steps, is_active } = req.body;
    await pool.query('UPDATE drip_sequences SET name=COALESCE(?,name),description=COALESCE(?,description),trigger_status=COALESCE(?,trigger_status),steps=COALESCE(?,steps),is_active=COALESCE(?,is_active) WHERE id=?',
      [name||null, description||null, trigger_status||null, steps?JSON.stringify(steps):null, is_active??null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/drip-sequences/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM drip_sequences WHERE id=?', [req.params.id]);
    await pool.query('DELETE FROM drip_enrollments WHERE sequence_id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/drip-sequences/:id/enroll', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { lead_id, subscriber_id, email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const [[seq]] = await pool.query(
      'SELECT id, name, description, trigger_status, is_active, steps, created_at, created_by FROM drip_sequences WHERE id=? AND is_active=1 LIMIT 1',
      [req.params.id]
    );
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });
    const steps = tryJson(seq.steps, []);
    if (!steps.length) return res.status(400).json({ error: 'No steps defined' });
    const nextSend = new Date(Date.now() + (steps[0].delay_days||0) * 86400000);
    const id = require('crypto').randomUUID();
    await pool.query('INSERT INTO drip_enrollments (id,sequence_id,lead_id,subscriber_id,email,current_step,next_send_at) VALUES (?,?,?,?,?,?,?)',
      [id, req.params.id, lead_id||null, subscriber_id||null, email, 0, nextSend]);
    res.json({ ok: true, enrollment_id: id, next_send_at: nextSend });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.get('/api/admin/drip-enrollments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sequence_id } = req.query;
    let q = 'SELECT de.*, ds.name AS sequence_name FROM drip_enrollments de JOIN drip_sequences ds ON ds.id=de.sequence_id WHERE 1=1';
    const params = [];
    if (sequence_id) { q += ' AND de.sequence_id=?'; params.push(sequence_id); }
    q += ' ORDER BY de.started_at DESC LIMIT 500';
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// Cron: process drip email queue every 15 minutes
setInterval(async () => {
  try {
    const [pending] = await pool.query(`
      SELECT de.*, ds.steps, ds.name AS seq_name
      FROM drip_enrollments de JOIN drip_sequences ds ON ds.id=de.sequence_id
      WHERE de.next_send_at <= NOW() AND de.completed_at IS NULL AND de.unsubscribed_at IS NULL AND ds.is_active=1
      LIMIT 50`);
    for (const enr of pending) {
      const steps = tryJson(enr.steps, []);
      const step  = steps[enr.current_step];
      if (!step) { await pool.query('UPDATE drip_enrollments SET completed_at=NOW() WHERE id=?', [enr.id]); continue; }
      try { await sendEmail(enr.email, step.subject || 'رسالة من معهد الدراسات النفسية', step.body_html || ''); } catch (_) {}
      const next = steps[enr.current_step + 1];
      if (next) {
        const ns = new Date(Date.now() + (next.delay_days||1) * 86400000);
        await pool.query('UPDATE drip_enrollments SET current_step=?,next_send_at=? WHERE id=?', [enr.current_step+1, ns, enr.id]);
      } else {
        await pool.query('UPDATE drip_enrollments SET completed_at=NOW() WHERE id=?', [enr.id]);
      }
    }
    if (pending.length > 0) logger.info(`[cron drip] processed ${pending.length}`);
  } catch (e) { logger.warn('[cron drip]', e.message); }
}, 15 * 60 * 1000);

module.exports = router;
