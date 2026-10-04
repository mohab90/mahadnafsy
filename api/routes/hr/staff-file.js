'use strict';
/**
 * The employee's file: which papers HR physically holds, and what the person is
 * actually paid.
 *
 * Both were unanswerable before. There was no document record at all, so "did we
 * ever get his birth certificate?" lived in someone's memory. And staff carried
 * commission_rate and monthly_target with nothing saying which of them applies,
 * so a percentage earner and a target earner were indistinguishable to payroll.
 */
const express = require('express');
const router = express.Router();
const { hrError } = require('./_shared');
const logger = require('../../lib/logger').child({ module: 'hr-staff-file' });
const { pool } = require('../../lib/db');
const { uuidv4 } = require('../../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { hasPermission } = require('../../constants/permissions');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_hr')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_hr')];
// Pay is money, not an HR detail — it sits behind the financial permission the
// rest of the money surface uses rather than manage_hr.
const managePay = [requireAuth, requireAdminOrStaff, requirePermission('manage_financial')];

// Order is the order HR asks for them in, so the checklist reads like the folder.
const DOC_TYPES = [
  'NATIONAL_ID', 'PHOTOS', 'QUALIFICATION', 'BIRTH_CERT',
  'WORK_STUB', 'INSURANCE_PRINT', 'MILITARY',
];
const DOC_LABELS = {
  NATIONAL_ID: 'صورة بطاقة الرقم القومي',
  PHOTOS: 'صورتان شخصيتان',
  QUALIFICATION: 'صورة المؤهل',
  BIRTH_CERT: 'شهادة الميلاد',
  WORK_STUB: 'كعب العمل',
  INSURANCE_PRINT: 'برنت التأمين',
  MILITARY: 'الموقف من التجنيد',
};
const COMMISSION_TYPES = new Set(['NONE', 'PERCENT', 'TARGET']);

// ── Document checklist ───────────────────────────────────────────────────────
// Returns all seven every time, with received=false for the ones with no row
// yet. A checklist that only lists what was already recorded cannot show what is
// missing, which is the entire question being asked.
router.get('/api/admin/hr/staff/:staffId/documents', ...view, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.doc_type, d.received, d.note, d.updated_at, s.name updated_by_name
         FROM staff_documents d
         LEFT JOIN staff s ON s.id=d.updated_by AND s.tenant_id=d.tenant_id
        WHERE d.tenant_id=? AND d.staff_id=?`,
      [req.tenantId, req.params.staffId]
    );
    const byType = new Map(rows.map(r => [r.doc_type, r]));
    res.json(DOC_TYPES.map(type => {
      const row = byType.get(type);
      return {
        docType: type,
        label: DOC_LABELS[type],
        received: Boolean(row?.received),
        note: row?.note || null,
        updatedAt: row?.updated_at || null,
        updatedByName: row?.updated_by_name || null,
        recorded: Boolean(row),
      };
    }));
  } catch (error) {
    logger.error('[staff-documents/list]', error.message);
    hrError(res, error);
  }
});

router.put('/api/admin/hr/staff/:staffId/documents/:docType', ...manage, async (req, res) => {
  try {
    const docType = String(req.params.docType || '').toUpperCase();
    if (!DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'نوع مستند غير معروف' });

    const [[staff]] = await pool.query(
      'SELECT id FROM staff WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.staffId, req.tenantId]
    );
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    // Upsert on (tenant, staff, doc) so ticking the same document twice updates
    // it instead of stacking duplicate rows.
    await pool.query(
      `INSERT INTO staff_documents (id, tenant_id, staff_id, doc_type, received, note, updated_by)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE received=VALUES(received), note=VALUES(note), updated_by=VALUES(updated_by)`,
      [uuidv4(), req.tenantId, req.params.staffId, docType,
        req.body?.received ? 1 : 0,
        String(req.body?.note || '').trim().slice(0, 500) || null,
        req.staffRecord?.id || null]
    );
    res.json({ ok: true, docType, received: Boolean(req.body?.received) });
  } catch (error) {
    logger.error('[staff-documents/update]', error.message);
    hrError(res, error);
  }
});

// ── Pay basis ────────────────────────────────────────────────────────────────
router.get('/api/admin/hr/staff/:staffId/pay', ...view, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT base_salary, commission_type, commission_rate, monthly_target
         FROM staff WHERE id=? AND tenant_id=? LIMIT 1`,
      [req.params.staffId, req.tenantId]
    );
    if (!row) return res.status(404).json({ error: 'Staff not found' });
    res.json({
      baseSalary: row.base_salary == null ? null : Number(row.base_salary),
      commissionType: row.commission_type || 'NONE',
      commissionRate: row.commission_rate == null ? null : Number(row.commission_rate),
      monthlyTarget: row.monthly_target == null ? null : Number(row.monthly_target),
    });
  } catch (error) {
    logger.error('[staff-pay/get]', error.message);
    hrError(res, error);
  }
});

router.put('/api/admin/hr/staff/:staffId/pay', ...managePay, async (req, res) => {
  try {
    const commissionType = String(req.body?.commissionType || 'NONE').toUpperCase();
    if (!COMMISSION_TYPES.has(commissionType)) {
      return res.status(400).json({ error: 'نظام العمولة لازم يكون بدون / نسبة / تارجيت' });
    }
    const num = value => (value === '' || value == null ? null : Number(value));
    const baseSalary = num(req.body?.baseSalary);
    const commissionRate = num(req.body?.commissionRate);
    const monthlyTarget = num(req.body?.monthlyTarget);
    for (const [label, value] of [['الراتب', baseSalary], ['النسبة', commissionRate], ['التارجيت', monthlyTarget]]) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        return res.status(400).json({ error: `${label} لازم يكون رقم موجب` });
      }
    }
    // A percentage over 100 is a typo every time, and it would silently pay out
    // more than the sale was worth.
    if (commissionType === 'PERCENT' && (commissionRate == null || commissionRate > 100)) {
      return res.status(400).json({ error: 'نسبة العمولة لازم تكون من 0 إلى 100' });
    }
    if (commissionType === 'TARGET' && monthlyTarget == null) {
      return res.status(400).json({ error: 'حدد قيمة التارجيت الشهري' });
    }

    const [result] = await pool.query(
      `UPDATE staff SET base_salary=?, commission_type=?, commission_rate=?, monthly_target=?
        WHERE id=? AND tenant_id=?`,
      [baseSalary, commissionType, commissionRate, monthlyTarget, req.params.staffId, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff not found' });
    res.json({ ok: true });
  } catch (error) {
    logger.error('[staff-pay/update]', error.message);
    hrError(res, error);
  }
});

// ── Employee basics, all employees on one screen ─────────────────────────────
// «لازم ندخل الراتب الأساسي لكل موظف ورقمه في البصمة … رقم التارجيت لكل موظف
// سواء كان عدد عملاء او عدد حجوزات او فلوس». One table HR fills in once:
// the basic salary (payroll's fallback when no salary structure is approved),
// the number on the fingerprint device (what a device sheet is matched on),
// and the monthly target in clients, bookings or money.
const TARGET_TYPES = new Set(['clients', 'bookings', 'egp']);

router.get('/api/admin/hr/staff-basics', ...view, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, role, branch_id, base_salary, biometric_user_no, monthly_target, monthly_target_type, monthly_bonus
         FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY name`, [req.tenantId]);
    res.json(rows.map(r => ({
      id: r.id, name: r.name, role: r.role, branchId: r.branch_id,
      baseSalary: r.base_salary == null ? null : Number(r.base_salary),
      biometricNo: r.biometric_user_no || '',
      targetType: TARGET_TYPES.has(r.monthly_target_type) ? r.monthly_target_type : null,
      targetValue: r.monthly_target == null ? null : Number(r.monthly_target),
      targetBonus: r.monthly_bonus == null ? null : Number(r.monthly_bonus),
    })));
  } catch (error) {
    logger.error('[staff-basics/get]', error.message);
    hrError(res, error);
  }
});

router.put('/api/admin/hr/staff-basics', ...manage, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length || rows.length > 500) return res.status(400).json({ error: 'مفيش تعديلات' });
  const canPay = Boolean(req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, 'manage_financial')));
  const num = value => (value === '' || value == null ? null : Number(value));
  const updates = [];
  for (const row of rows) {
    const id = String(row?.id || '');
    if (!id) return res.status(400).json({ error: 'موظف من غير رقم' });
    const fields = {};
    if (row.biometricNo !== undefined) {
      const bio = String(row.biometricNo ?? '').trim();
      if (bio && !/^[A-Za-z0-9_-]{1,32}$/.test(bio)) return res.status(400).json({ error: `رقم البصمة «${bio}» مش صالح` });
      fields.biometric_user_no = bio || null;
    }
    if (row.targetType !== undefined) {
      const type = row.targetType ? String(row.targetType) : null;
      if (type && !TARGET_TYPES.has(type)) return res.status(400).json({ error: 'نوع التارجت لازم يكون عملاء أو حجوزات أو فلوس' });
      fields.monthly_target_type = type;
    }
    for (const [key, column] of [['targetValue', 'monthly_target'], ['targetBonus', 'monthly_bonus'], ['baseSalary', 'base_salary']]) {
      if (row[key] === undefined) continue;
      const value = num(row[key]);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10000000)) {
        return res.status(400).json({ error: 'الأرقام لازم تكون موجبة' });
      }
      fields[column] = value;
    }
    if ('base_salary' in fields && !canPay) {
      return res.status(403).json({ error: 'تعديل الراتب محتاج صلاحية الحسابات' });
    }
    if (Object.keys(fields).length) updates.push({ id, fields });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { id, fields } of updates) {
      const columns = Object.keys(fields);
      const assignments = columns.map(c => c + '=?').join(', ');
      const [result] = await conn.query(
        `UPDATE staff SET ${assignments} WHERE id=? AND tenant_id=?`,
        [...columns.map(c => fields[c]), id, req.tenantId]);
      if (!result.affectedRows) throw Object.assign(new Error('موظف مش موجود'), { statusCode: 404 });
    }
    await conn.commit();
    res.json({ ok: true, updated: updates.length });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'رقم البصمة ده متسجل لموظف تاني' });
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    logger.error('[staff-basics/put]', error.message);
    hrError(res, error);
  } finally {
    conn.release();
  }
});

module.exports = router;
