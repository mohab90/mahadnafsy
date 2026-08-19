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
const logger = require('../../lib/logger').child({ module: 'hr-staff-file' });
const { pool } = require('../../lib/db');
const { uuidv4 } = require('../../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
