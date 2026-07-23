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
const { hasPermission, PERMISSIONS } = require('../constants/permissions');

router.post('/api/admin/staff', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    const role = ((s.role || 'other').toUpperCase());
    const firebaseUid = s.firebaseUid || s.firebase_uid || null;
    // Normalise to a MySQL DATETIME literal — a raw ISO string ('...T...Z') is
    // rejected by DATETIME columns, which 500'd staff creation when no date was supplied.
    const joinedAt = String(s.joinedAt || s.joined_at || new Date().toISOString()).slice(0, 19).replace('T', ' ');
    const commissionRate = s.commissionRate || s.commission_rate || null;
    const isActive = s.is_active !== undefined ? s.is_active : (s.status === 'inactive' ? 0 : 1);
    const permissionsJson = s.permissions_json
      || (Array.isArray(s.permissions) ? JSON.stringify(s.permissions) : null);
    // Sales-target / bonus fields (camelCase from frontend or snake_case direct).
    // `undefined` is coalesced to null so the field is cleared rather than left stale.
    const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const monthlyTarget      = numOrNull(s.monthlyTarget      ?? s.monthly_target);
    const monthlyTargetType  = s.monthlyTargetType ?? s.monthly_target_type ?? null;
    const monthlyLeadsTarget = numOrNull(s.monthlyLeadsTarget ?? s.monthly_leads_target);
    const monthlyBonus       = numOrNull(s.monthlyBonus       ?? s.monthly_bonus);

    const [[foreignId]] = await pool.query(
      'SELECT tenant_id FROM staff WHERE id=? LIMIT 1', [id]
    );
    if (foreignId && foreignId.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Staff id belongs to another tenant' });
    }

    await pool.query(
      `INSERT INTO staff (id, tenant_id, branch_id, firebase_uid, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, permissions_json, monthly_target, monthly_target_type, monthly_leads_target, monthly_bonus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), image=VALUES(image), is_active=VALUES(is_active), notes=VALUES(notes), commission_rate=VALUES(commission_rate), permissions_json=VALUES(permissions_json), monthly_target=VALUES(monthly_target), monthly_target_type=VALUES(monthly_target_type), monthly_leads_target=VALUES(monthly_leads_target), monthly_bonus=VALUES(monthly_bonus)`,
      [id, req.tenantId, s.branch_id || 'branch-other', firebaseUid, s.name || '', s.email || '', s.phone || '', role, s.image || null, s.specialization || null, joinedAt, isActive, s.notes || null, commissionRate, permissionsJson, monthlyTarget, monthlyTargetType, monthlyLeadsTarget, monthlyBonus]
    );
    res.json({ ok: true, id });
  } catch (e) {
    routeError(res, e);
  }
});

// This list is loaded broadly across the admin app for name lookups (assignee
// dropdowns etc.), so the route itself stays open to any authenticated staff —
// but sensitive fields (email/phone/notes/permissions/commission) require
// view_staff (HR-04/05). req.isAdmin was never actually set anywhere (only
// req.isSuperAdmin is), so this check was always false and hid these fields
// from real admins too.
router.get('/api/admin/staff', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const canViewSensitive = req.isSuperAdmin === true || hasPermission(req.staffRecord, PERMISSIONS.VIEW_STAFF);
    const [rows] = await pool.query(
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff WHERE tenant_id=? ORDER BY name ASC',
      [req.tenantId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name || '',
      email: canViewSensitive ? (r.email || '') : '',
      phone: canViewSensitive ? (r.phone || '') : '',
      role: (r.role || 'other').toLowerCase(),
      status: r.is_active ? 'active' : 'inactive',
      image: r.image || null,
      specialization: r.specialization || null,
      joinedAt: r.joined_at || r.created_at || null,
      firebaseUid: canViewSensitive ? (r.firebase_uid || null) : null,
      commissionRate: canViewSensitive ? (r.commission_rate || null) : null,
      notes: canViewSensitive ? (r.notes || null) : null,
      permissions: canViewSensitive ? (r.permissions_json ? tryJson(r.permissions_json, []) : []) : [],
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
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff WHERE tenant_id=? AND LOWER(email) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [req.tenantId, email]
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
    vals.push(req.tenantId, email);
    const [result] = await pool.query(`UPDATE staff SET ${fields.join(', ')} WHERE tenant_id=? AND LOWER(email) COLLATE utf8mb4_unicode_ci = ?`, vals);
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff not found' });
    res.json({ ok: true });
  } catch (e) {
    routeError(res, e);
  }
});

router.delete('/api/admin/staff/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE staff SET is_active=0 WHERE id=? AND tenant_id=?',
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff not found' });
    res.json({ ok: true });
  } catch (e) {
    routeError(res, e);
  }
});

module.exports = router;
