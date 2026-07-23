'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool, cached } = require('../../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../../middleware/auth');

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
    ] = await cached(`dashboard_kpi_${req.tenantId}_${curM}`, 30000, () => Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN DATE_FORMAT(date,'%Y-%m')=? THEN amount_egp END),0) AS this_month,
          COALESCE(SUM(CASE WHEN DATE_FORMAT(date,'%Y-%m')=? THEN amount_egp END),0) AS last_month,
          COALESCE(SUM(amount_egp),0) AS all_time
        FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed')`, [curM, prevM, req.tenantId]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS this_month,
          SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS last_month,
          SUM(CASE WHEN status NOT IN ('lost','junk','converted') THEN 1 ELSE 0 END) AS active
        FROM leads WHERE tenant_id=? AND hidden=0`, [curM, prevM, req.tenantId]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS this_month
        FROM subscribers WHERE tenant_id=?`, [curM, req.tenantId]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN DATE_FORMAT(enrolled_at,'%Y-%m')=? THEN 1 ELSE 0 END) AS this_month
        FROM enrollments WHERE tenant_id=? AND status NOT IN ('cancelled','refunded')`, [curM, req.tenantId]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
        FROM consultations WHERE tenant_id=?`, [req.tenantId]),
      pool.query('SELECT COUNT(*) AS total FROM course_completions WHERE tenant_id=?', [req.tenantId]),
      pool.query("SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND DATE(created_at)=CURDATE() AND hidden=0", [req.tenantId]),
      pool.query("SELECT COUNT(*) AS n FROM subscribers WHERE tenant_id=? AND DATE(created_at)=CURDATE()", [req.tenantId]),
      pool.query("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND status='pending'", [req.tenantId]),
      pool.query("SELECT COUNT(*) AS n FROM leaves WHERE tenant_id=? AND status='PENDING'", [req.tenantId]).catch(() => [[{n:0}]]),
      pool.query("SELECT COUNT(*) AS n FROM forum_posts WHERE tenant_id=? AND is_hidden=0", [req.tenantId]).catch(() => [[{n:0}]]),
      pool.query("SELECT COUNT(*) AS n FROM course_waitlist WHERE tenant_id=? AND status='waiting'", [req.tenantId]).catch(() => [[{n:0}]]),
    ]));

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
        ON p.subscriber_id = s.id AND p.tenant_id=s.tenant_id
        AND p.status IN ('paid','confirmed')
      WHERE s.tenant_id=? AND YEAR(s.created_at) = ?
      GROUP BY s.id, cohort_month
      ORDER BY cohort_month ASC
    `, [req.tenantId, year]);

    // Step 2: All (subscriber, pay_month) pairs relevant to this year + next
    const [payMonths] = await pool.query(`
      SELECT p.subscriber_id,
             DATE_FORMAT(p.date, '%Y-%m') AS pay_month
      FROM payments p
      WHERE p.tenant_id=? AND p.status IN ('paid','confirmed')
        AND YEAR(p.date) BETWEEN ? AND ?
      GROUP BY p.subscriber_id, pay_month
    `, [req.tenantId, year, year + 1]);

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

    const [[todayRev]]  = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS v FROM payments WHERE tenant_id=? AND DATE(date)=? AND status='paid'`, [req.tenantId, today]);
    const [[weekRev]]   = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS v FROM payments WHERE tenant_id=? AND date>=? AND status='paid'`, [req.tenantId, weekAgo]);
    const [[monthRev]]  = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS v FROM payments WHERE tenant_id=? AND date>=? AND status='paid'`, [req.tenantId, monthStart]);
    const [[prevMonRev]]= await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS v FROM payments WHERE tenant_id=? AND date>=? AND date<? AND status='paid'`, [req.tenantId, prevMonthStart, monthStart]);
    const [[todayLeads]]= await pool.query(`SELECT COUNT(*) AS v FROM leads WHERE tenant_id=? AND DATE(created_at)=?`, [req.tenantId, today]);
    const [[weekLeads]] = await pool.query(`SELECT COUNT(*) AS v FROM leads WHERE tenant_id=? AND created_at>=?`, [req.tenantId, weekAgo]);
    const [[totalSubs]] = await pool.query(`SELECT COUNT(*) AS v FROM subscribers WHERE tenant_id=?`, [req.tenantId]);
    const [[newSubs7]]  = await pool.query(`SELECT COUNT(*) AS v FROM subscribers WHERE tenant_id=? AND created_at>=?`, [req.tenantId, weekAgo]);
    const [[activeSubs]]= await pool.query(`SELECT COUNT(*) AS v FROM subscribers WHERE tenant_id=? AND is_active=1`, [req.tenantId]);
    const [[openTickets]]= await pool.query(`SELECT COUNT(*) AS v FROM support_tickets WHERE tenant_id=? AND status IN ('open','in_progress')`, [req.tenantId]).catch(() => [[{ v: 0 }]]);
    const [[pendingRefunds]]= await pool.query(`SELECT COUNT(*) AS v FROM refund_requests WHERE tenant_id=? AND status='PENDING'`, [req.tenantId]).catch(() => [[{ v: 0 }]]);

    const [topStaff] = await pool.query(
      `SELECT s.name, s.role, COALESCE(SUM(c.commission_amount),0) AS earned, COUNT(*) AS deals
       FROM crm_commissions c
       LEFT JOIN staff s ON s.id=c.staff_id AND s.tenant_id=c.tenant_id
       WHERE c.tenant_id=? AND c.created_at>=?
       GROUP BY c.staff_id ORDER BY earned DESC LIMIT 5`, [req.tenantId, monAgo]
    ).catch(() => [[]]);

    const [revenueByDay] = await pool.query(
      `SELECT DATE(date) AS day, COALESCE(SUM(amount_egp),0) AS revenue
       FROM payments WHERE tenant_id=? AND date>=? AND status='paid'
       GROUP BY day ORDER BY day ASC`, [req.tenantId, weekAgo]
    ).catch(() => [[]]);

    const [leadsByDay] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM leads WHERE tenant_id=? AND created_at>=?
       GROUP BY day ORDER BY day ASC`, [req.tenantId, weekAgo]
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
