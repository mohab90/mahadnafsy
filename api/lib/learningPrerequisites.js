'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');

const SUBJECT_TYPES = new Set(['course', 'bundle', 'cohort']);
const REQUIREMENT_TYPES = new Set(['completion', 'entitlement']);

async function assertLearningPrerequisites({
  tenantId, subscriberId, subjectType, subjectId,
}, db = pool) {
  const type = String(subjectType || '').toLowerCase();
  if (!SUBJECT_TYPES.has(type)) {
    const error = new Error('Invalid learning prerequisite subject type'); error.statusCode = 400; throw error;
  }
  const [rules] = await db.query(
    `SELECT p.prerequisite_course_id,p.requirement_type,c.title
       FROM learning_prerequisites p
       JOIN courses c ON c.id=p.prerequisite_course_id AND c.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.subject_type=? AND p.subject_id=?`,
    [tenantId, type, subjectId]
  );
  if (!rules.length) return true;
  const [facts] = await db.query(
    `SELECT p.prerequisite_course_id,
            EXISTS(SELECT 1 FROM enrollments e
              WHERE e.tenant_id=? AND e.subscriber_id=? AND e.course_id=p.prerequisite_course_id
                AND e.status='active') AS has_entitlement,
            EXISTS(SELECT 1 FROM course_completions cc
              WHERE cc.tenant_id=? AND cc.subscriber_id=? AND cc.course_id=p.prerequisite_course_id
                AND cc.status='active') AS has_completion
       FROM learning_prerequisites p
      WHERE p.tenant_id=? AND p.subject_type=? AND p.subject_id=?`,
    [tenantId, subscriberId, tenantId, subscriberId, tenantId, type, subjectId]
  );
  const byCourse = new Map(facts.map(row => [String(row.prerequisite_course_id), row]));
  const missing = rules.filter(rule => {
    const fact = byCourse.get(String(rule.prerequisite_course_id));
    return rule.requirement_type === 'entitlement' ? !fact?.has_entitlement : !fact?.has_completion;
  });
  if (missing.length) {
    const error = new Error(`Learning prerequisites are not satisfied: ${missing.map(rule => rule.title || rule.prerequisite_course_id).join(', ')}`);
    error.statusCode = 409;
    error.missing = missing;
    throw error;
  }
  return true;
}

async function listLearningPrerequisites(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT p.id,p.subject_type AS subjectType,p.subject_id AS subjectId,
            p.prerequisite_course_id AS prerequisiteCourseId,p.requirement_type AS requirementType,
            c.title AS prerequisiteCourseTitle,p.created_at AS createdAt
       FROM learning_prerequisites p
       JOIN courses c ON c.id=p.prerequisite_course_id AND c.tenant_id=p.tenant_id
      WHERE p.tenant_id=? ORDER BY p.subject_type,p.subject_id,c.title`,
    [tenantId]
  );
  return rows;
}

async function replaceLearningPrerequisites({
  tenantId, subjectType, subjectId, rules, actor = null,
}, db) {
  if (!db) throw new Error('replaceLearningPrerequisites requires a transaction connection');
  const type = String(subjectType || '').toLowerCase();
  if (!SUBJECT_TYPES.has(type) || !subjectId || !Array.isArray(rules)) {
    const error = new Error('Valid subject and rules are required'); error.statusCode = 400; throw error;
  }
  const subjectTables = { course: 'courses', bundle: 'bundles', cohort: 'course_cohorts' };
  const [[subject]] = await db.query(
    `SELECT id FROM ${subjectTables[type]} WHERE tenant_id=? AND id=?${type === 'cohort' ? '' : ' AND deleted_at IS NULL'} LIMIT 1`,
    [tenantId, subjectId]
  );
  if (!subject) {
    const error = new Error('Learning prerequisite subject not found'); error.statusCode = 404; throw error;
  }
  await db.query(
    'DELETE FROM learning_prerequisites WHERE tenant_id=? AND subject_type=? AND subject_id=?',
    [tenantId, type, subjectId]
  );
  for (const rule of rules) {
    const requirement = String(rule.requirementType || 'completion').toLowerCase();
    if (!REQUIREMENT_TYPES.has(requirement)) {
      const error = new Error('Invalid prerequisite requirement type'); error.statusCode = 400; throw error;
    }
    if (type === 'course' && String(rule.prerequisiteCourseId) === String(subjectId)) {
      const error = new Error('A course cannot require itself'); error.statusCode = 400; throw error;
    }
    const [[course]] = await db.query(
      'SELECT id FROM courses WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1',
      [tenantId, rule.prerequisiteCourseId]
    );
    if (!course) {
      const error = new Error('Prerequisite course not found'); error.statusCode = 404; throw error;
    }
    await db.query(
      `INSERT INTO learning_prerequisites
       (id,tenant_id,subject_type,subject_id,prerequisite_course_id,requirement_type,created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [uuidv4(), tenantId, type, subjectId, course.id, requirement, actor]
    );
  }
  return listLearningPrerequisites(tenantId, db);
}

module.exports = {
  assertLearningPrerequisites,
  listLearningPrerequisites,
  replaceLearningPrerequisites,
};
