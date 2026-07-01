'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../lib/db');
const { tryJson, sanitize } = require('../lib/helpers');
const { sendEmail } = require('../lib/email');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: P&L (Profit & Loss) Report ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/financial/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/admin/financial/pnl', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);

    const [revRows] = await pool.query(`
      SELECT currency,
        COALESCE(SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END), 0) AS total_egp,
        COUNT(*) AS count
      FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?
      GROUP BY currency`, [from, to]);

    const [expRows] = await pool.query(`
      SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC`, [from, to]);

    const [monthly] = await pool.query(`
      SELECT m.month,
        COALESCE(r.revenue, 0) AS revenue, COALESCE(e.expenses, 0) AS expenses
      FROM (
        SELECT DATE_FORMAT(d, '%Y-%m') AS month FROM
          (SELECT \`date\` AS d FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?
           UNION SELECT \`date\` AS d FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?) t
        GROUP BY month
      ) m
      LEFT JOIN (SELECT DATE_FORMAT(\`date\`,'%Y-%m') AS month, SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END) AS revenue FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ? GROUP BY month) r ON r.month=m.month
      LEFT JOIN (SELECT DATE_FORMAT(\`date\`,'%Y-%m') AS month, SUM(amount) AS expenses FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ? GROUP BY month) e ON e.month=m.month
      ORDER BY m.month`, [from, to, from, to, from, to, from, to]);

    const totalRevenue  = revRows.reduce((s, r) => s + Number(r.total_egp), 0);
    const totalExpenses = expRows.reduce((s, r) => s + Number(r.total), 0);
    const netProfit     = totalRevenue - totalExpenses;

    res.json({
      from, to, totalRevenue, totalExpenses, netProfit,
      margin: totalRevenue > 0 ? parseFloat((netProfit / totalRevenue * 100).toFixed(1)) : 0,
      expensesByCategory: expRows,
      monthly: monthly.map(m => ({ ...m, revenue: Number(m.revenue), expenses: Number(m.expenses), net: Number(m.revenue) - Number(m.expenses) })),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Sales Team Performance + Lead Conversion Funnel ──────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/reports/sales-performance?from=&to=
router.get('/api/admin/reports/sales-performance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);

    const [staff] = await pool.query(`
      SELECT st.id, st.name, st.email, st.role, st.commission_rate,
        COALESCE(ld.total_leads, 0) AS total_leads, COALESCE(ld.converted, 0) AS converted_leads,
        COALESCE(rd.revenue_egp, 0) AS revenue_egp, COALESCE(rd.payment_count, 0) AS payment_count
      FROM staff st
      LEFT JOIN (
        SELECT assigned_sales_id, COUNT(*) AS total_leads,
          SUM(CASE WHEN status IN ('converted','won') THEN 1 ELSE 0 END) AS converted
        FROM leads WHERE DATE(created_at) BETWEEN ? AND ? AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id
      ) ld ON ld.assigned_sales_id = st.id
      LEFT JOIN (
        SELECT staff_id,
          SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END) AS revenue_egp,
          COUNT(*) AS payment_count
        FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ? AND staff_id IS NOT NULL GROUP BY staff_id
      ) rd ON rd.staff_id = st.id
      WHERE UPPER(st.role) IN ('SALES','SALES_MANAGER','MANAGER') AND st.is_active=1
      ORDER BY revenue_egp DESC`, [from, to, from, to]);

    res.json({
      from, to,
      staff: staff.map(s => ({
        ...s,
        commission_due: s.commission_rate ? Math.round(Number(s.revenue_egp) * Number(s.commission_rate) / 100) : null,
        conversion_rate: s.total_leads > 0 ? parseFloat((s.converted_leads / s.total_leads * 100).toFixed(1)) : null,
      })),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/reports/lead-funnel?from=&to=
router.get('/api/admin/reports/lead-funnel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const [byStatus] = await pool.query(`SELECT status, COUNT(*) AS count FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY status ORDER BY count DESC`, [from, to]);
    const [bySource] = await pool.query(`SELECT source, COUNT(*) AS total, SUM(CASE WHEN status IN ('converted','won') THEN 1 ELSE 0 END) AS converted FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY source ORDER BY total DESC`, [from, to]);
    const [byBranch] = await pool.query(`SELECT branch, COUNT(*) AS total, SUM(CASE WHEN status IN ('converted','won') THEN 1 ELSE 0 END) AS converted FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY branch ORDER BY total DESC`, [from, to]);
    const total     = byStatus.reduce((s, r) => s + Number(r.count), 0);
    const converted = byStatus.filter(r => ['converted','won'].includes(r.status)).reduce((s, r) => s + Number(r.count), 0);
    const lost      = byStatus.filter(r => r.status === 'lost').reduce((s, r) => s + Number(r.count), 0);
    res.json({
      from, to, total, converted, lost,
      conversion_rate: total > 0 ? parseFloat((converted / total * 100).toFixed(1)) : 0,
      byStatus,
      bySource: bySource.map(s => ({ ...s, conversion_rate: s.total > 0 ? parseFloat((Number(s.converted) / s.total * 100).toFixed(1)) : 0 })),
      byBranch: byBranch.map(b => ({ ...b, conversion_rate: b.total > 0 ? parseFloat((Number(b.converted) / b.total * 100).toFixed(1)) : 0 })),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Admin Dashboard KPI Snapshot ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/dashboard/kpi — single endpoint with all key metrics
// Optimized: parallel queries, cached totals, month-over-month delta
router.get('/api/admin/dashboard/kpi', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const now    = new Date();
    const ym     = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const curM   = ym(now);
    const prevM  = ym(new Date(now.getFullYear(), now.getMonth()-1, 1));

    const [
      [revenue],
      [leads],
      [subs],
      [enrollments],
      [consultations],
      [certificates],
      [newLeadsToday],
      [newSubsToday],
      [pendingPayments],
      [openLeaves],
      [forumPosts],
      [waitlistTotal],
    ] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN DATE_FORMAT(date,'%Y-%m')=? THEN amount END),0) AS this_month,
          COALESCE(SUM(CASE WHEN DATE_FORMAT(date,'%Y-%m')=? THEN amount END),0) AS last_month,
          COALESCE(SUM(amount),0) AS all_time
        FROM payments WHERE status IN ('paid','confirmed')`, [curM, prevM]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS this_month,
          SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS last_month,
          SUM(CASE WHEN status NOT IN ('lost','junk','converted') THEN 1 ELSE 0 END) AS active
        FROM leads WHERE hidden=0`, [curM, prevM]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS this_month
        FROM subscribers`, [curM]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN DATE_FORMAT(enrolled_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS this_month
        FROM enrollments WHERE status NOT IN ('cancelled','refunded')`, [curM]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
        FROM consultations`),
      pool.query('SELECT COUNT(*) AS total FROM course_completions'),
      pool.query("SELECT COUNT(*) AS n FROM leads WHERE DATE(created_at)=CURDATE() AND hidden=0"),
      pool.query("SELECT COUNT(*) AS n FROM subscribers WHERE DATE(created_at)=CURDATE()"),
      pool.query("SELECT COUNT(*) AS n FROM payments WHERE status='pending'"),
      pool.query("SELECT COUNT(*) AS n FROM leave_requests WHERE status='pending'").catch(() => [[{n:0}]]),
      pool.query("SELECT COUNT(*) AS n FROM forum_posts WHERE is_hidden=0").catch(() => [[{n:0}]]),
      pool.query("SELECT COUNT(*) AS n FROM course_waitlist WHERE status='waiting'").catch(() => [[{n:0}]]),
    ]);

    const rev = revenue[0];
    const pct = (a, b) => b > 0 ? parseFloat(((a-b)/b*100).toFixed(1)) : (a > 0 ? 100 : 0);

    res.json({
      generated_at: now.toISOString(),
      revenue: {
        this_month: parseFloat(rev.this_month) || 0,
        last_month: parseFloat(rev.last_month) || 0,
        all_time:   parseFloat(rev.all_time)   || 0,
        mom_change: pct(parseFloat(rev.this_month), parseFloat(rev.last_month))
      },
      leads: {
        total:      Number(leads[0].total),
        active:     Number(leads[0].active),
        this_month: Number(leads[0].this_month),
        last_month: Number(leads[0].last_month),
        mom_change: pct(Number(leads[0].this_month), Number(leads[0].last_month)),
        new_today:  Number(newLeadsToday[0].n)
      },
      subscribers: {
        total:      Number(subs[0].total),
        this_month: Number(subs[0].this_month),
        new_today:  Number(newSubsToday[0].n)
      },
      enrollments: {
        total:      Number(enrollments[0].total),
        this_month: Number(enrollments[0].this_month)
      },
      consultations: {
        total:   Number(consultations[0].total),
        pending: Number(consultations[0].pending)
      },
      certificates: {
        total: Number(certificates[0].total)
      },
      alerts: {
        pending_payments: Number(pendingPayments[0].n),
        open_leave_requests: Number(openLeaves[0].n),
        waitlist_waiting: Number(waitlistTotal[0].n)
      },
      community: {
        total_posts: Number(forumPosts[0].n)
      }
    });
  } catch (e) { logger.error('[dashboard/kpi]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Campaign Analytics ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure UTM tracking columns exist on leads
(async () => {
  try {
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source   VARCHAR(200) NULL");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium   VARCHAR(200) NULL");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200) NULL");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content  VARCHAR(200) NULL");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term     VARCHAR(200) NULL");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_url TEXT NULL");
    logger.info('[schema] leads UTM columns ready');
  } catch (e) { logger.warn('[schema] leads UTM:', e.message); }
})();

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
// ── FEATURE: Recurring Expenses ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS recurring_expenses (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      title VARCHAR(200) NOT NULL,
      amount_egp DECIMAL(12,2) NOT NULL,
      category VARCHAR(100),
      notes TEXT,
      frequency ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
      day_of_month TINYINT DEFAULT 1,
      is_active TINYINT(1) DEFAULT 1,
      last_run DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200)
    )`);
    logger.info('[schema] recurring_expenses ready');
  } catch (e) { logger.warn('[schema recurring_expenses]', e.message); }
})();
router.get  ('/api/admin/recurring-expenses', requireAuth, requireAdmin, async (req, res) => {
  try { const [rows] = await pool.query(
    `SELECT id, title, amount_egp, category, notes, frequency, day_of_month, is_active, last_run, created_at, created_by
     FROM recurring_expenses ORDER BY created_at DESC`
  ); res.json(rows); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post  ('/api/admin/recurring-expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, amount_egp, category, notes, frequency='monthly', day_of_month=1 } = req.body;
    if (!title || !amount_egp) return res.status(400).json({ error: 'title and amount_egp required' });
    const id = require('crypto').randomUUID();
    await pool.query('INSERT INTO recurring_expenses (id,title,amount_egp,category,notes,frequency,day_of_month,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, title, amount_egp, category||null, notes||null, frequency, day_of_month, req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put  ('/api/admin/recurring-expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, amount_egp, category, notes, frequency, day_of_month, is_active } = req.body;
    await pool.query('UPDATE recurring_expenses SET title=COALESCE(?,title),amount_egp=COALESCE(?,amount_egp),category=COALESCE(?,category),notes=COALESCE(?,notes),frequency=COALESCE(?,frequency),day_of_month=COALESCE(?,day_of_month),is_active=COALESCE(?,is_active) WHERE id=?',
      [title||null, amount_egp||null, category||null, notes||null, frequency||null, day_of_month||null, is_active??null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/recurring-expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM recurring_expenses WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// Cron: auto-create expenses from recurring templates daily at 8 AM Cairo
setInterval(async () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  if (now.getHours() !== 8 || now.getMinutes() > 4) return;
  const today = now.toISOString().slice(0, 10);
  const dom   = now.getDate();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  try {
    const [recs] = await pool.query(
      `SELECT id, title, amount_egp, category, notes, frequency, day_of_month, is_active, last_run, created_at, created_by
       FROM recurring_expenses WHERE is_active=1 AND day_of_month=? AND (last_run IS NULL OR last_run < ?)`,
      [dom, monthStart]
    );
    if (recs.length > 0) {
      // Atomic: only mark last_run if expenses were actually created
      // expenses.category is an ENUM(SALARIES,RENT,...,OTHER); recurring category is
      // free text, so store it as OTHER and keep the original label in the description.
      const expRows = recs.map(() => '(?,?,?,?,?,?)');
      const expParams = recs.flatMap(rec => [
        require('crypto').randomUUID(),
        `[تلقائي] ${rec.title}${rec.category ? ' — ' + rec.category : ''}`, rec.amount_egp,
        'OTHER', today,
        `مصروف متكرر - ${rec.frequency}`,
      ]);
      try {
        await pool.query(`INSERT INTO expenses (id,description,amount,category,\`date\`,note) VALUES ${expRows.join(',')}`, expParams);
      } catch (e) {
        logger.warn('[cron recurring] INSERT failed — last_run NOT updated (will retry tomorrow):', e.message);
        return; // Don't update last_run; cron will retry next tick
      }
      // Only reached if INSERT succeeded — safe to mark as processed
      const recIds = recs.map(r => r.id);
      await pool.query(
        `UPDATE recurring_expenses SET last_run=? WHERE id IN (${recIds.map(() => '?').join(',')})`,
        [today, ...recIds]
      );
      logger.info(`[cron recurring] created ${recs.length} expense(s)`);
    }
  } catch (e) { logger.warn('[cron recurring]', e.message); }
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Structured Installment Plans ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS installment_plans (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      subscriber_id VARCHAR(100) NOT NULL,
      payment_id VARCHAR(100),
      title VARCHAR(200),
      total_amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'EGP',
      installments_count INT NOT NULL DEFAULT 3,
      paid_count INT DEFAULT 0,
      installment_amounts JSON,
      due_dates JSON,
      paid_dates JSON,
      status ENUM('active','completed','overdue','cancelled') DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200),
      KEY idx_inst_sub (subscriber_id),
      KEY idx_inst_status (status)
    )`);
    logger.info('[schema] installment_plans ready');
  } catch (e) { logger.warn('[schema installment_plans]', e.message); }
})();
router.get('/api/admin/installment-plans', requireAuth, async (req, res) => {
  try {
    const { subscriber_id, status } = req.query;
    let q = 'SELECT ip.*, s.name AS subscriber_name, s.phone AS subscriber_phone FROM installment_plans ip LEFT JOIN subscribers s ON s.id=ip.subscriber_id WHERE 1=1';
    const params = [];
    if (subscriber_id) { q += ' AND ip.subscriber_id=?'; params.push(subscriber_id); }
    if (status) { q += ' AND ip.status=?'; params.push(status); }
    q += ' ORDER BY ip.created_at DESC LIMIT 200';
    const [rows] = await pool.query(q, params);
    res.json(rows.map(r => ({ ...r, installment_amounts: tryJson(r.installment_amounts,[]), due_dates: tryJson(r.due_dates,[]), paid_dates: tryJson(r.paid_dates,[]) })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/installment-plans', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { subscriber_id, title, total_amount, currency='EGP', installments_count=3, due_dates=[], notes, payment_id } = req.body;
    if (!subscriber_id || !total_amount) return res.status(400).json({ error: 'subscriber_id and total_amount required' });
    const id = require('crypto').randomUUID();
    const per = parseFloat((total_amount / installments_count).toFixed(2));
    await pool.query('INSERT INTO installment_plans (id,subscriber_id,payment_id,title,total_amount,currency,installments_count,installment_amounts,due_dates,paid_dates,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, subscriber_id, payment_id||null, title||'خطة تقسيط', total_amount, currency, installments_count,
       JSON.stringify(Array(Number(installments_count)).fill(per)), JSON.stringify(due_dates), JSON.stringify([]), notes||null, req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/installment-plans/:id/pay', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { installment_index } = req.body;
    const [[plan]] = await pool.query(
      `SELECT id, subscriber_id, payment_id, title, total_amount, currency, installments_count,
              paid_count, installment_amounts, due_dates, paid_dates, status, notes, created_at, created_by
       FROM installment_plans WHERE id=?`, [req.params.id]
    );
    if (!plan) return res.status(404).json({ error: 'Not found' });
    const paidDates = tryJson(plan.paid_dates, []);
    paidDates[installment_index] = new Date().toISOString().slice(0, 10);
    const paidCount = paidDates.filter(Boolean).length;
    const st = paidCount >= plan.installments_count ? 'completed' : 'active';
    await pool.query('UPDATE installment_plans SET paid_dates=?,paid_count=?,status=? WHERE id=?', [JSON.stringify(paidDates), paidCount, st, req.params.id]);
    res.json({ ok: true, paid_count: paidCount, status: st });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/installment-plans/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM installment_plans WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: VAT Tracking on Expenses ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0");
    await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0");
    await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_before_vat DECIMAL(12,2) DEFAULT NULL");
    logger.info('[schema] expenses VAT columns ready');
  } catch (e) { logger.warn('[schema vat]', e.message); }
})();
// GET /api/admin/financial/vat-summary?from=&to=
router.get('/api/admin/financial/vat-summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const [[exp]] = await pool.query(`SELECT COALESCE(SUM(vat_amount),0) AS total_vat_paid, COALESCE(SUM(amount),0) AS total_expenses FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?`, [from, to]);
    const [[rev]] = await pool.query(`SELECT COALESCE(SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END),0) AS revenue FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?`, [from, to]);
    res.json({ from, to, total_vat_paid: Number(exp.total_vat_paid), total_expenses: Number(exp.total_expenses), estimated_output_vat: Math.round(rev.revenue * 0.14), vat_rate_standard: 14 });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Drip Campaigns (Lead Nurture Sequences) ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS drip_sequences (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      name VARCHAR(200) NOT NULL,
      description TEXT,
      trigger_status VARCHAR(100),
      is_active TINYINT(1) DEFAULT 1,
      steps JSON COMMENT 'Array of {delay_days, subject, body_html}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS drip_enrollments (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      sequence_id VARCHAR(36) NOT NULL,
      lead_id VARCHAR(36),
      subscriber_id VARCHAR(100),
      email VARCHAR(200) NOT NULL,
      current_step INT DEFAULT 0,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      next_send_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      unsubscribed_at TIMESTAMP NULL,
      KEY idx_drip_next (next_send_at),
      KEY idx_drip_seq (sequence_id)
    )`);
    logger.info('[schema] drip_sequences + drip_enrollments ready');
  } catch (e) { logger.warn('[schema drip]', e.message); }
})();
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

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: CSV / Excel Export ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function toCsv(rows, cols) {
  const escape = v => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };
  const header = cols.map(c => escape(c.label)).join(',');
  const body = rows.map(r => cols.map(c => escape(r[c.key])).join(',')).join('\n');
  return header + '\n' + body;
}

// GET /api/admin/export/payments?from=YYYY-MM-DD&to=YYYY-MM-DD
// (removed dead duplicate GET /api/admin/export/payments — live in an earlier-mounted router)

// GET /api/admin/export/subscribers
// (removed dead duplicate GET /api/admin/export/subscribers — live in an earlier-mounted router)

// GET /api/admin/export/leads
// (removed dead duplicate GET /api/admin/export/leads — live in an earlier-mounted router)

// GET /api/admin/export/expenses
router.get('/api/admin/export/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `SELECT id, title, amount, category, recurrence, date, notes FROM expenses WHERE tenant_id = ? AND deleted_at IS NULL AND 1=1`;
    const params = [req.tenantId];
    if (from) { sql += ' AND date >= ?'; params.push(from); }
    if (to)   { sql += ' AND date <= ?'; params.push(to); }
    sql += ' ORDER BY date DESC LIMIT 50000';
    const [rows] = await pool.query(sql, params);
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'title', label: 'البند' },
      { key: 'amount', label: 'المبلغ' },
      { key: 'category', label: 'الفئة' },
      { key: 'recurrence', label: 'التكرار' },
      { key: 'date', label: 'التاريخ' },
      { key: 'notes', label: 'ملاحظات' },
    ];
    const csv = toCsv(rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${Date.now()}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Balance Sheet ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/balance-sheet?asOf=YYYY-MM-DD
router.get('/api/admin/financial/balance-sheet', requireAuth, requireAdmin, async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);

    // Assets: total payments received up to asOf
    const [[{ totalRevenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalRevenue FROM payments WHERE status='paid' AND DATE(created_at) <= ?`, [asOf]);

    // Liabilities: outstanding balance (remaining_amount) for subscribers created up to asOf
    const [[{ totalLiabilities }]] = await pool.query(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS totalLiabilities FROM subscribers WHERE DATE(created_at) <= ? AND remaining_amount > 0`, [asOf]);

    // Expenses up to asOf
    const [[{ totalExpenses }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses WHERE deleted_at IS NULL AND DATE(date) <= ?`, [asOf]);

    // Refunds issued up to asOf
    const [[{ totalRefunds }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalRefunds FROM payments WHERE status='refunded' AND DATE(created_at) <= ?`, [asOf]).catch(() => [[{ totalRefunds: 0 }]]);

    const cashAndEquivalents = parseFloat(totalRevenue) - parseFloat(totalExpenses) - parseFloat(totalRefunds);
    const equity = cashAndEquivalents - parseFloat(totalLiabilities);

    res.json({
      asOf,
      assets: {
        cashAndEquivalents: Math.max(0, cashAndEquivalents),
        totalRevenue: parseFloat(totalRevenue),
        totalAssets: Math.max(0, cashAndEquivalents),
      },
      liabilities: {
        outstandingReceivables: parseFloat(totalLiabilities),
        totalLiabilities: parseFloat(totalLiabilities),
      },
      equity: {
        retainedEarnings: equity,
        totalEquity: equity,
      },
      summary: {
        totalRevenue: parseFloat(totalRevenue),
        totalExpenses: parseFloat(totalExpenses),
        totalRefunds: parseFloat(totalRefunds),
        netPosition: equity,
      }
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Cash Flow Statement ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/admin/financial/cash-flow', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    // Operating Inflows: payments received
    const [[{ inflows }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS inflows FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]);

    // Operating Outflows: expenses paid
    const [[{ outflows }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS outflows FROM expenses WHERE deleted_at IS NULL AND DATE(date) BETWEEN ? AND ?`, [from, to]);

    // Refunds
    const [[{ refunds }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS refunds FROM payments WHERE status='refunded' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]).catch(() => [[{ refunds: 0 }]]);

    // Monthly breakdown
    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
             SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS revenue,
             SUM(CASE WHEN status='refunded' THEN amount ELSE 0 END) AS refunds
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY month ORDER BY month`, [from, to]);

    const [monthlyExp] = await pool.query(`
      SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS expenses
      FROM expenses WHERE deleted_at IS NULL AND DATE(date) BETWEEN ? AND ?
      GROUP BY month ORDER BY month`, [from, to]);

    const expMap = Object.fromEntries(monthlyExp.map(r => [r.month, parseFloat(r.expenses)]));
    const cashFlowMonthly = monthly.map(r => ({
      month: r.month,
      revenue: parseFloat(r.revenue),
      refunds: parseFloat(r.refunds),
      expenses: expMap[r.month] || 0,
      netCashFlow: parseFloat(r.revenue) - parseFloat(r.refunds) - (expMap[r.month] || 0),
    }));

    res.json({
      period: { from, to },
      operating: {
        inflows: parseFloat(inflows),
        outflows: parseFloat(outflows),
        refunds: parseFloat(refunds),
        netOperatingCashFlow: parseFloat(inflows) - parseFloat(outflows) - parseFloat(refunds),
      },
      monthly: cashFlowMonthly,
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Sales Goals / Targets ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure sales_goals table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS sales_goals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
      revenue_target DECIMAL(12,2) DEFAULT 0,
      leads_target INT DEFAULT 0,
      conversions_target INT DEFAULT 0,
      new_clients_target INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_period (period)
    )`);
  } catch (e) { logger.warn('[sales_goals table]', e.message); }
})();

// GET /api/admin/sales-goals?period=YYYY-MM (or list all)
router.get('/api/admin/sales-goals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT id, period, revenue_target, leads_target, conversions_target, new_clients_target, created_at, updated_at FROM sales_goals';
    const params = [];
    if (period) { sql += ' WHERE period = ?'; params.push(period); }
    else sql += ' ORDER BY period DESC LIMIT 24';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sales-goals/:period  (upsert)
router.put('/api/admin/sales-goals/:period', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period } = req.params;
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' });
    const { revenue_target = 0, leads_target = 0, conversions_target = 0, new_clients_target = 0 } = req.body;
    await pool.query(`INSERT INTO sales_goals (period, revenue_target, leads_target, conversions_target, new_clients_target)
                      VALUES (?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE
                        revenue_target=VALUES(revenue_target),
                        leads_target=VALUES(leads_target),
                        conversions_target=VALUES(conversions_target),
                        new_clients_target=VALUES(new_clients_target)`,
      [period, revenue_target, leads_target, conversions_target, new_clients_target]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ── Per-staff sales targets (single source of truth across SalesGoalsTab,
//    LeadsPerformancePanel and the collection target — were localStorage before).
//    staff_id '__collection__' holds the org-wide collection monthly target. ──
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS sales_targets (
      staff_id VARCHAR(64) NOT NULL,
      period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
      revenue_target DECIMAL(12,2) DEFAULT 0,
      leads_target INT DEFAULT 0,
      updated_by VARCHAR(64) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (staff_id, period)
    ) COLLATE utf8mb4_unicode_ci`);
  } catch (e) { logger.warn('[sales_targets table]', e.message); }
})();

// GET /api/admin/sales-targets?period=YYYY-MM (omit period → recent across staff)
router.get('/api/admin/sales-targets', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT staff_id AS staffId, period, revenue_target AS revenueTarget, leads_target AS leadsTarget, updated_at AS updatedAt FROM sales_targets';
    const params = [];
    if (period) { sql += ' WHERE period = ?'; params.push(period); }
    else sql += ' ORDER BY period DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sales-targets  (upsert one {staffId, period, revenueTarget, leadsTarget})
router.post('/api/admin/sales-targets', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staffId, period } = req.body || {};
    if (!staffId || !/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'staffId and period (YYYY-MM) required' });
    // Merge: only overwrite a field that was actually sent, so two tabs writing the
    // same (staff, month) row (one sets revenue, the other leads) don't clobber.
    const [[existing]] = await pool.query('SELECT revenue_target, leads_target FROM sales_targets WHERE staff_id=? AND period=? LIMIT 1', [String(staffId).slice(0, 64), period]);
    const revenueTarget = req.body.revenueTarget !== undefined ? (Number(req.body.revenueTarget) || 0) : (existing ? Number(existing.revenue_target) : 0);
    const leadsTarget   = req.body.leadsTarget   !== undefined ? (Number(req.body.leadsTarget)   || 0) : (existing ? Number(existing.leads_target)   : 0);
    await pool.query(
      `INSERT INTO sales_targets (staff_id, period, revenue_target, leads_target, updated_by)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE revenue_target=VALUES(revenue_target), leads_target=VALUES(leads_target), updated_by=VALUES(updated_by)`,
      [String(staffId).slice(0, 64), period, revenueTarget, leadsTarget, (req.user?.id || req.user?.email || null)]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/sales-goals/vs-actual?period=YYYY-MM
router.get('/api/admin/sales-goals/vs-actual', requireAuth, requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || new Date().toISOString().slice(0, 7);
    const from = period + '-01';
    const to   = period + '-31';

    const [goalRows] = await pool.query(
      'SELECT id, period, revenue_target, leads_target, conversions_target, new_clients_target, created_at, updated_at FROM sales_goals WHERE period = ?',
      [period]
    );
    const goal = goalRows[0] || {};

    const [[{ actual_revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS actual_revenue FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]);
    const [[{ actual_leads }]] = await pool.query(
      `SELECT COUNT(*) AS actual_leads FROM leads WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]);
    const [[{ actual_conversions }]] = await pool.query(
      `SELECT COUNT(*) AS actual_conversions FROM leads WHERE status='converted' AND DATE(updated_at) BETWEEN ? AND ?`, [from, to]);
    const [[{ actual_new_clients }]] = await pool.query(
      `SELECT COUNT(*) AS actual_new_clients FROM subscribers WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]);

    res.json({
      period,
      goals: {
        revenue: parseFloat(goal.revenue_target || 0),
        leads: parseInt(goal.leads_target || 0),
        conversions: parseInt(goal.conversions_target || 0),
        new_clients: parseInt(goal.new_clients_target || 0),
      },
      actual: {
        revenue: parseFloat(actual_revenue),
        leads: parseInt(actual_leads),
        conversions: parseInt(actual_conversions),
        new_clients: parseInt(actual_new_clients),
      },
      achievement: {
        revenue_pct:      goal.revenue_target     > 0 ? Math.round(actual_revenue     / goal.revenue_target     * 100) : null,
        leads_pct:        goal.leads_target        > 0 ? Math.round(actual_leads        / goal.leads_target        * 100) : null,
        conversions_pct:  goal.conversions_target  > 0 ? Math.round(actual_conversions  / goal.conversions_target  * 100) : null,
        new_clients_pct:  goal.new_clients_target  > 0 ? Math.round(actual_new_clients  / goal.new_clients_target  * 100) : null,
      }
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
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
             l.follow_up_date, l.created_at, l.lead_type,
             st.name AS assigned_staff,
             (SELECT COUNT(*) FROM lead_communications lc WHERE lc.lead_id = l.id) AS comm_count
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_to
      WHERE l.status NOT IN ('converted','lost','junk')
      ORDER BY l.created_at DESC LIMIT 1000`);

    const now = Date.now();
    const scored = leads.map(l => {
      let score = 0;
      if (l.phone)  score += 30;
      if (l.email)  score += 10;
      if (l.status === 'interested')  score += 20;
      else if (l.status === 'follow_up') score += 10;
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
             l.follow_up_date, l.created_at, l.enrolled_course_id,
             (SELECT COUNT(*) FROM lead_communications lc WHERE lc.lead_id = l.id) AS comm_count
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
             l.score, l.interest_level, l.follow_up_date, l.created_at,
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

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Cohort Analysis ───────────────────────────────────────────────
// GET /api/admin/analytics/cohorts?year=2026&months=6
//
// Returns subscriber cohorts grouped by registration month.
// For each cohort: how many made their first payment, and how many
// remained active in months 1..N after registration.
//
// Response:
//   { cohorts: [ { month, newSubs, firstPayment, retentionByMonth: [n1,n2,...] } ] }
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/analytics/cohorts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const year   = parseInt(req.query.year  || new Date().getFullYear());
    const months = Math.min(12, Math.max(1, parseInt(req.query.months || 6)));

    // Step 1: All subscribers + their first payment month
    const [subs] = await pool.query(`
      SELECT s.id,
             DATE_FORMAT(s.created_at, '%Y-%m')  AS cohort_month,
             MIN(DATE_FORMAT(p.date,   '%Y-%m'))  AS first_pay_month
      FROM subscribers s
      LEFT JOIN payments p
        ON p.subscriber_id = s.id
        AND p.status IN ('paid','confirmed')
      WHERE YEAR(s.created_at) = ?
      GROUP BY s.id, cohort_month
      ORDER BY cohort_month ASC
    `, [year]);

    // Step 2: All (subscriber, pay_month) pairs relevant to this year + next
    const [payMonths] = await pool.query(`
      SELECT p.subscriber_id,
             DATE_FORMAT(p.date, '%Y-%m') AS pay_month
      FROM payments p
      WHERE p.status IN ('paid','confirmed')
        AND YEAR(p.date) BETWEEN ? AND ?
      GROUP BY p.subscriber_id, pay_month
    `, [year, year + 1]);

    const paySet = new Map(); // subId → Set<pay_month>
    for (const row of payMonths) {
      if (!paySet.has(row.subscriber_id)) paySet.set(row.subscriber_id, new Set());
      paySet.get(row.subscriber_id).add(row.pay_month);
    }

    // Step 3: Build cohort matrix — one entry per calendar month in the year
    const cohortMap = new Map();
    for (const sub of subs) {
      const cm = sub.cohort_month;
      if (!cohortMap.has(cm)) cohortMap.set(cm, []);
      cohortMap.get(cm).push({ id: sub.id, first_pay_month: sub.first_pay_month });
    }

    const result = [];
    for (let m = 0; m < 12; m++) {
      const cm = `${year}-${String(m + 1).padStart(2, '0')}`;
      const cohortSubs   = cohortMap.get(cm) || [];
      const newSubs      = cohortSubs.length;
      const firstPayment = cohortSubs.filter(s => s.first_pay_month === cm).length;

      // Retention[offset]: how many cohort members paid in month (cm + offset)
      const retentionByMonth = [];
      for (let offset = 0; offset < months; offset++) {
        const absMonth  = m + offset;
        const tYear     = year + Math.floor(absMonth / 12);
        const tMonthNum = (absMonth % 12) + 1;
        const target    = `${tYear}-${String(tMonthNum).padStart(2, '0')}`;
        const count     = cohortSubs.filter(s => paySet.get(s.id)?.has(target)).length;
        retentionByMonth.push(count);
      }
      result.push({ month: cm, newSubs, firstPayment, retentionByMonth });
    }

    res.json({ year, months, cohorts: result });
  } catch (e) { logger.error('[cohorts]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE: Manager KPI Summary Dashboard ────────────────────────────────
// GET /api/admin/kpi/summary
// Returns today + week + month revenue, lead counts, subscriber counts,
// top staff performers, and system health indicators.
// ══════════════════════════════════════════════════════════════════════════════
router.get('/api/admin/kpi/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now     = new Date();
    const today   = now.toISOString().slice(0, 10);
    const weekAgo = new Date(+now - 7  * 86400000).toISOString().slice(0, 10);
    const monAgo  = new Date(+now - 30 * 86400000).toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const prevMonthStart = (() => {
      const d = new Date(now); d.setMonth(d.getMonth() - 1); d.setDate(1);
      return d.toISOString().slice(0, 10);
    })();

    const [[todayRev]]  = await pool.query(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE DATE(date)=? AND status='paid'`, [today]);
    const [[weekRev]]   = await pool.query(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE date>=? AND status='paid'`, [weekAgo]);
    const [[monthRev]]  = await pool.query(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE date>=? AND status='paid'`, [monthStart]);
    const [[prevMonRev]]= await pool.query(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE date>=? AND date<? AND status='paid'`, [prevMonthStart, monthStart]);
    const [[todayLeads]]= await pool.query(`SELECT COUNT(*) AS v FROM leads WHERE DATE(created_at)=?`, [today]);
    const [[weekLeads]] = await pool.query(`SELECT COUNT(*) AS v FROM leads WHERE created_at>=?`, [weekAgo]);
    const [[totalSubs]] = await pool.query(`SELECT COUNT(*) AS v FROM subscribers`);
    const [[newSubs7]]  = await pool.query(`SELECT COUNT(*) AS v FROM subscribers WHERE created_at>=?`, [weekAgo]);
    const [[activeSubs]]= await pool.query(`SELECT COUNT(*) AS v FROM subscribers WHERE is_active=1`);
    const [[openTickets]]= await pool.query(`SELECT COUNT(*) AS v FROM support_tickets WHERE status IN ('open','in_progress')`).catch(() => [[{ v: 0 }]]);
    const [[pendingRefunds]]= await pool.query(`SELECT COUNT(*) AS v FROM refund_requests WHERE status='PENDING'`).catch(() => [[{ v: 0 }]]);

    const [topStaff] = await pool.query(
      `SELECT s.name, s.role, COALESCE(SUM(c.commission_amount),0) AS earned, COUNT(*) AS deals
       FROM crm_commissions c
       LEFT JOIN staff s ON s.id=c.staff_id
       WHERE c.created_at>=?
       GROUP BY c.staff_id ORDER BY earned DESC LIMIT 5`, [monAgo]
    ).catch(() => [[]]);

    const [revenueByDay] = await pool.query(
      `SELECT DATE(date) AS day, COALESCE(SUM(amount),0) AS revenue
       FROM payments WHERE date>=? AND status='paid'
       GROUP BY day ORDER BY day ASC`, [weekAgo]
    ).catch(() => [[]]);

    const [leadsByDay] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM leads WHERE created_at>=?
       GROUP BY day ORDER BY day ASC`, [weekAgo]
    ).catch(() => [[]]);

    const monthChange = prevMonRev.v > 0
      ? Math.round(((monthRev.v - prevMonRev.v) / prevMonRev.v) * 100)
      : null;

    res.json({
      revenue: {
        today:       Number(todayRev.v),
        week:        Number(weekRev.v),
        month:       Number(monthRev.v),
        prevMonth:   Number(prevMonRev.v),
        monthChange,
      },
      leads: {
        today: Number(todayLeads.v),
        week:  Number(weekLeads.v),
      },
      subscribers: {
        total:  Number(totalSubs.v),
        active: Number(activeSubs.v),
        newThis7Days: Number(newSubs7.v),
      },
      alerts: {
        openTickets:    Number(openTickets.v),
        pendingRefunds: Number(pendingRefunds.v),
      },
      topStaff: topStaff.map(s => ({
        name:    s.name || 'غير معروف',
        role:    s.role || '',
        earned:  Number(s.earned),
        deals:   Number(s.deals),
      })),
      revenueByDay:  revenueByDay.map(r => ({ day: r.day?.toISOString?.()?.slice(0,10) || r.day, revenue: Number(r.revenue) })),
      leadsByDay:    leadsByDay.map(r => ({ day: r.day?.toISOString?.()?.slice(0,10) || r.day, count: Number(r.count) })),
      generatedAt: now.toISOString(),
    });
  } catch (e) { logger.error('[kpi/summary]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
