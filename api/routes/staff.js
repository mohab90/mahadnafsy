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
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { hasPermission, normalizeDataScope, resolvePermissions, PERMISSIONS } = require('../constants/permissions');
const { requireTenantQuota } = require('../middleware/tenantQuota');
const { mapTherapist } = require('../lib/mappers');

router.get('/api/staff/therapist-portal', requireAuth, requireAdminOrStaff, requirePermission('manage_consultations'), async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'A linked staff account is required' });
    const [[therapist]] = await pool.query(
      `SELECT t.* FROM therapists t
        WHERE t.tenant_id=? AND t.staff_id=? AND t.is_active=1
        LIMIT 1`,
      [req.tenantId, staffId]
    );
    if (!therapist) return res.status(404).json({ error: 'No active therapist profile is linked to this account' });
    const [slots] = await pool.query(
      `SELECT id, therapist_id, day, start_time, end_time, timezone, label, meeting_link, is_active
         FROM therapist_slots WHERE therapist_id=? ORDER BY day, start_time`,
      [therapist.id]
    );
    therapist.slots = slots;
    const [consultations] = await pool.query(
      `SELECT id, client_name, client_email, client_phone, therapist_id, session_type,
              session_date, slot_id, timezone, status, notes, amount, currency,
              session_duration_minutes, meeting_link, created_at
         FROM consultations
        WHERE tenant_id=? AND therapist_id=? AND deleted_at IS NULL
        ORDER BY session_date DESC LIMIT 500`,
      [req.tenantId, therapist.id]
    );
    res.json({
      therapist: mapTherapist(therapist),
      consultations: consultations.map(row => ({
        id: row.id,
        clientName: row.client_name,
        clientEmail: row.client_email || undefined,
        clientPhone: row.client_phone || undefined,
        therapistId: row.therapist_id,
        therapistName: therapist.name,
        sessionType: String(row.session_type || 'INDIVIDUAL').toLowerCase(),
        sessionDate: row.session_date,
        slotId: row.slot_id || undefined,
        timezone: row.timezone || undefined,
        status: String(row.status || 'PENDING').toLowerCase(),
        notes: row.notes || '',
        amount: row.amount === null ? undefined : Number(row.amount),
        currency: row.currency || undefined,
        sessionDurationMinutes: row.session_duration_minutes || undefined,
        meetingLink: row.meeting_link || undefined,
        createdAt: row.created_at,
      })),
    });
  } catch (e) {
    routeError(res, e, 'therapist portal load failed');
  }
});

router.patch('/api/staff/therapist-portal/consultations/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_consultations'), async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'A linked staff account is required' });
    const fields = [];
    const params = [];
    if (req.body?.status !== undefined) {
      const status = String(req.body.status).toUpperCase();
      if (!['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid consultation status' });
      }
      fields.push('c.status=?');
      params.push(status);
    }
    if (req.body?.notes !== undefined) {
      if (typeof req.body.notes !== 'string' || req.body.notes.length > 5000) {
        return res.status(400).json({ error: 'Notes must be at most 5000 characters' });
      }
      fields.push('c.notes=?');
      params.push(req.body.notes);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    const [result] = await pool.query(
      `UPDATE consultations c
         JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
          SET ${fields.join(', ')}
        WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL
          AND t.staff_id=? AND t.is_active=1`,
      [...params, req.params.id, req.tenantId, staffId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Assigned consultation not found' });
    res.json({ ok: true });
  } catch (e) {
    routeError(res, e, 'therapist consultation update failed');
  }
});

// HR holds manage_staff and could not use it: this route demanded a super
// admin, so "أضف موظف" failed for the one role whose job it is. The
// permission now opens the door, and the two ways it could be abused are
// closed below — nobody may mint a role above their own, or grant a
// permission they do not themselves hold.
router.post('/api/admin/staff', requireAuth, requirePermission('manage_staff'), requireTenantQuota('staff'), async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    const role = ((s.role || 'other').toUpperCase());

    // Privilege escalation guard. Without it, manage_staff would be the
    // right to create an ADMIN and take over the tenant.
    const PRIVILEGED_ROLES = ['ADMIN', 'MANAGER'];
    if (!req.isSuperAdmin && PRIVILEGED_ROLES.includes(role)) {
      return res.status(403).json({ error: 'إنشاء حساب بصلاحية مدير أو أدمن يحتاج صلاحية المالك' });
    }
    const firebaseUid = s.firebaseUid || s.firebase_uid || null;
    // Normalise to a MySQL DATETIME literal — a raw ISO string ('...T...Z') is
    // rejected by DATETIME columns, which 500'd staff creation when no date was supplied.
    const joinedAt = String(s.joinedAt || s.joined_at || new Date().toISOString()).slice(0, 19).replace('T', ' ');
    const commissionRate = s.commissionRate || s.commission_rate || null;
    const isActive = s.is_active !== undefined ? s.is_active : (s.status === 'inactive' ? 0 : 1);
    // …and may not hand out a permission they were never given.
    if (!req.isSuperAdmin && Array.isArray(s.permissions)) {
      const mine = new Set(resolvePermissions(req.staffRecord) || []);
      const overreach = s.permissions.filter(perm => !mine.has(perm));
      if (overreach.length) {
        return res.status(403).json({
          error: `مش مسموح تمنح صلاحيات مش عندك: ${overreach.join(', ')}`,
        });
      }
    }
    const permissionsJson = s.permissions_json
      || (Array.isArray(s.permissions) ? JSON.stringify(s.permissions) : null);
    // Per-staff override for the role-keyed DATA_SCOPE. Anything the validator
    // does not recognise becomes NULL, i.e. "fall back to the role default" —
    // an unparsable value must never widen someone's reach.
    const dataScope = normalizeDataScope(s.dataScope ?? s.data_scope);
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
      `INSERT INTO staff (id, tenant_id, branch_id, firebase_uid, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, permissions_json, data_scope, monthly_target, monthly_target_type, monthly_leads_target, monthly_bonus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), image=VALUES(image), is_active=VALUES(is_active), notes=VALUES(notes), commission_rate=VALUES(commission_rate), permissions_json=VALUES(permissions_json), data_scope=VALUES(data_scope), monthly_target=VALUES(monthly_target), monthly_target_type=VALUES(monthly_target_type), monthly_leads_target=VALUES(monthly_leads_target), monthly_bonus=VALUES(monthly_bonus)`,
      [id, req.tenantId, s.branch_id || 'branch-other', firebaseUid, s.name || '', s.email || '', s.phone || '', role, s.image || null, s.specialization || null, joinedAt, isActive, s.notes || null, commissionRate, permissionsJson, dataScope, monthlyTarget, monthlyTargetType, monthlyLeadsTarget, monthlyBonus]
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
router.get('/api/admin/staff', requireAuth, requireAdminOrStaff, requirePermission('view_staff'), async (req, res) => {
  try {
    const canViewSensitive = req.isSuperAdmin === true || hasPermission(req.staffRecord, PERMISSIONS.VIEW_STAFF);
    const [rows] = await pool.query(
      `SELECT s.id,s.firebase_uid,s.name,s.email,s.phone,s.role,s.is_active,s.image,
              s.specialization,s.joined_at,s.created_at,s.notes,s.commission_rate,s.permissions_json,s.data_scope,
              s.monthly_target,s.monthly_target_type,s.monthly_leads_target,s.monthly_bonus,
              s.national_id,s.address,s.hr_notes,s.department_id,d.name AS department_name,
              ss.base_salary
         FROM staff s
         LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
         LEFT JOIN salary_structures ss ON ss.id=(
           SELECT x.id FROM salary_structures x
            WHERE x.tenant_id=s.tenant_id AND x.staff_id=s.id AND x.status='APPROVED'
              AND x.effective_from<=CURDATE() AND (x.effective_to IS NULL OR x.effective_to>=CURDATE())
            ORDER BY x.effective_from DESC LIMIT 1
         )
        WHERE s.tenant_id=? AND s.deleted_at IS NULL ORDER BY s.name ASC`,
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
      salary: canViewSensitive ? Number(r.base_salary || 0) : undefined,
      monthlyTarget: canViewSensitive ? Number(r.monthly_target || 0) : undefined,
      monthlyTargetType: canViewSensitive ? (r.monthly_target_type || 'egp') : undefined,
      monthlyLeadsTarget: canViewSensitive ? Number(r.monthly_leads_target || 0) : undefined,
      monthlyBonus: canViewSensitive ? Number(r.monthly_bonus || 0) : undefined,
      nationalId: canViewSensitive ? (r.national_id || '') : undefined,
      address: canViewSensitive ? (r.address || '') : undefined,
      hrNotes: canViewSensitive ? (r.hr_notes || '') : undefined,
      departmentId: canViewSensitive ? (r.department_id || null) : undefined,
      department: canViewSensitive ? (r.department_name || '') : undefined,
      permissions: canViewSensitive ? (r.permissions_json ? tryJson(r.permissions_json, []) : []) : [],
      dataScope: canViewSensitive ? (r.data_scope || '') : undefined,
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
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff WHERE tenant_id=? AND email = ? AND is_active = 1 LIMIT 1',
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
    const [result] = await pool.query(`UPDATE staff SET ${fields.join(', ')} WHERE tenant_id=? AND email = ?`, vals);
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
