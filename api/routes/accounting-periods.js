'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'accounting-periods-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

function routeError(res, error, message = 'periods route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/api/admin/accounting-periods', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM accounting_periods ORDER BY opened_at DESC LIMIT 100');
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/accounting-periods', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[existing]] = await pool.query("SELECT id FROM accounting_periods WHERE status='open' LIMIT 1");
    if (existing) return res.status(409).json({ error: 'يوجد فترة مفتوحة بالفعل. أغلقها أولاً.' });
    const label = req.body.label || new Date().toISOString().slice(0, 7);
    const id = uuidv4();
    await pool.query(
      `INSERT INTO accounting_periods (id, period_label, status) VALUES (?, ?, 'open')`,
      [id, label]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/accounting-periods/:id/close', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user?.email || req.user?.name || 'admin';
    const [[period]] = await pool.query('SELECT * FROM accounting_periods WHERE id=? LIMIT 1', [id]);
    if (!period) return res.status(404).json({ error: 'Period not found' });
    if (period.status === 'closed') return res.status(409).json({ error: 'Already closed' });
    const startDate = period.period_label + '-01';
    const [endDateRow] = await pool.query(
      `SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL 1 MONTH), '%Y-%m-01') AS end_date`,
      [startDate]
    );
    const endDate = endDateRow[0]?.end_date || startDate;
    const [pmts] = await pool.query(
      `SELECT SUM(amount) AS total, currency, COUNT(*) AS count
       FROM payments WHERE status='paid'
         AND created_at >= ? AND created_at < ?
       GROUP BY currency`,
      [startDate, endDate]
    );
    const [exps] = await pool.query(
      `SELECT SUM(amount) AS total, currency FROM expenses
       WHERE date >= ? AND date < ?
       GROUP BY currency`,
      [startDate, endDate]
    ).catch(() => [[]]);
    const summary = { revenues: pmts, expenses: exps, closedBy: actor, closedAt: new Date().toISOString() };
    await pool.query(
      `UPDATE accounting_periods SET status='closed', closed_at=NOW(), closed_by=?, summary_json=? WHERE id=?`,
      [actor, JSON.stringify(summary), id]
    );
    res.json({ ok: true, summary });
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/accounting-periods/:id/reopen', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE accounting_periods SET status='open', closed_at=NULL, closed_by=NULL WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

module.exports = router;
