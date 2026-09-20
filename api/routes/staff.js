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
const { writeAuditEvent } = require('../lib/auditTrail');

// The roles that can administer a tenant. Mirrors SUPER_ADMIN_ROLES in
// middleware/auth.js — the delete guard below has to know what an owner is in
// order to refuse removing the last one.
const SUPER_ADMIN_ROLES = ['admin', 'manager'];
const { hasPermission, normalizeDataScope, resolveDataScope, resolvePermissions, DATA_SCOPE, PERMISSIONS } = require('../constants/permissions');
const { requireTenantQuota } = require('../middleware/tenantQuota');
const { mapTherapist } = require('../lib/mappers');
const { assertGrantable, heldByTarget } = require('../lib/permissionGrant');
const { branchIdForBranch } = require('../lib/branches');

/**
 * The branch this reader is confined to, or null for the whole institute.
 *
 * A branch manager's clients, money, leads and orders are already filtered to
 * their branch by the routes that serve them. This list was not: it answered
 * every employee of every branch, and manage_staff let them rewrite any row.
 * One reading of the same data scope, so the staff screen agrees with the
 * rest of the panel.
 *
 * Who is "in the branch" is the scope, not only the branch column. The Dokki
 * receptionist was filed under «فرع آخر» while working nothing but Dokki, and
 * a manager who cannot see their own receptionist has the wrong list — so an
 * employee whose effective scope is this branch belongs to it whatever the
 * column says. `roles` are those whose default scope is this branch, which is
 * what a row with no scope of its own inherits.
 */
function staffBranchScope(req) {
  const scope = resolveDataScope(req.staffRecord, { isSuperAdmin: req.isSuperAdmin, fallback: 'all' });
  const value = String(scope || '');
  if (!value.startsWith('branch:')) return null;
  return {
    branchId: branchIdForBranch(value.slice('branch:'.length)),
    scope: value,
    roles: Object.entries(DATA_SCOPE)
      .filter(([, roleScope]) => roleScope === value)
      .map(([role]) => role),
  };
}

/** The reader's own row is theirs wherever it is filed. */
function inBranch(scope, row, selfId) {
  if (!scope || !row) return true;
  if (selfId && row.id === selfId) return true;
  if (row.branch_id === scope.branchId) return true;
  const own = normalizeDataScope(row.data_scope);
  return own ? own === scope.scope : scope.roles.includes(String(row.role || '').toLowerCase());
}

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
      // The therapist's own portal — their own slots, their own links.
      therapist: mapTherapist(therapist, true),
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
// requirePermission reads req.staffRecord and req.isSuperAdmin, and requireAuth
// sets neither — only the requireAdmin* family does. This route went straight
// from requireAuth to requirePermission, so it answered 403 "Staff record not
// found" to every caller including the owner, in about five milliseconds: adding
// an employee from the HR screen had never once worked. It was the only route of
// the 362 guarded this way that was missing it.
router.post('/api/admin/staff', requireAuth, requireAdminOrStaff, requirePermission('manage_staff'), requireTenantQuota('staff'), async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    const role = ((s.role || 'other').toUpperCase());

    // A staff row with no name or no email is not a record anyone can use: the
    // email is the login identity and the unique key, and a second row with a
    // blank one collides with the first.
    const name = String(s.name || '').trim();
    const email = String(s.email || '').trim().toLowerCase();
    if (!name) return res.status(400).json({ error: 'اسم الموظف مطلوب', code: 'NAME_REQUIRED' });
    if (!email) return res.status(400).json({ error: 'بريد الموظف مطلوب', code: 'EMAIL_REQUIRED' });

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
    // …and may not hand out a permission they were never given. This used
    // to test `Array.isArray(s.permissions)` while storing `s.permissions_json`,
    // so sending the list as a JSON string walked straight past it.
    // This route upserts: an existing id rewrites that row's role, permissions
    // and data scope. A non-owner may not rewrite a manager's row, and what the
    // employee already holds is not a new grant (see lib/permissionGrant.js).
    const [[existingStaff]] = await pool.query(
      'SELECT id, tenant_id, role, permissions_json, data_scope, branch_id FROM staff WHERE id=? AND tenant_id=? LIMIT 1',
      [id, req.tenantId]);
    // A branch manager writes inside their branch. Rewriting another branch's
    // employee, or filing a new one under a branch that is not theirs, is the
    // same reach the list above stopped answering.
    const writeBranch = staffBranchScope(req);
    if (writeBranch) {
      // Whoever the list shows them, they may edit — the same rule, so a
      // manager never sees a colleague they cannot save. Their own row counts
      // wherever it is filed (inBranch), and a new employee may not be filed
      // under someone else's branch.
      if (existingStaff && !inBranch(writeBranch, existingStaff, req.staffRecord?.id)) {
        return res.status(403).json({
          error: 'الموظف ده مش في فرعك', code: 'OUTSIDE_YOUR_BRANCH',
        });
      }
      if (!existingStaff && s.branch_id && s.branch_id !== writeBranch.branchId) {
        return res.status(403).json({
          error: 'إضافة موظف في فرع تاني متاحة للإدارة فقط', code: 'OUTSIDE_YOUR_BRANCH',
        });
      }
    }
    if (existingStaff && !req.isSuperAdmin
        && PRIVILEGED_ROLES.includes(String(existingStaff.role || '').toUpperCase())) {
      return res.status(403).json({
        error: 'تعديل حساب مدير يحتاج صلاحية المالك',
        code: 'OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT',
      });
    }
    const grant = assertGrantable(req, s, {
      alreadyHeld: heldByTarget({ existingStaff, role: role.toLowerCase(), tenantId: req.tenantId }),
    });
    if (!grant.ok) return res.status(grant.status).json(grant.body);
    const permissionsJson = grant.permissionsJson;
    // Per-staff override for the role-keyed DATA_SCOPE. Anything the validator
    // does not recognise becomes NULL, i.e. "fall back to the role default" —
    // an unparsable value must never widen someone's reach.
    const dataScope = normalizeDataScope(s.dataScope ?? s.data_scope);
    // Data scope is access, the same as permissions: editing it on an existing
    // employee is owner-only in hr/employees.js. Setting one here is too,
    // unless it leaves the employee exactly where they already were.
    if (!req.isSuperAdmin && dataScope !== null
        && dataScope !== normalizeDataScope(existingStaff?.data_scope)) {
      return res.status(403).json({
        error: 'تعديل نطاق البيانات متاح لمدير النظام فقط',
        code: 'PERMISSIONS_REQUIRE_SUPERADMIN',
      });
    }
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

    // Say which employee already holds this address, and whether they are
    // simply archived — in which case restoring them is what was meant, and
    // there is now a route for it.
    const [[emailOwner]] = await pool.query(
      `SELECT id, name, deleted_at FROM staff
        WHERE tenant_id=? AND id<>? AND LOWER(TRIM(email))=? LIMIT 1`,
      [req.tenantId, id, email]
    );
    if (emailOwner) {
      return res.status(409).json(emailOwner.deleted_at ? {
        error: `البريد ده مسجّل على ${emailOwner.name || 'موظف'} المحذوف — استعِد حسابه بدل إنشاء واحد جديد`,
        code: 'EMAIL_BELONGS_TO_DELETED_STAFF',
        staffId: emailOwner.id,
      } : {
        error: `البريد ده مستخدم بالفعل لـ ${emailOwner.name || 'موظف آخر'}`,
        code: 'EMAIL_TAKEN',
        staffId: emailOwner.id,
      });
    }

    await pool.query(
      `INSERT INTO staff (id, tenant_id, branch_id, firebase_uid, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, permissions_json, data_scope, monthly_target, monthly_target_type, monthly_leads_target, monthly_bonus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), image=VALUES(image), is_active=VALUES(is_active), notes=VALUES(notes), commission_rate=VALUES(commission_rate), permissions_json=VALUES(permissions_json), data_scope=VALUES(data_scope), monthly_target=VALUES(monthly_target), monthly_target_type=VALUES(monthly_target_type), monthly_leads_target=VALUES(monthly_leads_target), monthly_bonus=VALUES(monthly_bonus)`,
      [id, req.tenantId, s.branch_id || writeBranch?.branchId || 'branch-other', firebaseUid, name, email, s.phone || '', role, s.image || null, s.specialization || null, joinedAt, isActive, s.notes || null, commissionRate, permissionsJson, dataScope, monthlyTarget, monthlyTargetType, monthlyLeadsTarget, monthlyBonus]
    );
    res.json({ ok: true, id });
  } catch (e) {
    // The check above catches the ordinary case; this is the race, and it must
    // still say what happened rather than reporting a server fault.
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'البريد ده مستخدم بالفعل لموظف آخر', code: 'EMAIL_TAKEN' });
    }
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
    // A branch manager reads their own branch — everyone whose work is scoped
    // to it, and their own row, which is theirs wherever it sits.
    const branch = staffBranchScope(req);
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
        WHERE s.tenant_id=? AND s.deleted_at IS NULL
              ${branch ? `AND (s.branch_id = ? OR s.id=? OR s.data_scope = ?
                            OR (s.data_scope IS NULL AND LOWER(s.role) IN (${branch.roles.map(() => '?').join(',') || "''"})))` : ''}
        ORDER BY s.name ASC`,
      branch
        ? [req.tenantId, branch.branchId, req.staffRecord?.id || '', branch.scope, ...branch.roles]
        : [req.tenantId]
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
      // null, not [], when the row carries no override: [] is now a real answer
      // meaning "none at all", and a screen that cannot tell the two apart sends
      // the empty one back and silently revokes the role's defaults.
      permissions: canViewSensitive ? (r.permissions_json ? tryJson(r.permissions_json, []) : null) : [],
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
      // null, not []. NULL in the column means "whatever the role grants"; an
      // empty list is an override meaning none. This sent [] for both, and this
      // is the only answer about themselves that an employee without view_staff
      // ever gets — so a new employee on their role's defaults signed in with
      // every permission refused and no screen open.
      permissions: r.permissions_json ? tryJson(r.permissions_json, []) : null,
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
    const [[target]] = await pool.query(
      'SELECT id, name, email, role, is_active FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!target) return res.status(404).json({ error: 'الموظف غير موجود', code: 'STAFF_NOT_FOUND' });

    // The screen already refuses this; the route has to as well, or a direct
    // call locks the caller out of their own tenant.
    if (req.staffRecord?.id && req.staffRecord.id === target.id) {
      return res.status(409).json({ error: 'لا يمكنك حذف حسابك الخاص', code: 'CANNOT_DELETE_SELF' });
    }

    // And the last owner standing cannot go either: with no admin or manager
    // left, nothing in this tenant can create one back.
    if (SUPER_ADMIN_ROLES.includes(String(target.role || '').toLowerCase())) {
      const [[owners]] = await pool.query(
        `SELECT COUNT(*) AS n FROM staff
           WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1
             AND LOWER(role) IN (?, ?)`,
        [req.tenantId, SUPER_ADMIN_ROLES[0], SUPER_ADMIN_ROLES[1]]
      );
      if (Number(owners?.n || 0) <= 1) {
        return res.status(409).json({
          error: 'دا آخر حساب بصلاحية مدير — عيّن مدير تاني الأول',
          code: 'LAST_OWNER',
        });
      }
    }

    // deleted_at is what the list filters on. Setting is_active alone left the
    // person on screen, which is the whole complaint. is_active goes with it so
    // every reader that checks either one agrees.
    const [result] = await pool.query(
      'UPDATE staff SET is_active=0, deleted_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'الموظف غير موجود', code: 'STAFF_NOT_FOUND' });

    await writeAuditEvent({
      action: 'staff.deleted', entityType: 'staff', entityId: target.id,
      tenantId: req.tenantId, actorEmail: req.user?.email || null,
      after: { name: target.name, email: target.email, role: target.role },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (e) {
    routeError(res, e);
  }
});

// PUT /api/admin/staff/:id/restore — the other half of the promise
//
// The delete dialog says «سجله وتاريخه المالي يبقى محفوظًا، ويمكن إعادة تفعيله
// لاحقًا», and nothing implemented the second half: once removed there was no
// route and no screen that could bring anyone back.
router.put('/api/admin/staff/:id/restore', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [[target]] = await pool.query(
      'SELECT id, name, email FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NOT NULL LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!target) return res.status(404).json({ error: 'مفيش موظف محذوف بالمعرّف ده', code: 'STAFF_NOT_FOUND' });

    // The email is unique per tenant, so a live row may have taken it since.
    const [[clash]] = await pool.query(
      `SELECT id FROM staff
        WHERE tenant_id=? AND deleted_at IS NULL AND id<>?
          AND LOWER(TRIM(email))=LOWER(TRIM(?)) LIMIT 1`,
      [req.tenantId, target.id, target.email || '']
    );
    if (clash) {
      return res.status(409).json({
        error: 'فيه موظف نشط بنفس البريد — غيّر بريد أحدهما قبل الاستعادة',
        code: 'EMAIL_TAKEN',
      });
    }

    await pool.query(
      'UPDATE staff SET deleted_at=NULL, is_active=1 WHERE id=? AND tenant_id=?',
      [req.params.id, req.tenantId]
    );
    await writeAuditEvent({
      action: 'staff.restored', entityType: 'staff', entityId: target.id,
      tenantId: req.tenantId, actorEmail: req.user?.email || null,
      after: { name: target.name, email: target.email },
    }).catch(() => {});
    res.json({ ok: true, id: target.id });
  } catch (e) {
    routeError(res, e);
  }
});

module.exports = router;
