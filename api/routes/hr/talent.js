'use strict';

// Website recruiting bridge: public join applications become tenant-owned HR
// applicants, then inactive staff records that require explicit activation.
const { Router } = require('express');
const router = Router();
const {
  requirePermission, pool, uuidv4, requireAuth, requireAdminOrStaff,
  createNotification, logger,
} = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');
const { requireTenantQuota } = require('../../middleware/tenantQuota');
const bcrypt = require('bcryptjs');
const { toIdentity } = require('../../lib/phoneNumber');
const { PERMISSIONS } = require('../../constants/permissions');

// Lower-case permission keys, the form stored in staff.permissions_json.
const ALL_PERMISSIONS = Object.values(PERMISSIONS).map(String);

const ROLE_FOR_TYPE = { INSTRUCTOR: 'instructor', CONSULTANT: 'consultant', EMPLOYEE: 'support' };
const STAFF_ROLES = new Set([
  'INSTRUCTOR', 'TRAINER', 'EXPERT', 'SALES', 'MANAGER', 'ADMIN', 'SUPPORT',
  'RECEPTION_DAQQI', 'COLLECTION', 'ACCOUNTANT', 'CONSULTANT', 'OTHER',
  'ONLINE_MANAGER', 'DAQQI_MANAGER', 'SALES_COLLECTION_MANAGER', 'HR',
]);
const talentPoolJobId = tenantId => `talent-${String(tenantId || 'tenant-default').slice(0, 29)}`;

async function ensureTalentPoolJob(tenantId, db = pool) {
  const id = talentPoolJobId(tenantId);
  try {
    await db.query(
      `INSERT IGNORE INTO job_postings
         (id, tenant_id, title, employment_type, status, description)
       VALUES (?, ?, 'Website applicants (Talent Pool)', 'full_time', 'open',
               'Automatically collected website applications')`,
      [id, tenantId]
    );
  } catch (error) {
    logger.warn('[hr/talent] ensure pool job:', error.message);
    throw error;
  }
  return id;
}

async function convertJoinUs(j, { jobId, actorId, db } = {}) {
  const tenantId = j.tenant_id || 'tenant-default';
  const ownsTransaction = !db;
  const conn = db || await pool.getConnection();
  const appId = uuidv4();
  const notes = [j.specialty ? `Specialty: ${j.specialty}` : '', j.experience || '', j.message || '']
    .filter(Boolean).join('\n');
  try {
    if (ownsTransaction) await conn.beginTransaction();
    const targetJob = jobId || await ensureTalentPoolJob(tenantId, conn);
    const [[source]] = await conn.query(
      'SELECT id, converted_applicant_id FROM join_us_applications WHERE id=? AND tenant_id=? FOR UPDATE',
      [j.id, tenantId]
    );
    if (!source) throw new Error('Join application not found in tenant');
    if (source.converted_applicant_id) {
      if (ownsTransaction) await conn.commit();
      return source.converted_applicant_id;
    }
    const [[job]] = await conn.query(
      'SELECT id FROM job_postings WHERE id=? AND tenant_id=? LIMIT 1',
      [targetJob, tenantId]
    );
    if (!job) throw new Error('Target job not found in tenant');
    await conn.query(
      `INSERT INTO job_applicants
         (id, tenant_id, job_id, name, email, phone, notes, source, source_id,
          specialty, applicant_type, linkedin, updated_by)
       VALUES (?,?,?,?,?,?,?, 'website', ?,?,?,?,?)`,
      [appId, tenantId, targetJob, j.name, j.email || null, j.phone || null, notes,
        j.id, j.specialty || null, j.type || null, j.linkedin || null, actorId || null]
    );
    await conn.query(
      `UPDATE join_us_applications
       SET status='REVIEWED', converted_applicant_id=?, reviewed_at=NOW(),
           assigned_to=COALESCE(assigned_to,?)
       WHERE id=? AND tenant_id=?`,
      [appId, actorId || null, j.id, tenantId]
    );
    if (ownsTransaction) await conn.commit();
    return appId;
  } catch (error) {
    if (ownsTransaction) await conn.rollback();
    throw error;
  } finally {
    if (ownsTransaction) conn.release();
  }
}

async function createJoinApplication(data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO join_us_applications
        (id, tenant_id, branch_id, name, email, phone, specialty, experience, type, linkedin, message)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.id, data.tenant_id, data.branch_id || null, data.name, data.email, data.phone,
        data.specialty, data.experience || '', data.type, data.linkedin || null, data.message || null,
      ]
    );
    const applicantId = await convertJoinUs(data, { jobId: data.job_id || undefined, db: conn });
    await conn.commit();
    return { id: data.id, applicantId };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

router.get('/api/admin/hr/talent-pool', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.id, j.name, j.email, j.phone, j.specialty, j.type AS applicant_type,
              j.linkedin, j.status, j.created_at, j.reviewed_at, j.converted_applicant_id,
              a.stage AS applicant_stage, a.job_id, a.hired_staff_id
       FROM join_us_applications j
       LEFT JOIN job_applicants a ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
       WHERE j.tenant_id=? ORDER BY j.created_at DESC LIMIT 300`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[hr/talent-pool]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/join-us/:id/to-applicant', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [[j]] = await pool.query(
      'SELECT * FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!j) return res.status(404).json({ error: 'Not found' });
    if (j.converted_applicant_id) {
      return res.status(409).json({ error: 'Already in pipeline', applicantId: j.converted_applicant_id });
    }
    const appId = await convertJoinUs(j, { jobId: req.body.job_id, actorId: req.staffRecord?.id });
    await writeAuditEvent({
      action: 'hr.applicant.imported',
      entityType: 'job_applicant',
      entityId: appId,
      metadata: { source_id: j.id, job_id: req.body.job_id || talentPoolJobId(req.tenantId) },
      req,
    });
    const [[app]] = await pool.query(
      `SELECT id, job_id, name, email, phone, stage, source, specialty, applicant_type
       FROM job_applicants WHERE id=? AND tenant_id=?`,
      [appId, req.tenantId]
    );
    res.json({ ok: true, applicant: app });
  } catch (error) {
    logger.error('[hr/to-applicant]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// "نقل للمقابلات" — the one-click version of طلبات الانضمام ← الانترفيوهات
// the owner asked for. Reuses the exact same convertJoinUs the manual
// to-applicant path uses (so a candidate that was already pulled into the
// pipeline some other way is just fast-forwarded, not duplicated), then
// walks it through the two legal transitions (applied → screening →
// interview) inside the same transaction — it does NOT weaken
// APPLICANT_TRANSITIONS to allow a direct jump; it just performs the two
// permitted hops atomically so the caller only needs one click.
router.post('/api/admin/hr/join-us/:id/to-interview', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[j]] = await conn.query(
      'SELECT * FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!j) { await conn.rollback(); return res.status(404).json({ error: 'Not found' }); }
    const appId = await convertJoinUs(j, { jobId: req.body.job_id, actorId: req.staffRecord?.id, db: conn });
    const [[applicant]] = await conn.query(
      'SELECT stage FROM job_applicants WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [appId, req.tenantId]
    );
    if (!applicant) { await conn.rollback(); return res.status(500).json({ error: 'Applicant row missing after conversion' }); }
    if (applicant.stage === 'applied') {
      await conn.query(
        "UPDATE job_applicants SET stage='screening', updated_by=? WHERE id=? AND tenant_id=?",
        [req.staffRecord?.id || null, appId, req.tenantId]
      );
    }
    if (applicant.stage === 'applied' || applicant.stage === 'screening') {
      await conn.query(
        "UPDATE job_applicants SET stage='interview', updated_by=? WHERE id=? AND tenant_id=?",
        [req.staffRecord?.id || null, appId, req.tenantId]
      );
    }
    await writeAuditEvent({
      action: 'hr.applicant.moved_to_interview',
      entityType: 'job_applicant',
      entityId: appId,
      metadata: { source_id: j.id, from_stage: applicant.stage },
      req, db: conn,
    });
    const [[app]] = await conn.query(
      `SELECT id, job_id, name, email, phone, stage, source, specialty, applicant_type, interview_rating
       FROM job_applicants WHERE id=? AND tenant_id=?`,
      [appId, req.tenantId]
    );
    await conn.commit();
    res.json({ ok: true, applicant: app });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[hr/to-interview]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.post(
  '/api/admin/hr/applicants/:appId/hire',
  requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), requireTenantQuota('staff'),
  async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[a]] = await conn.query(
      'SELECT * FROM job_applicants WHERE id=? AND tenant_id=? FOR UPDATE',
      [req.params.appId, req.tenantId]
    );
    if (!a) {
      await conn.rollback();
      return res.status(404).json({ error: 'Not found' });
    }
    if (a.hired_staff_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'Already hired', staffId: a.hired_staff_id });
    }
    // 'interview' is allowed as well as 'offer'. The interviews screen hires
    // directly off the back of a good interview — that is what the desk actually
    // does, and requiring a separate click through the offer stage first meant
    // the hire button on that screen could only ever answer 409. Everything
    // earlier than an interview still has to progress normally: hiring someone
    // nobody has met is not a workflow, it is a mistake.
    if (a.stage !== 'offer' && a.stage !== 'interview') {
      await conn.rollback();
      return res.status(409).json({
        error: 'المرشح لازم يوصل لمرحلة المقابلة أو العرض قبل التعيين',
        code: 'OFFER_STAGE_REQUIRED',
      });
    }
    // The login email can be chosen at hire time — an applicant who applied
    // without one (or with a personal address the desk does not want as the
    // work login) used to be a dead end here.
    const loginEmail = String(req.body.email || a.email || '').toLowerCase().trim();
    if (!loginEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginEmail)) {
      await conn.rollback();
      return res.status(400).json({ error: 'حدد بريدًا إلكترونيًا صحيحًا لحساب الموظف' });
    }
    const password = String(req.body.password || '');
    if (password && password.length < 8) {
      await conn.rollback();
      return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });
    }
    const role = String(req.body.role || ROLE_FOR_TYPE[String(a.applicant_type || '').toUpperCase()] || 'support').toUpperCase();
    if (!STAFF_ROLES.has(role)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Unsupported staff role', code: 'INVALID_STAFF_ROLE' });
    }
    const [[existing]] = await conn.query(
      'SELECT id FROM staff WHERE LOWER(TRIM(email))=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [loginEmail, req.tenantId]
    );
    if (existing) {
      await conn.rollback();
      return res.status(409).json({ error: 'A staff record already uses this email', code: 'STAFF_EMAIL_EXISTS', staffId: existing.id });
    }
    const requestedBranch = req.body.branch_id || req.tenantBranchId || null;
    const [[branch]] = requestedBranch
      ? await conn.query(
        `SELECT id FROM branches
          WHERE tenant_id=? AND is_active=1 AND (id=? OR branch_key=? OR slug=?)
          LIMIT 1`,
        [req.tenantId, requestedBranch, requestedBranch, requestedBranch]
      )
      : await conn.query(
        'SELECT id FROM branches WHERE tenant_id=? AND is_active=1 ORDER BY id LIMIT 1',
        [req.tenantId]
      );
    if (!branch) {
      await conn.rollback();
      return res.status(400).json({ error: 'Active tenant branch is required', code: 'INVALID_STAFF_BRANCH' });
    }
    const staffId = uuidv4();
    // `joined_at` is NOT NULL with no column default, so leaving it out made
    // every hire fail with "Field 'joined_at' doesn't have a default value" —
    // surfaced to the UI as a bare Internal server error. Set it alongside
    // hire_date (same day the record is created); activation stays a separate
    // manual step, which is why is_active is still 0.
    // Explicit permission overrides, when the desk wants something other than
    // the role default. Validated against the master list so a typo cannot
    // grant a permission that does not exist (or hide one that should).
    const requestedPermissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.filter(p => ALL_PERMISSIONS.includes(String(p))).map(String)
      : null;
    const position = String(req.body.position || '').trim().slice(0, 255) || null;
    // A hire with a password is ready to work; without one, activation stays a
    // separate manual step (the original behaviour).
    const activate = Boolean(password) && req.body.activate !== false;
    await conn.query(
      `INSERT INTO staff
         (id, tenant_id, branch_id, name, email, phone, role, is_active, employment_type,
          hire_date, joined_at, specialization, permissions_json)
       VALUES (?,?,?,?,?,?,?,?, 'FULL_TIME', CURDATE(), NOW(), ?, ?)`,
      [staffId, req.tenantId, branch.id, a.name, loginEmail, toIdentity(a.phone) || '', role,
        activate ? 1 : 0, position,
        requestedPermissions ? JSON.stringify(requestedPermissions) : null]
    );
    if (password) {
      // Reuse the login row if one already exists for this address (a former
      // customer being hired), otherwise create it.
      const passwordHash = await bcrypt.hash(password, 12);
      const [[existingUser]] = await conn.query(
        'SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, loginEmail]);
      if (existingUser) {
        await conn.query(
          `UPDATE users SET password_hash=?, name=?, is_active=1,
             session_version=session_version+1, active_session_id=NULL, active_session_ip_hash=NULL
            WHERE id=? AND tenant_id=?`,
          [passwordHash, a.name || '', existingUser.id, req.tenantId]);
      } else {
        await conn.query(
          'INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?,?,1)',
          [uuidv4(), req.tenantId, loginEmail, toIdentity(a.phone) || null, passwordHash, a.name || '', 'staff']);
      }
    }
    await conn.query(
      "UPDATE job_applicants SET stage='hired', hired_staff_id=?, updated_by=? WHERE id=? AND tenant_id=?",
      [staffId, req.staffRecord?.id || null, a.id, req.tenantId]
    );
    if (a.source === 'website' && a.source_id) {
      await conn.query(
        "UPDATE join_us_applications SET status='ACCEPTED' WHERE id=? AND tenant_id=?",
        [a.source_id, req.tenantId]
      );
    }
    await writeAuditEvent({
      action: 'hr.applicant.hired',
      entityType: 'staff',
      entityId: staffId,
      severity: 'warning',
      metadata: {
        applicant_id: a.id, role, branch_id: branch.id, position,
        login_created: Boolean(password), activated: activate,
        permission_overrides: requestedPermissions ? requestedPermissions.length : 0,
      },
      req,
      db: conn,
    });
    await conn.commit();
    await createNotification('hr',
      activate ? 'تم تعيين موظف جديد' : 'New hire awaiting activation',
      `${a.name} (${role})${position ? ` — ${position}` : ''}`, { staffId }, req.tenantId)
      .catch(error => logger.error('[hr/hire-notification]', error.message));
    res.json({
      ok: true, staffId, role, position, email: loginEmail,
      activated: activate, activation_required: !activate,
    });
  } catch (error) {
    await conn.rollback();
    logger.error('[hr/hire]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = { router, convertJoinUs, createJoinApplication, ensureTalentPoolJob };
