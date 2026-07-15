'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'staff-route' });

function routeError(res, error, message = 'route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff } = require('../middleware/auth');

router.post('/api/admin/staff', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    const role = ((s.role || 'other').toUpperCase());
    const firebaseUid = s.firebaseUid || s.firebase_uid || null;
    const joinedAt = s.joinedAt || s.joined_at || new Date().toISOString();
    const commissionRate = s.commissionRate || s.commission_rate || null;
    const isActive = s.is_active !== undefined ? s.is_active : (s.status === 'inactive' ? 0 : 1);
    const permissionsJson = s.permissions_json
      || (Array.isArray(s.permissions) ? JSON.stringify(s.permissions) : null);

    await pool.query(
      `INSERT INTO staff (id, firebase_uid, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, permissions_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), image=VALUES(image), is_active=VALUES(is_active), notes=VALUES(notes), commission_rate=VALUES(commission_rate), permissions_json=VALUES(permissions_json)`,
      [id, firebaseUid, s.name || '', s.email || '', s.phone || '', role, s.image || null, s.specialization || null, joinedAt, isActive, s.notes || null, commissionRate, permissionsJson]
    );
    res.json({ ok: true, id });
  } catch (e) {
    routeError(res, e);
  }
});

router.get('/api/admin/staff', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const isAdminUser = req.isAdmin === true;
    const [rows] = await pool.query(
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff ORDER BY name ASC'
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name || '',
      email: isAdminUser ? (r.email || '') : '',
      phone: isAdminUser ? (r.phone || '') : '',
      role: (r.role || 'other').toLowerCase(),
      status: r.is_active ? 'active' : 'inactive',
      image: r.image || null,
      specialization: r.specialization || null,
      joinedAt: r.joined_at || r.created_at || null,
      firebaseUid: isAdminUser ? (r.firebase_uid || null) : null,
      commissionRate: isAdminUser ? (r.commission_rate || null) : null,
      notes: isAdminUser ? (r.notes || null) : null,
      permissions: isAdminUser ? (r.permissions_json ? tryJson(r.permissions_json, []) : []) : [],
    })));
  } catch (e) {
    routeError(res, e);
  }
});

router.get('/api/staff/me', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [rows] = await pool.query(
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [email]
    );
    if (!rows.length) return res.json(null);
    const r = rows[0];
    res.json({
      id: r.id,
      name: r.name || '',
      email: r.email || '',
      phone: r.phone || '',
      role: (r.role || 'other').toLowerCase(),
      status: r.is_active ? 'active' : 'inactive',
      image: r.image || null,
      specialization: r.specialization || null,
      joinedAt: r.joined_at || r.created_at || null,
      firebaseUid: r.firebase_uid || null,
      commissionRate: r.commission_rate || null,
      notes: r.notes || null,
      permissions: r.permissions_json ? tryJson(r.permissions_json, []) : [],
    });
  } catch (e) {
    routeError(res, e);
  }
});

router.patch('/api/staff/me', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const { name, phone, image } = req.body || {};
    const fields = [];
    const vals = [];
    if (name !== undefined && typeof name === 'string') { fields.push('name = ?'); vals.push(name.slice(0, 120)); }
    if (phone !== undefined && typeof phone === 'string') { fields.push('phone = ?'); vals.push(phone.slice(0, 30)); }
    if (image !== undefined && (image === null || typeof image === 'string')) { fields.push('image = ?'); vals.push(image ? image.slice(0, 500) : null); }
    if (fields.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    vals.push(email);
    await pool.query(`UPDATE staff SET ${fields.join(', ')} WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ?`, vals);
    res.json({ ok: true });
  } catch (e) {
    routeError(res, e);
  }
});

router.delete('/api/admin/staff/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM staff WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    routeError(res, e);
  }
});

module.exports = router;
