'use strict';
/**
 * Conversion funnel (business visibility). Aggregates each stage of the customer
 * journey and the drop-off between stages so the owner can *see* where money
 * leaks. Every probe is guarded so one missing table never fails the response.
 */
const { CONVERTED_SQL, TERMINAL_SQL } = require('../lib/leadStatuses');
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { pool, cached } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

const n = async (sql, params = []) => {
  try { const [[r]] = await pool.query(sql, params); return Number(Object.values(r)[0]) || 0; }
  catch { return 0; }
};

router.get('/api/admin/funnel', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const { from, to, branch } = req.query;
    const br = branch && branch !== 'all' ? String(branch).toUpperCase() : null;
    // One lead cohort owns every stage. Mixing lead-created dates with payment
    // dates and all-time LMS rows used to produce attractive but false rates.
    const range = (col) => { const c = [], p = []; if (from) { c.push(`${col} >= ?`); p.push(from); } if (to) { c.push(`${col} < DATE_ADD(?, INTERVAL 1 DAY)`); p.push(to); } return { c, p }; };
    const lr = range('l.created_at');
    const lw = ['l.tenant_id=?', 'l.hidden=0', ...lr.c, ...(br ? ['l.branch=?'] : [])].join(' AND ');
    const lp = [req.tenantId, ...lr.p, ...(br ? [br] : [])];
    const data = await cached(`funnel:${req.tenantId}:${from || ''}:${to || ''}:${br || 'all'}`, 5 * 60 * 1000, async () => {
      const [leads, contacted, interested, converted, subscribers, paying, learners, certified, revenue] = await Promise.all([
        n(`SELECT COUNT(*) FROM leads l WHERE ${lw}`, lp),
        n(`SELECT COUNT(*) FROM leads l WHERE ${lw} AND l.status <> 'new'`, lp),
        n(`SELECT COUNT(*) FROM leads l WHERE ${lw}
            AND (l.status IN ('interested','interested_booking','interested_followup','converted','won')
              OR l.interest_level='HIGH')`, lp),
        n(`SELECT COUNT(*) FROM leads l WHERE ${lw} AND l.status IN ${CONVERTED_SQL}`, lp),
        n(`SELECT COUNT(DISTINCT s.id) FROM leads l
            JOIN subscribers s ON s.lead_id=l.id AND s.tenant_id=l.tenant_id
            WHERE ${lw}`, lp),
        n(`SELECT COUNT(DISTINCT l.id) FROM leads l
            JOIN subscribers s ON s.lead_id=l.id AND s.tenant_id=l.tenant_id
            JOIN payments p ON p.subscriber_id=s.id AND p.tenant_id=s.tenant_id
              AND p.status='paid' AND p.deleted_at IS NULL
            WHERE ${lw}`, lp),
        n(`SELECT COUNT(DISTINCT l.id) FROM leads l
            JOIN subscribers s ON s.lead_id=l.id AND s.tenant_id=l.tenant_id
            JOIN lecture_completions lc ON lc.subscriber_id=s.id AND lc.tenant_id=s.tenant_id
            WHERE ${lw}`, lp),
        n(`SELECT COUNT(DISTINCT l.id) FROM leads l
            JOIN subscribers s ON s.lead_id=l.id AND s.tenant_id=l.tenant_id
            JOIN course_completions cc ON cc.subscriber_id=s.id AND cc.tenant_id=s.tenant_id AND cc.status='active'
            WHERE ${lw}`, lp),
        n(`SELECT COALESCE(SUM(p.amount_egp),0) FROM leads l
            JOIN subscribers s ON s.lead_id=l.id AND s.tenant_id=l.tenant_id
            JOIN payments p ON p.subscriber_id=s.id AND p.tenant_id=s.tenant_id
              AND p.status='paid' AND p.deleted_at IS NULL
            WHERE ${lw}`, lp),
      ]);
      const stages = [
        { key: 'leads', label: 'عملاء محتملون', value: leads },
        { key: 'contacted', label: 'تم التواصل', value: contacted },
        { key: 'interested', label: 'مهتمّون', value: interested },
        { key: 'paying', label: 'دفعوا', value: paying },
        { key: 'learners', label: 'بدأوا التعلّم', value: learners },
        { key: 'certified', label: 'حصلوا على شهادة', value: certified },
      ];
      // rate vs first stage + step drop-off
      const top = stages[0].value || 1;
      stages.forEach((s, i) => {
        s.pctOfTop = Math.round((s.value / top) * 100);
        s.stepPct = i === 0 ? 100 : Math.round((s.value / (stages[i - 1].value || 1)) * 100);
        s.dropoff = i === 0 ? 0 : Math.max(0, (stages[i - 1].value || 0) - s.value);
      });
      // biggest leak
      let worst = null;
      for (let i = 1; i < stages.length; i++) {
        if (!worst || stages[i].stepPct < worst.stepPct) worst = { from: stages[i - 1].label, to: stages[i].label, stepPct: stages[i].stepPct, dropoff: stages[i].dropoff };
      }
      return {
        stages, subscribers, converted, revenueEGP: revenue,
        biggestLeak: worst,
        filters: { from: from || null, to: to || null, branch: br || 'all' },
        generatedAt: new Date().toISOString(),
      };
    });
    res.json(data);
  } catch (e) { logger.error('[funnel]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Conversion ATTRIBUTION — which lead source (or salesperson) turns into
// subscriptions + revenue. Answers "where does our money actually come from?".
// GET /api/admin/funnel/attribution?by=source|sales&from&to
router.get('/api/admin/funnel/attribution', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const by = req.query.by === 'sales' ? 'sales' : 'source';
    const { from, to } = req.query;
    const c = ['l.tenant_id=?', 'l.hidden=0']; const p = [req.tenantId];
    if (from) { c.push('l.created_at >= ?'); p.push(from); }
    if (to) { c.push('l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); p.push(to); }
    const where = c.join(' AND ');
    const groupCol = by === 'sales' ? 'st.name' : "COALESCE(NULLIF(TRIM(l.source),''),'(غير محدد)')";
    const salesJoin = by === 'sales' ? 'LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id=l.tenant_id' : '';
    const data = await cached(`attribution:${req.tenantId}:${by}:${from || ''}:${to || ''}`, 5 * 60 * 1000, async () => {
      // Two reads merged here, not one three-table join: one join of leads, clients and payments, grouped
      // by label took 5-8 s at 600,000 leads (every lead, bought or not, went through the join), against 0.8 s for
      // the leads counted alone plus the 20,000 leads that have a client. Same figures: a lead is counted once,
      // and a payment once per (lead, client) as before.
      const [[leadRows], [buyerRows]] = await Promise.all([
        pool.query(
          `SELECT ${groupCol} AS label,
                  COUNT(*) AS leads,
                  SUM(l.status='converted') AS converted
             FROM leads l
             ${salesJoin}
            WHERE l.tenant_id=? AND ${c.slice(1).join(' AND ')}
            GROUP BY label`, p),
        pool.query(
          `SELECT ${groupCol} AS label,
                  COUNT(DISTINCT s.id) AS subscribers,
                  COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount_egp END),0) AS revenue
             FROM subscribers s
             JOIN leads l ON l.id = s.lead_id AND l.tenant_id = s.tenant_id
             ${salesJoin}
             LEFT JOIN payments p ON p.subscriber_id = s.id AND p.tenant_id=l.tenant_id AND p.deleted_at IS NULL
            WHERE ${where}
            GROUP BY label`, p),
      ]);
      const buyers = new Map(buyerRows.map(r => [r.label ?? '', r]));
      const rows = leadRows
        .map(r => ({ ...r, subscribers: buyers.get(r.label ?? '')?.subscribers || 0, revenue: buyers.get(r.label ?? '')?.revenue || 0 }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue) || Number(b.leads) - Number(a.leads))
        .slice(0, 40);
      const totalRev = rows.reduce((a, r) => a + Number(r.revenue || 0), 0) || 1;
      return rows.map(r => ({
        label: r.label || '(غير محدد)',
        leads: Number(r.leads || 0),
        converted: Number(r.converted || 0),
        subscribers: Number(r.subscribers || 0),
        revenue: Number(r.revenue || 0),
        convRate: Number(r.leads) ? Math.round((Number(r.converted) / Number(r.leads)) * 100) : 0,
        revShare: Math.round((Number(r.revenue || 0) / totalRev) * 100),
      }));
    });
    res.json({ by, rows: data, filters: { from: from || null, to: to || null } });
  } catch (e) { logger.error('[attribution]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
