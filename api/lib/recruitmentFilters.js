'use strict';
/**
 * What the recruitment screens narrow their lists by, as SQL.
 *
 * «قسم الموارد البشرية تقيل جدا … الصفحه تفتح 50 فقط» (17 Oct 2026). Both screens
 * used to download every row (up to 20 pages of 1000 for the applications, 500 of
 * every stage for the interviews) and filter in the browser. The filters live
 * here instead, so a screen asks for the 50 rows it draws and the database does
 * the narrowing. Pure functions — no connection — so the rules are tested alone.
 */

/** Weakest to strongest; the same order as admin/.../hr-sections/applicantLabels.ts. */
const EXPERIENCE_ORDER = ['none', 'under_1', '1-3', '3-5', '5-10', '10plus'];

const JOIN_STATUSES = ['NEW', 'REVIEWED', 'ACCEPTED', 'REJECTED', 'CONTACTED'];
const CONSULTANT_TYPES = ['CONSULTANT', 'CONSULTATION', 'THERAPIST', 'ADVISOR'];
const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W'];

/** A search word as a LIKE pattern with its wildcards taken literally. */
const likeOf = value => `%${String(value).trim().replace(/[\\%_]/g, '\\$&')}%`;

/** `''` is no filter; `only_none` is fresh graduates; anything else is a minimum band. */
function experienceSql(column, min) {
  if (!min) return { sql: '', params: [] };
  if (min === 'only_none') return { sql: ` AND ${column} = 'none'`, params: [] };
  const rank = EXPERIENCE_ORDER.indexOf(String(min));
  if (rank < 0) return { sql: '', params: [] };
  const bands = EXPERIENCE_ORDER.slice(rank);
  return { sql: ` AND ${column} IN (${bands.map(() => '?').join(',')})`, params: bands };
}

const yesNo = value => (value === 'yes' ? 1 : value === 'no' ? 0 : null);

/**
 * The narrowing on top of the applications' scope. Aliases: j = join_us_applications,
 * a = job_applicants, jp = job_postings (the same ones the list and its counts use).
 */
function joinUsFilterSql(query = {}) {
  let sql = '';
  const params = [];
  const status = String(query.status || '').toUpperCase();
  if (JOIN_STATUSES.includes(status)) {
    sql += " AND UPPER(COALESCE(NULLIF(j.status,''),'NEW')) = ?";
    params.push(status);
  }
  if (query.kind === 'consultant') {
    sql += ` AND j.type IN (${CONSULTANT_TYPES.map(() => '?').join(',')})`;
    params.push(...CONSULTANT_TYPES);
  } else if (query.kind === 'instructor') {
    sql += ` AND (j.type IS NULL OR j.type NOT IN (${CONSULTANT_TYPES.map(() => '?').join(',')}))`;
    params.push(...CONSULTANT_TYPES);
  }
  if (query.branch) {
    sql += " AND LOWER(COALESCE(NULLIF(j.branch,''), NULLIF(a.branch,''), NULLIF(jp.branch,''))) = ?";
    params.push(String(query.branch).toLowerCase());
  }
  if (query.job) {
    sql += ' AND a.job_id = ?';
    params.push(String(query.job));
  }
  if (query.program) {
    sql += ' AND j.programs_json LIKE ?';
    params.push(`%"title":${JSON.stringify(String(query.program))}%`);
  }
  const lectured = yesNo(query.lectured);
  if (lectured !== null) { sql += ' AND j.lectured_before = ?'; params.push(lectured); }
  const sessions = yesNo(query.sessions);
  if (sessions !== null) { sql += ' AND j.sessions_before = ?'; params.push(sessions); }
  const experience = experienceSql('a.experience_years', String(query.minExp || ''));
  sql += experience.sql;
  params.push(...experience.params);
  if (String(query.q || '').trim()) {
    const like = likeOf(query.q);
    sql += ` AND (j.name LIKE ? OR j.email LIKE ? OR j.phone LIKE ? OR j.specialty LIKE ?
                  OR j.programs_other LIKE ? OR j.programs_json LIKE ?)`;
    params.push(like, like, like, like, like, like);
  }
  return { sql, params };
}

/** The applications still waiting on HR: the ones moved to the interviews are no longer here. */
const JOIN_US_INBOX_SQL = " AND (a.stage IS NULL OR a.stage NOT IN ('interview','offer'))";

/**
 * Has the interview happened? Graded means held; otherwise its day is over.
 * Undated is upcoming — the same rule as isPastInterview in the admin.
 * `today` is the Cairo day, 'YYYY-MM-DD'.
 */
function interviewHeldSql(a = 'a') {
  return `(${a}.interview_grade IS NOT NULL OR ${a}.second_interview_grade IS NOT NULL
           OR (${a}.interview_at IS NOT NULL AND DATE(${a}.interview_at) < ?))`;
}

/** The narrowing for the interviews, before the upcoming/past split. a = job_applicants, j = job_postings. */
function interviewFilterSql(query = {}) {
  let sql = '';
  const params = [];
  if (query.view === 'interview' || query.view === 'offer') {
    sql += ' AND a.stage = ?';
    params.push(query.view);
  }
  if (query.job) { sql += ' AND a.job_id = ?'; params.push(String(query.job)); }
  if (query.branch) {
    sql += " AND LOWER(COALESCE(NULLIF(a.branch,''), NULLIF(j.branch,''), '')) = ?";
    params.push(String(query.branch).toLowerCase());
  }
  const experience = experienceSql('a.experience_years', String(query.minExp || ''));
  sql += experience.sql;
  params.push(...experience.params);
  if (query.grade === 'none') {
    sql += ' AND a.interview_grade IS NULL AND a.second_interview_grade IS NULL';
  } else if (GRADES.includes(String(query.grade || ''))) {
    sql += ' AND (a.interview_grade = ? OR a.second_interview_grade = ?)';
    params.push(String(query.grade), String(query.grade));
  }
  if (String(query.q || '').trim()) {
    const like = likeOf(query.q);
    sql += ' AND (a.name LIKE ? OR a.phone LIKE ? OR a.email LIKE ? OR a.specialty LIKE ?)';
    params.push(like, like, like, like);
  }
  return { sql, params };
}

/** `limit`/`offset` from a query string, bounded. */
function pageOf(query = {}, { fallback = 50, max = 200 } = {}) {
  const limit = Math.min(max, Math.max(1, Math.floor(Number(query.limit)) || fallback));
  const offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
  return { limit, offset };
}

module.exports = {
  EXPERIENCE_ORDER, JOIN_STATUSES, GRADES,
  JOIN_US_INBOX_SQL, joinUsFilterSql, interviewFilterSql, interviewHeldSql, experienceSql, likeOf, pageOf,
};
