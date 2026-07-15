'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'waitlist-route' });
const { pool } = require('../lib/db');
const { sanitize } = require('../lib/helpers');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdminOrStaff } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');

function routeError(res, error, message = 'waitlist route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.post('/api/waitlist', publicLimiter, async (req, res) => {
  try {
    const { name, phone, email, courseId, courseName, notes, branch } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });
    const safeName = sanitize(name, 200);
    const safePhone = sanitize(phone, 50);
    const safeEmail = sanitize(email || '', 200) || null;
    const safeCourse = sanitize(courseName || '', 200) || null;
    const safeNotes = sanitize(notes || '', 1000) || null;
    const branchVal = ['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD', 'OTHER'].includes(branch) ? branch : 'DAQQI';
    const id = uuidv4();
    await pool.query(
      `INSERT INTO daqqi_waitlist (id, name, phone, email, course_id, course_name, notes, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, safeName, safePhone, safeEmail, courseId || null, safeCourse, safeNotes, branchVal]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

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
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/waitlist/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body || {};
    const allowed = ['waiting', 'contacted', 'enrolled', 'cancelled'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const sets = [];
    const params = [];
    if (status) { sets.push('status=?'); params.push(status); }
    if (notes !== undefined) { sets.push('notes=?'); params.push(notes); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    await pool.query(`UPDATE daqqi_waitlist SET ${sets.join(', ')} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

module.exports = router;
