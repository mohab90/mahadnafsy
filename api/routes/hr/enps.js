'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, requireAuth, requireAdminOrStaff, _resolveStaffByUser } = require('./_shared');

const enpsPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const MIN_ANONYMOUS_COHORT = 5;

// Staff: my eNPS status for the current period
router.get('/api/staff/me/enps', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff only' });
    const [[row]] = await pool.query(
      'SELECT id, score FROM enps_responses WHERE tenant_id=? AND staff_id=? AND period=? LIMIT 1',
      [req.tenantId, staff.id, enpsPeriod()]
    );
    res.json({ period: enpsPeriod(), responded: !!row, score: row ? row.score : null });
  } catch (e) { logger.error('[hr/enps]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Staff: submit eNPS for the current period (one per staff per period, editable)
router.post('/api/staff/me/enps', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff only' });
    const { score, comment } = req.body;
    if (score === undefined || score === null) return res.status(400).json({ error: 'score required' });
    const numScore = Number(score);
    if (!Number.isInteger(numScore) || numScore < 0 || numScore > 10) {
      return res.status(400).json({ error: 'score must be an integer from 0 to 10' });
    }
    await pool.query(
      `INSERT INTO enps_responses (id, tenant_id, staff_id, score, comment, period) VALUES (UUID(),?,?,?,?,?)
       ON DUPLICATE KEY UPDATE score=VALUES(score), comment=VALUES(comment)`,
      [req.tenantId, staff.id, numScore, comment ? String(comment).slice(0, 2000) : null, enpsPeriod()]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[hr/enps]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: eNPS aggregate + anonymized comments (individual identity withheld by design)
router.get('/api/admin/hr/enps', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const period = req.query.period || enpsPeriod();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: 'period must be YYYY-MM' });
    }
    const [[agg]] = await pool.query(
      `SELECT COUNT(*) total, AVG(score) avg_score, SUM(score>=9) promoters,
              SUM(score BETWEEN 7 AND 8) passives, SUM(score<=6) detractors
         FROM enps_responses WHERE tenant_id=? AND period=?`,
      [req.tenantId, period]
    );
    const total = Number(agg.total) || 0;
    const protectedCohort = total < MIN_ANONYMOUS_COHORT;
    const enps = protectedCohort ? null : Math.round(((agg.promoters - agg.detractors) / total) * 100);
    const [comments] = protectedCohort ? [[]] : await pool.query(
      `SELECT comment,period FROM enps_responses
        WHERE tenant_id=? AND period=? AND comment IS NOT NULL AND comment <> ''
        LIMIT 200`,
      [req.tenantId, period]
    );
    const [periods] = await pool.query(
      'SELECT DISTINCT period FROM enps_responses WHERE tenant_id=? ORDER BY period DESC LIMIT 24', [req.tenantId]
    );
    res.json({
      period,
      enps,
      total,
      avg: protectedCohort ? null : parseFloat((+agg.avg_score).toFixed(1)),
      promoters: protectedCohort ? null : Number(agg.promoters) || 0,
      passives: protectedCohort ? null : Number(agg.passives) || 0,
      detractors: protectedCohort ? null : Number(agg.detractors) || 0,
      comments,
      privacySuppressed: protectedCohort,
      minimumCohort: MIN_ANONYMOUS_COHORT,
      periods: periods.map(p => p.period),
    });
  } catch (e) { logger.error('[hr/enps]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
