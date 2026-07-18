'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

router.get('/api/admin/hr/jobs', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT j.*, d.name AS department_name,
        s.name AS posted_by_name,
        (SELECT COUNT(*) FROM job_applicants a WHERE a.job_id=j.id AND a.tenant_id=j.tenant_id) AS applicant_count
      FROM job_postings j
      LEFT JOIN hr_departments d ON d.id=j.department_id AND d.tenant_id=j.tenant_id
      LEFT JOIN staff s ON s.id=j.posted_by AND s.tenant_id=j.tenant_id
      WHERE j.tenant_id=?
      ORDER BY j.created_at DESC
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Create job posting
router.post('/api/admin/hr/jobs', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { title, department_id, branch, employment_type, description, requirements, salary_min, salary_max, status } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO job_postings (id, tenant_id, title, department_id, branch, employment_type, description, requirements, salary_min, salary_max, status, posted_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, title, department_id||null, branch||null, employment_type||'full_time', description||null, requirements||null,
       salary_min||null, salary_max||null, status||'open', req.staffRecord?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, title, department_id, branch, employment_type, description, requirements,
              salary_min, salary_max, status, posted_by, created_at
       FROM job_postings WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update job posting
router.put('/api/admin/hr/jobs/:jobId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const fields = ['title','department_id','branch','employment_type','description','requirements','salary_min','salary_max','status'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(jobId, req.tenantId);
    const [updated] = await pool.query(`UPDATE job_postings SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Job not found' });
    const [[row]] = await pool.query(
      `SELECT id, title, department_id, branch, employment_type, description, requirements,
              salary_min, salary_max, status, posted_by, created_at
       FROM job_postings WHERE id=? AND tenant_id=?`, [jobId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete job posting
router.delete('/api/admin/hr/jobs/:jobId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM job_postings WHERE id=? AND tenant_id=?', [req.params.jobId, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Job not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// List applicants for a job
router.get('/api/admin/hr/jobs/:jobId/applicants', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS updated_by_name
       FROM job_applicants a LEFT JOIN staff s ON s.id=a.updated_by AND s.tenant_id=a.tenant_id
       WHERE a.job_id=? AND a.tenant_id=? ORDER BY a.created_at DESC`,
      [req.params.jobId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add applicant
router.post('/api/admin/hr/jobs/:jobId/applicants', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { name, email, phone, cv_url, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO job_applicants (id, tenant_id, job_id, name, email, phone, cv_url, notes, updated_by)
       SELECT ?,?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM job_postings WHERE id=? AND tenant_id=?)`,
      [id, req.tenantId, req.params.jobId, name, email||null, phone||null, cv_url||null, notes||null, req.staffRecord?.id||null, req.params.jobId, req.tenantId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Job not found' });
    const [[row]] = await pool.query(
      `SELECT id, job_id, name, email, phone, cv_url, notes, stage, stage_notes, updated_by, created_at, updated_at
       FROM job_applicants WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update applicant (stage, notes, etc.)
router.put('/api/admin/hr/applicants/:appId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { appId } = req.params;
    const fields = ['name','email','phone','cv_url','notes','stage','stage_notes'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_by=?'); vals.push(req.staffRecord?.id||null);
    vals.push(appId, req.tenantId);
    const [updated] = await pool.query(`UPDATE job_applicants SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Applicant not found' });
    const [[row]] = await pool.query(
      `SELECT id, job_id, name, email, phone, cv_url, notes, stage, stage_notes, updated_by, created_at, updated_at
       FROM job_applicants WHERE id=? AND tenant_id=?`, [appId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete applicant
router.delete('/api/admin/hr/applicants/:appId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM job_applicants WHERE id=? AND tenant_id=?', [req.params.appId, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Applicant not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — Onboarding
// ══════════════════════════════════════════════════════════════

// List templates
router.get('/api/admin/hr/onboarding/templates', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, COUNT(tk.id) AS task_count
      FROM onboarding_templates t LEFT JOIN onboarding_tasks tk ON tk.template_id=t.id AND tk.tenant_id=t.tenant_id
      WHERE t.tenant_id=?
      GROUP BY t.id ORDER BY t.name
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Create template
router.post('/api/admin/hr/onboarding/templates', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { name, role, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    await pool.query(`INSERT INTO onboarding_templates (id, tenant_id, name, role, description) VALUES (?,?,?,?,?)`,
      [id, req.tenantId, name, role||null, description||null]);
    const [[row]] = await pool.query(
      'SELECT id, name, role, description, created_at FROM onboarding_templates WHERE id=? AND tenant_id=?', [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update template
router.put('/api/admin/hr/onboarding/templates/:tplId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { name, role, description } = req.body;
    const [updated] = await pool.query(`UPDATE onboarding_templates SET name=?, role=?, description=? WHERE id=? AND tenant_id=?`,
      [name, role||null, description||null, req.params.tplId, req.tenantId]);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Template not found' });
    const [[row]] = await pool.query(
      'SELECT id, name, role, description, created_at FROM onboarding_templates WHERE id=? AND tenant_id=?',
      [req.params.tplId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete template
router.delete('/api/admin/hr/onboarding/templates/:tplId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM onboarding_tasks WHERE template_id=? AND tenant_id=?', [req.params.tplId, req.tenantId]);
      const [deleted] = await conn.query('DELETE FROM onboarding_templates WHERE id=? AND tenant_id=?', [req.params.tplId, req.tenantId]);
      if (!deleted.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: 'Template not found' });
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get tasks for template
router.get('/api/admin/hr/onboarding/templates/:tplId/tasks', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, template_id, title, description, due_days, category, sort_order
       FROM onboarding_tasks WHERE template_id=? AND tenant_id=? ORDER BY sort_order, id`,
      [req.params.tplId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add task to template
router.post('/api/admin/hr/onboarding/templates/:tplId/tasks', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { title, description, due_days, category, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO onboarding_tasks (id, tenant_id, template_id, title, description, due_days, category, sort_order)
       SELECT ?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM onboarding_templates WHERE id=? AND tenant_id=?)`,
      [id, req.tenantId, req.params.tplId, title, description||null, due_days||7, category||'other', sort_order||0, req.params.tplId, req.tenantId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Template not found' });
    const [[row]] = await pool.query(
      'SELECT id, template_id, title, description, due_days, category, sort_order FROM onboarding_tasks WHERE id=? AND tenant_id=?',
      [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update / delete task
router.put('/api/admin/hr/onboarding/tasks/:taskId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { title, description, due_days, category, sort_order } = req.body;
    const [updated] = await pool.query(
      `UPDATE onboarding_tasks SET title=?, description=?, due_days=?, category=?, sort_order=? WHERE id=? AND tenant_id=?`,
      [title, description||null, due_days||7, category||'other', sort_order||0, req.params.taskId, req.tenantId]
    );
    if (!updated.affectedRows) return res.status(404).json({ error: 'Task not found' });
    const [[row]] = await pool.query(
      'SELECT id, template_id, title, description, due_days, category, sort_order FROM onboarding_tasks WHERE id=? AND tenant_id=?',
      [req.params.taskId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/onboarding/tasks/:taskId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM onboarding_tasks WHERE id=? AND tenant_id=?', [req.params.taskId, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// List employees with onboarding status
router.get('/api/admin/hr/onboarding/employees', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, s.joined_at AS hire_date,
        eo.id AS onboarding_id, eo.status AS onboarding_status, eo.started_at,
        COUNT(eoi.id) AS total_items,
        SUM(CASE WHEN eoi.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done_items,
        t.name AS template_name
      FROM staff s
      LEFT JOIN employee_onboarding eo ON eo.staff_id=s.id AND eo.tenant_id=s.tenant_id AND eo.status IN ('in_progress','completed')
      LEFT JOIN onboarding_templates t ON t.id=eo.template_id AND t.tenant_id=eo.tenant_id
      LEFT JOIN employee_onboarding_items eoi ON eoi.onboarding_id=eo.id AND eoi.tenant_id=eo.tenant_id
      WHERE s.is_active=1 AND s.tenant_id=? AND s.deleted_at IS NULL
      GROUP BY s.id, eo.id ORDER BY s.name
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get onboarding items for an employee onboarding
router.get('/api/admin/hr/onboarding/:onboardingId/items', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, s.name AS completed_by_name
       FROM employee_onboarding_items i LEFT JOIN staff s ON s.id=i.completed_by AND s.tenant_id=i.tenant_id
       WHERE i.onboarding_id=? AND i.tenant_id=? ORDER BY i.sort_order, i.id`,
      [req.params.onboardingId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Start onboarding for employee (from template or custom)
router.post('/api/admin/hr/onboarding/start', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, template_id, tasks } = req.body; // tasks: [{title,category,due_days}]
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    const onboardingId = uuidv4();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[emp]] = await conn.query(
        'SELECT hire_date FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL FOR UPDATE',
        [staff_id, req.tenantId]
      );
      if (!emp) {
        await conn.rollback();
        return res.status(404).json({ error: 'Employee not found' });
      }
      const hireDate = emp.hire_date ? new Date(emp.hire_date) : new Date();

      let items = [];
      if (template_id) {
        const [tplTasks] = await conn.query(
          `SELECT id, template_id, title, description, due_days, category, sort_order
             FROM onboarding_tasks WHERE template_id=? AND tenant_id=? ORDER BY sort_order`,
          [template_id, req.tenantId]
        );
        if (!tplTasks.length) {
          const [[template]] = await conn.query('SELECT id FROM onboarding_templates WHERE id=? AND tenant_id=?', [template_id, req.tenantId]);
          if (!template) {
            await conn.rollback();
            return res.status(404).json({ error: 'Template not found' });
          }
        }
        items = tplTasks;
      } else if (tasks && Array.isArray(tasks)) {
        items = tasks;
      }

      await conn.query(
        `INSERT INTO employee_onboarding (id, tenant_id, staff_id, template_id) VALUES (?,?,?,?)`,
        [onboardingId, req.tenantId, staff_id, template_id||null]
      );

      if (items.length > 0) {
        const onbInsertRows = items.map(() => '(?,?,?,?,?,?,?)');
        const onbInsertParams = items.flatMap(t => {
          const dueDate = new Date(hireDate);
          dueDate.setDate(dueDate.getDate() + (Number(t.due_days) || 7));
          return [uuidv4(), req.tenantId, onboardingId, t.title, t.category||'other', dueDate.toISOString().slice(0,10), t.sort_order||0];
        });
        await conn.query(
          `INSERT INTO employee_onboarding_items (id, tenant_id, onboarding_id, task_title, category, due_date, sort_order) VALUES ${onbInsertRows.join(',')}`,
          onbInsertParams
        );
      }

      const [itemRows] = await conn.query(
        `SELECT id, onboarding_id, task_title, category, due_date, completed_at, completed_by, notes, sort_order
           FROM employee_onboarding_items WHERE onboarding_id=? AND tenant_id=? ORDER BY sort_order`,
        [onboardingId, req.tenantId]
      );
      await conn.commit();
      res.json({ id: onboardingId, items: itemRows });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Toggle onboarding item complete/incomplete
router.put('/api/admin/hr/onboarding/items/:itemId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { done, notes } = req.body;
    const now = done ? new Date().toISOString().slice(0,19).replace('T',' ') : null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [updated] = await conn.query(
        `UPDATE employee_onboarding_items SET completed_at=?, completed_by=?, notes=COALESCE(?,notes) WHERE id=? AND tenant_id=?`,
        [now, done ? (req.staffRecord?.id||null) : null, notes||null, req.params.itemId, req.tenantId]
      );
      if (!updated.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: 'Onboarding item not found' });
      }
      const [[item]] = await conn.query(
        'SELECT onboarding_id FROM employee_onboarding_items WHERE id=? AND tenant_id=? FOR UPDATE',
        [req.params.itemId, req.tenantId]
      );
      const [[cnt]] = await conn.query(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
           FROM employee_onboarding_items WHERE onboarding_id=? AND tenant_id=?`,
        [item.onboarding_id, req.tenantId]
      );
      if (Number(cnt.total) > 0 && Number(cnt.total) === Number(cnt.done)) {
        await conn.query(`UPDATE employee_onboarding SET status='completed', completed_at=NOW() WHERE id=? AND tenant_id=?`, [item.onboarding_id, req.tenantId]);
      } else {
        await conn.query(`UPDATE employee_onboarding SET status='in_progress', completed_at=NULL WHERE id=? AND tenant_id=?`, [item.onboarding_id, req.tenantId]);
      }
      const [[row]] = await conn.query(
        `SELECT id, onboarding_id, task_title, category, due_date, completed_at, completed_by, notes, sort_order
           FROM employee_onboarding_items WHERE id=? AND tenant_id=?`,
        [req.params.itemId, req.tenantId]
      );
      await conn.commit();
      res.json(row);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — BI Reports
// ══════════════════════════════════════════════════════════════

module.exports = router;
