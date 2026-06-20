'use strict';
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { safeDateOnly } = require('../lib/dates');
const { sanitize } = require('../lib/helpers');

// ─────────────────────────────────────────────────────────────────────────────

// Public: register to waitlist
router.post('/api/waitlist', publicLimiter, async (req, res) => {
  try {
    const { name, phone, email, courseId, courseName, notes, branch } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });
    const { sanitize } = require('../lib/helpers');
    const safeName   = sanitize(name,  200);
    const safePhone  = sanitize(phone, 50);
    const safeEmail  = sanitize(email || '', 200) || null;
    const safeCourse = sanitize(courseName || '', 200) || null;
    const safeNotes  = sanitize(notes || '', 1000) || null;
    const branchVal  = ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(branch) ? branch : 'DAQQI';
    const { uuidv4 } = require('../lib/id');
    const id = uuidv4();
    await pool.query(
      `INSERT INTO daqqi_waitlist (id, name, phone, email, course_id, course_name, notes, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, safeName, safePhone, safeEmail, courseId || null, safeCourse, safeNotes, branchVal]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: list waitlist
router.get('/api/admin/waitlist', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const branch = req.query.branch || '';
    const status = req.query.status || '';
    let sql = 'SELECT * FROM daqqi_waitlist WHERE 1=1';
    const params = [];
    if (branch) { sql += ' AND branch=?'; params.push(branch); }
    if (status) { sql += ' AND status=?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: update waitlist entry status
router.patch('/api/admin/waitlist/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body || {};
    const allowed = ['waiting','contacted','enrolled','cancelled'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const sets = [];
    const params = [];
    if (status) { sets.push('status=?'); params.push(status); }
    if (notes !== undefined) { sets.push('notes=?'); params.push(notes); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    await pool.query(`UPDATE daqqi_waitlist SET ${sets.join(', ')} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { console.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Accounting Periods (Period Closing) ──────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/admin/accounting-periods', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM accounting_periods ORDER BY opened_at DESC LIMIT 100');
    res.json(rows);
  } catch (e) { console.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/accounting-periods', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Ensure no other open period exists
    const [[existing]] = await pool.query("SELECT id FROM accounting_periods WHERE status='open' LIMIT 1");
    if (existing) return res.status(409).json({ error: 'يوجد فترة مفتوحة بالفعل. أغلقها أولاً.' });
    const label = req.body.label || new Date().toISOString().slice(0, 7); // YYYY-MM
    const { uuidv4 } = require('../lib/id');
    const id = uuidv4();
    await pool.query(
      `INSERT INTO accounting_periods (id, period_label, status) VALUES (?, ?, 'open')`,
      [id, label]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/accounting-periods/:id/close', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user?.email || req.user?.name || 'admin';
    // Build a revenue snapshot from payments table
    const [[period]] = await pool.query('SELECT * FROM accounting_periods WHERE id=? LIMIT 1', [id]);
    if (!period) return res.status(404).json({ error: 'Period not found' });
    if (period.status === 'closed') return res.status(409).json({ error: 'Already closed' });
    const startDate = period.period_label + '-01';
    // End = first day of next month
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
  } catch (e) { console.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/accounting-periods/:id/reopen', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE accounting_periods SET status='open', closed_at=NULL, closed_by=NULL WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) { console.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


module.exports = router;
