'use strict';
const { Router } = require('express');
const router = Router();
const {
  requirePermission, logger, pool, requireAuth, requireAdminOrStaff,
  uuidv4, invalidateIdentity,
} = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');

const DEFAULT_CHECKLIST = [
  { task: 'استلام العهدة والأصول', done: false },
  { task: 'إلغاء صلاحيات الأنظمة والحسابات', done: false },
  { task: 'المخالصة المالية النهائية', done: false },
  { task: 'مقابلة إنهاء الخدمة', done: false },
  { task: 'تسليم المهام والملفات', done: false },
];
const TERMINAL_LEAD_STATUSES = ['closed', 'converted', 'lost', 'won', 'archived', 'disqualified'];
const parseChecklist = value => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

router.get('/api/admin/hr/offboarding', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.id, o.staff_id, o.staff_name, o.reason, o.last_working_day, o.status,
             o.checklist, o.notes, o.created_at, o.completed_at,
             s.email AS staff_email, s.role AS staff_role
        FROM staff_offboarding o
        LEFT JOIN staff s ON s.id=o.staff_id AND s.tenant_id=o.tenant_id
       WHERE o.tenant_id=?
       ORDER BY o.created_at DESC LIMIT 300
    `, [req.tenantId]);
    res.json(rows.map(row => ({ ...row, checklist: parseChecklist(row.checklist) })));
  } catch (error) {
    logger.error('[hr/offboarding]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/offboarding', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { staff_id, reason, last_working_day, notes } = req.body;
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    if (req.staffRecord?.id === staff_id) {
      return res.status(409).json({ error: 'لا يمكن للموظف بدء إنهاء خدمته بنفسه' });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const [[staff]] = await conn.query(
      `SELECT id,name,role FROM staff
        WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [staff_id, req.tenantId]
    );
    if (!staff) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Active staff member not found' });
    }
    const [[existing]] = await conn.query(
      `SELECT id FROM staff_offboarding
        WHERE staff_id=? AND tenant_id=? AND status='in_progress' LIMIT 1 FOR UPDATE`,
      [staff_id, req.tenantId]
    );
    if (existing) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Offboarding already in progress for this staff' });
    }
    const id = uuidv4();
    const safeReason = ['resignation', 'termination', 'end_contract', 'other'].includes(reason) ? reason : 'resignation';
    await conn.query(
      `INSERT INTO staff_offboarding
        (id,tenant_id,staff_id,staff_name,reason,last_working_day,checklist,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, staff_id, staff.name || null, safeReason, last_working_day || null,
        JSON.stringify(DEFAULT_CHECKLIST), notes || null, req.staffRecord?.id || null]
    );
    await writeAuditEvent({
      action: 'hr.offboarding.started',
      entityType: 'staff',
      entityId: staff_id,
      severity: 'warning',
      metadata: { offboarding_id: id, reason: safeReason, role: staff.role },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/offboarding]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

async function assignedWork(conn, tenantId, staffId) {
  const [results] = await Promise.all([
    conn.query(
      "SELECT COUNT(*) total FROM tasks WHERE tenant_id=? AND assigned_to=? AND status IN ('todo','in_progress')",
      [tenantId, staffId]
    ),
    conn.query(
      `SELECT COUNT(*) total FROM leads
        WHERE tenant_id=? AND deleted_at IS NULL
          AND (assigned_sales_id=? OR assigned_cs_id=?)
          AND status NOT IN (?)`,
      [tenantId, staffId, staffId, TERMINAL_LEAD_STATUSES]
    ),
    conn.query(
      `SELECT COUNT(*) total FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1
          AND (assigned_sales_id=? OR assigned_cs_id=?)`,
      [tenantId, staffId, staffId]
    ),
    conn.query(
      `SELECT COUNT(*) total FROM consultations
        WHERE tenant_id=? AND deleted_at IS NULL AND assigned_staff_id=?
          AND status IN ('PENDING','CONFIRMED')`,
      [tenantId, staffId]
    ),
    conn.query(
      `SELECT COUNT(*) total FROM support_tickets
        WHERE tenant_id=? AND deleted_at IS NULL AND assigned_to=?
          AND status IN ('open','in_progress')`,
      [tenantId, staffId]
    ),
    conn.query(
      `SELECT COUNT(*) total FROM inbox_conversations
        WHERE tenant_id=? AND assigned_to_staff_id=?
          AND LOWER(COALESCE(status,'open')) NOT IN ('closed','resolved')`,
      [tenantId, staffId]
    ),
    conn.query(
      `SELECT COUNT(*) total FROM courses
        WHERE tenant_id=? AND deleted_at IS NULL AND instructor_id=?`,
      [tenantId, staffId]
    ),
  ]);
  const [tasks, leads, subscribers, consultations, supportTickets, inbox, courses]
    = results.map(([rows]) => Number(rows[0]?.total || 0));
  return {
    tasks,
    leads,
    subscribers,
    consultations,
    supportTickets,
    inbox,
    courses,
    total: tasks + leads + subscribers + consultations + supportTickets + inbox + courses,
  };
}

async function reassignWork(conn, tenantId, fromId, successor) {
  await Promise.all([
    conn.query(
      `UPDATE tasks SET assigned_to=?,assigned_name=?
        WHERE tenant_id=? AND assigned_to=? AND status IN ('todo','in_progress')`,
      [successor.id, successor.name, tenantId, fromId]
    ),
    conn.query(
      `UPDATE leads
          SET assigned_sales_name=IF(assigned_sales_id=?,?,assigned_sales_name),
              assigned_sales_id=IF(assigned_sales_id=?,?,assigned_sales_id),
              assigned_cs_name=IF(assigned_cs_id=?,?,assigned_cs_name),
              assigned_cs_id=IF(assigned_cs_id=?,?,assigned_cs_id)
        WHERE tenant_id=? AND deleted_at IS NULL
          AND (assigned_sales_id=? OR assigned_cs_id=?)
          AND status NOT IN (?)`,
      [fromId, successor.name, fromId, successor.id, fromId, successor.name, fromId, successor.id,
        tenantId, fromId, fromId, TERMINAL_LEAD_STATUSES]
    ),
    conn.query(
      `UPDATE subscribers
          SET assigned_sales_name=IF(assigned_sales_id=?,?,assigned_sales_name),
              assigned_sales_id=IF(assigned_sales_id=?,?,assigned_sales_id),
              assigned_cs_name=IF(assigned_cs_id=?,?,assigned_cs_name),
              assigned_cs_id=IF(assigned_cs_id=?,?,assigned_cs_id)
        WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1
          AND (assigned_sales_id=? OR assigned_cs_id=?)`,
      [fromId, successor.name, fromId, successor.id, fromId, successor.name, fromId, successor.id,
        tenantId, fromId, fromId]
    ),
    conn.query(
      `UPDATE consultations SET assigned_staff_id=?
        WHERE tenant_id=? AND deleted_at IS NULL AND assigned_staff_id=?
          AND status IN ('PENDING','CONFIRMED')`,
      [successor.id, tenantId, fromId]
    ),
    conn.query(
      `UPDATE support_tickets SET assigned_to=?,updated_at=NOW()
        WHERE tenant_id=? AND deleted_at IS NULL AND assigned_to=?
          AND status IN ('open','in_progress')`,
      [successor.id, tenantId, fromId]
    ),
    conn.query(
      `UPDATE inbox_conversations
          SET assigned_to_staff_id=?,assigned_to_staff_name=?,updated_at=NOW()
        WHERE tenant_id=? AND assigned_to_staff_id=?
          AND LOWER(COALESCE(status,'open')) NOT IN ('closed','resolved')`,
      [successor.id, successor.name, tenantId, fromId]
    ),
    conn.query(
      `UPDATE courses SET instructor_id=?,instructor=?
        WHERE tenant_id=? AND deleted_at IS NULL AND instructor_id=?`,
      [successor.id, successor.name, tenantId, fromId]
    ),
  ]);
}

router.put('/api/admin/hr/offboarding/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [[row]] = await conn.query(
      `SELECT o.id,o.staff_id,o.status,o.checklist,s.email,s.role
         FROM staff_offboarding o
         JOIN staff s ON s.id=o.staff_id AND s.tenant_id=o.tenant_id
        WHERE o.id=? AND o.tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!row) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Offboarding record not found' });
    }
    if (row.status !== 'in_progress') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يمكن تعديل إجراء إنهاء خدمة مغلق' });
    }
    const { status, checklist, notes, last_working_day, reassign_to } = req.body;
    const requestedStatus = status || row.status;
    if (!['in_progress', 'completed', 'cancelled'].includes(requestedStatus)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (requestedStatus !== 'completed') {
      const nextChecklist = checklist === undefined ? null : parseChecklist(checklist);
      await conn.query(
        `UPDATE staff_offboarding
            SET status=?,checklist=IF(?, ?, checklist),notes=IF(?, ?, notes),
                last_working_day=IF(?, ?, last_working_day)
          WHERE id=? AND tenant_id=?`,
        [requestedStatus, checklist !== undefined, nextChecklist ? JSON.stringify(nextChecklist) : null,
          notes !== undefined, notes || null, last_working_day !== undefined, last_working_day || null,
          row.id, req.tenantId]
      );
      await writeAuditEvent({
        action: requestedStatus === 'cancelled' ? 'hr.offboarding.cancelled' : 'hr.offboarding.updated',
        entityType: 'staff',
        entityId: row.staff_id,
        severity: requestedStatus === 'cancelled' ? 'warning' : 'info',
        metadata: { offboarding_id: row.id, status: requestedStatus },
        req,
        db: conn,
      });
      await conn.commit(); transactionStarted = false;
      return res.json({ ok: true });
    }
    if (req.staffRecord?.id === row.staff_id) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يمكن للموظف اعتماد إنهاء خدمته بنفسه' });
    }
    const finalChecklist = checklist === undefined ? parseChecklist(row.checklist) : parseChecklist(checklist);
    if (!finalChecklist.length || finalChecklist.some(item => item?.done !== true)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'يجب إكمال قائمة إنهاء الخدمة بالكامل أولاً' });
    }
    const work = await assignedWork(conn, req.tenantId, row.staff_id);
    let successor = null;
    if (work.total > 0) {
      if (!reassign_to || reassign_to === row.staff_id) {
        await conn.rollback(); transactionStarted = false;
        return res.status(409).json({
          error: 'يجب اختيار موظف بديل لنقل الأعمال المفتوحة',
          code: 'SUCCESSOR_REQUIRED',
          assigned_work: work,
        });
      }
      [[successor]] = await conn.query(
        `SELECT id,name,role FROM staff
          WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [reassign_to, req.tenantId]
      );
      if (!successor) {
        await conn.rollback(); transactionStarted = false;
        return res.status(400).json({ error: 'الموظف البديل غير صالح أو غير نشط' });
      }
      if (String(successor.role || '').toUpperCase() !== String(row.role || '').toUpperCase()) {
        await conn.rollback(); transactionStarted = false;
        return res.status(409).json({
          error: 'Successor must have the same operational role to preserve permissions and work ownership',
          code: 'SUCCESSOR_ROLE_MISMATCH',
          required_role: row.role,
        });
      }
      await reassignWork(conn, req.tenantId, row.staff_id, successor);
    }
    const [users] = await conn.query(
      'SELECT id,email FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? FOR UPDATE',
      [req.tenantId, String(row.email || '').toLowerCase().trim()]
    );
    await conn.query(
      `UPDATE staff
          SET is_active=0,totp_enabled=0,totp_secret=NULL,
              termination_date=COALESCE(termination_date,CURDATE())
        WHERE id=? AND tenant_id=?`,
      [row.staff_id, req.tenantId]
    );
    if (users.length) {
      await conn.query(
        `UPDATE users
            SET is_active=0,session_version=session_version+1,
                active_session_id=NULL,active_session_ip_hash=NULL,
                active_session_started_at=NULL,active_session_last_seen_at=NULL
          WHERE tenant_id=? AND LOWER(TRIM(email))=?`,
        [req.tenantId, String(row.email || '').toLowerCase().trim()]
      );
    }
    await conn.query(
      `UPDATE therapists
          SET is_active=0,is_consultation_enabled=0,featured=0,show_on_home=0,show_on_about=0
        WHERE tenant_id=? AND staff_id=?`,
      [req.tenantId, row.staff_id]
    );
    await conn.query(
      `UPDATE staff_offboarding
          SET status='completed',checklist=?,notes=IF(?, ?, notes),
              last_working_day=IF(?, ?, last_working_day),completed_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [JSON.stringify(finalChecklist), notes !== undefined, notes || null,
        last_working_day !== undefined, last_working_day || null, row.id, req.tenantId]
    );
    await writeAuditEvent({
      action: 'hr.offboarding.completed',
      entityType: 'staff',
      entityId: row.staff_id,
      severity: 'critical',
      metadata: { successor_id: successor?.id || null, assigned_work: work },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    for (const user of users) invalidateIdentity(req.tenantId, user.id, user.email);
    res.json({ ok: true, reassigned: work });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/offboarding]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
