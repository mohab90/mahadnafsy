'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, requireAuth, requireAdminOrStaff, uuidv4 } = require('./_shared');

const DEFAULT_CHECKLIST = [
  { task: 'استلام العهدة والأصول', done: false },
  { task: 'إلغاء صلاحيات الأنظمة والحسابات', done: false },
  { task: 'المخالصة المالية النهائية', done: false },
  { task: 'مقابلة إنهاء الخدمة', done: false },
  { task: 'تسليم المهام والملفات', done: false },
];

router.get('/api/admin/hr/offboarding', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.id, o.staff_id, o.staff_name, o.reason, o.last_working_day, o.status,
             o.checklist, o.notes, o.created_at, o.completed_at,
             s.email AS staff_email, s.role AS staff_role
        FROM staff_offboarding o
        LEFT JOIN staff s ON s.id = o.staff_id AND s.tenant_id = o.tenant_id
       WHERE o.tenant_id = ?
       ORDER BY o.created_at DESC LIMIT 300
    `, [req.tenantId]);
    res.json(rows.map(r => ({ ...r, checklist: (() => { try { return JSON.parse(r.checklist || '[]'); } catch { return []; } })() })));
  } catch (e) { logger.error('[hr/offboarding]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/offboarding', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, reason, last_working_day, notes } = req.body;
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    const [[st]] = await pool.query('SELECT id, name FROM staff WHERE id=? AND tenant_id=? LIMIT 1', [staff_id, req.tenantId]);
    if (!st) return res.status(404).json({ error: 'Staff not found' });
    const [[existing]] = await pool.query(
      "SELECT id FROM staff_offboarding WHERE staff_id=? AND tenant_id=? AND status='in_progress' LIMIT 1",
      [staff_id, req.tenantId]
    );
    if (existing) return res.status(409).json({ error: 'Offboarding already in progress for this staff' });
    const id = uuidv4();
    const validReason = ['resignation', 'termination', 'end_contract', 'other'].includes(reason) ? reason : 'resignation';
    await pool.query(
      'INSERT INTO staff_offboarding (id, tenant_id, staff_id, staff_name, reason, last_working_day, checklist, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, req.tenantId, staff_id, st.name || null, validReason, last_working_day || null, JSON.stringify(DEFAULT_CHECKLIST), notes || null, req.staffRecord?.id || null]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[hr/offboarding]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/hr/offboarding/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT staff_id, status FROM staff_offboarding WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { status, checklist, notes, last_working_day } = req.body;
    const validStatus = ['in_progress', 'completed', 'cancelled'].includes(status) ? status : row.status;
    const completing = validStatus === 'completed' && row.status !== 'completed';
    await pool.query(
      `UPDATE staff_offboarding
          SET status=?,
              checklist=IF(?, ?, checklist),
              notes=IF(?, ?, notes),
              last_working_day=IF(?, ?, last_working_day),
              completed_at=IF(?, NOW(), completed_at)
        WHERE id=? AND tenant_id=?`,
      [
        validStatus,
        checklist !== undefined ? 1 : 0, checklist !== undefined ? JSON.stringify(checklist) : null,
        notes !== undefined ? 1 : 0, notes !== undefined ? (notes || null) : null,
        last_working_day !== undefined ? 1 : 0, last_working_day !== undefined ? (last_working_day || null) : null,
        completing ? 1 : 0,
        req.params.id, req.tenantId,
      ]
    );
    // On completion: revoke access. is_active=0 is what auth actually checks;
    // separate statement so a malformed crm_json/tenant edge case never blocks it.
    if (completing) {
      await pool.query('UPDATE staff SET is_active=0 WHERE id=? AND tenant_id=?', [row.staff_id, req.tenantId]).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[hr/offboarding]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
