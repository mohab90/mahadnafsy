'use strict';

/**
 * «نضيف لحساب مدير الدقي نظام الموارد البشريه ولكن فقط علي موظفين الدقي يقدر
 * ينشأ حساب ويقدر يشوف الاذونات والغيابات وكل ما يخص الموارد البشرية ولكن علي
 * نطاق الدقي» (9 Oct 2026).
 *
 * A branch manager reaches the HR of their branch's staff: the branch's own roles,
 * and anyone filed under the branch (branch_id — not reliable alone: the Dokki
 * reception on production is filed under branch-other). Only the routes that apply
 * this reach let them in — the staff list, a new account for the branch, leaves and
 * permissions, attendance and absences. Pay, advances and the rest of HR stay with
 * whoever holds view_hr / manage_hr.
 */

const { hasPermission } = require('../constants/permissions');

const BRANCH_HR = Object.freeze({
  DAQQI_MANAGER: { branch: 'DAQQI', branchId: 'branch-daqqi', roles: ['RECEPTION_DAQQI', 'DAQQI_MANAGER'], newRoles: ['RECEPTION_DAQQI'] },
  TAGAMOA_MANAGER: { branch: 'TAGAMOA', branchId: 'branch-tagamoa', roles: ['RECEPTION_TAGAMOA', 'TAGAMOA_MANAGER'], newRoles: ['RECEPTION_TAGAMOA'] },
});

/**
 * Whose HR this caller reaches: all of it, one branch's, or none (null). A
 * branch manager reaches their branch's, even when their grid also holds view_hr
 * — ticking the HR boxes «to open the permissions» used to hand the Dokki
 * manager every employee of the institute.
 */
function hrReach(req, level = 'view') {
  if (req.isSuperAdmin) return { all: true };
  const branch = BRANCH_HR[String(req.staffRecord?.role || '').toUpperCase()];
  if (branch) return { all: false, ...branch };
  if (hasPermission(req.staffRecord, level === 'manage' ? 'manage_hr' : 'view_hr')) return { all: true };
  return null;
}

/** Guard for a route a branch manager may use too; sets req.hrReach. */
const requireHr = level => (req, res, next) => {
  const reach = hrReach(req, level);
  if (!reach) return res.status(403).json({ error: 'Insufficient permissions', required: level === 'manage' ? 'manage_hr' : 'view_hr' });
  req.hrReach = reach;
  next();
};

/** ` AND (...)` narrowing a staff alias to the reach; empty for all of HR. */
function staffReachSql(reach, alias = 's') {
  if (!reach || reach.all) return { sql: '', params: [] };
  return { sql: ` AND (${alias}.role IN (${reach.roles.map(() => '?').join(',')}) OR ${alias}.branch_id = ?)`, params: [...reach.roles, reach.branchId] };
}

/** Is this employee within the caller's reach? */
async function staffInReach(db, req, staffId) {
  const reach = req.hrReach || hrReach(req);
  if (!reach) return false;
  if (reach.all) return true;
  const scope = staffReachSql(reach, 's');
  const [[row]] = await db.query(`SELECT s.id FROM staff s WHERE s.id = ? AND s.tenant_id = ?${scope.sql} LIMIT 1`, [staffId, req.tenantId, ...scope.params]);
  return Boolean(row);
}

const outOfReach = res => res.status(404).json({ error: 'الموظف ده مش من موظفين فرعك' });

/*
 * Recruitment — «اتاكد ان طلبات الانضمام للدقي والانترفيو للدقي بيظهر لنشوي مدير
 * الدقي» (12 Oct 2026).
 *
 * The join applications and the interviews were gated on view_join_us / view_hr,
 * and hasPermission refuses view_hr to a branch manager whatever their grid says
 * (above), so the Dokki manager could reach neither. A branch manager now reaches
 * the applications and interviews for their branch only; everyone else keeps the
 * permission the route always asked for.
 *
 * "For Dokki" is the branch the applicant chose on the form
 * (join_us_applications.branch, copied to job_applicants.branch), else the branch
 * of the posting they applied to. The forms send lower-case keys ('daqqi'); the
 * postings hold branch_key ('DAQQI') — compared lower-case.
 */
const recruitBranchKey = reach => String(reach.branch || '').toLowerCase();

/** Guard after requireAnyPermission(permission, 'branch_hr'); sets req.recruitReach. */
const requireRecruiting = permission => (req, res, next) => {
  if (req.isSuperAdmin) { req.recruitReach = { all: true }; return next(); }
  const branch = BRANCH_HR[String(req.staffRecord?.role || '').toUpperCase()];
  if (branch) { req.recruitReach = { all: false, ...branch, key: recruitBranchKey(branch) }; return next(); }
  if (hasPermission(req.staffRecord, permission)) { req.recruitReach = { all: true }; return next(); }
  return res.status(403).json({ error: 'Insufficient permissions', required: permission });
};

/** ` AND …` narrowing a join application (j, its applicant a, the posting p) to the reach. */
function joinUsReachSql(reach, j = 'j', a = 'a', p = 'jp') {
  if (!reach || reach.all) return { sql: '', params: [] };
  return {
    sql: ` AND LOWER(COALESCE(NULLIF(${j}.branch,''), NULLIF(${a}.branch,''), NULLIF(${p}.branch,''), '')) = ?`,
    params: [recruitBranchKey(reach)],
  };
}

/** ` AND …` narrowing an applicant (a) and their posting (p) to the reach. */
function applicantReachSql(reach, a = 'a', p = 'j') {
  if (!reach || reach.all) return { sql: '', params: [] };
  return {
    sql: ` AND LOWER(COALESCE(NULLIF(${a}.branch,''), NULLIF(${p}.branch,''), '')) = ?`,
    params: [recruitBranchKey(reach)],
  };
}

/** Is this join application within the caller's recruitment reach? */
async function joinUsInReach(db, req, id) {
  const reach = req.recruitReach;
  if (!reach) return false;
  const scope = joinUsReachSql(reach);
  const [[row]] = await db.query(
    `SELECT j.id FROM join_us_applications j
       LEFT JOIN job_applicants a ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
       LEFT JOIN job_postings jp ON jp.id=a.job_id AND jp.tenant_id=a.tenant_id
      WHERE j.id=? AND j.tenant_id=?${scope.sql} LIMIT 1`,
    [id, req.tenantId, ...scope.params]);
  return Boolean(row);
}

/** Is this applicant within the caller's recruitment reach? */
async function applicantInReach(db, req, id) {
  const reach = req.recruitReach;
  if (!reach) return false;
  const scope = applicantReachSql(reach);
  const [[row]] = await db.query(
    `SELECT a.id FROM job_applicants a
       LEFT JOIN job_postings j ON j.id=a.job_id AND j.tenant_id=a.tenant_id
      WHERE a.id=? AND a.tenant_id=?${scope.sql} LIMIT 1`,
    [id, req.tenantId, ...scope.params]);
  return Boolean(row);
}

const outOfRecruitReach = res => res.status(404).json({ error: 'الطلب ده مش على فرعك' });

module.exports = {
  BRANCH_HR, hrReach, outOfReach, requireHr, staffInReach, staffReachSql,
  requireRecruiting, joinUsReachSql, applicantReachSql, joinUsInReach, applicantInReach, outOfRecruitReach,
};
