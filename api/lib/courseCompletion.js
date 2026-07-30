'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { certificateCode, writeCertificateEvent } = require('./certificateLifecycle');
const outbox = require('./outbox');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function completeCourse({
  tenantId, subscriberId, courseId, actor = 'system', requireFullProgress = true, reason = null,
}, db = null) {
  if (!tenantId || !subscriberId || !courseId) {
    const error = new Error('tenantId, subscriberId and courseId are required'); error.statusCode = 400; throw error;
  }
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const [[eligibility]] = await conn.query(
      `SELECT s.id AS subscriber_id,s.name,s.email,c.id AS course_id,c.title,c.price_egp,e.id AS enrollment_id
         FROM subscribers s
         JOIN enrollments e ON e.subscriber_id=s.id AND e.tenant_id=s.tenant_id AND e.course_id=?
          AND e.status='active' AND e.access_type='full'
         JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id AND c.deleted_at IS NULL
        WHERE s.id=? AND s.tenant_id=? AND s.deleted_at IS NULL
          AND (COALESCE(c.price_egp,0)<=0 OR EXISTS (
            SELECT 1 FROM payments p
             WHERE p.tenant_id=s.tenant_id AND p.subscriber_id=s.id AND p.status='paid' AND p.deleted_at IS NULL
               AND (p.course_id=c.id OR EXISTS (SELECT 1 FROM bundle_courses bc
                 WHERE bc.tenant_id=p.tenant_id AND bc.bundle_id=p.bundle_id AND bc.course_id=c.id))
          )) LIMIT 1 FOR UPDATE`,
      [courseId, subscriberId, tenantId]
    );
    if (!eligibility) {
      const error = new Error('Paid tenant enrollment is required'); error.statusCode = 409; throw error;
    }
    if (requireFullProgress) {
      const [[progress]] = await conn.query(
        `SELECT COUNT(cl.id) AS total,SUM(CASE WHEN COALESCE(lc.progress_pct,0)>=100 THEN 1 ELSE 0 END) AS completed
           FROM course_lectures cl
           LEFT JOIN lecture_completions lc ON lc.lecture_id=cl.id AND lc.subscriber_id=? AND lc.tenant_id=?
          WHERE cl.course_id=? AND cl.is_published=1`,
        [subscriberId, tenantId, courseId]
      );
      if (!Number(progress?.total) || Number(progress.completed) < Number(progress.total)) {
        const error = new Error('All published lectures must be completed'); error.statusCode = 409; throw error;
      }
      const [[quizGate]] = await conn.query(
        `SELECT COUNT(*) AS required_count,
                SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM quiz_attempts qa
                   WHERE qa.tenant_id=q.tenant_id AND qa.subscriber_id=? AND qa.quiz_id=q.id
                     AND qa.passed=1
                ) THEN 1 ELSE 0 END) AS passed_count
           FROM course_quizzes q
          WHERE q.tenant_id=? AND q.course_id=? AND q.required_for_completion=1`,
        [subscriberId, tenantId, courseId]
      );
      if (Number(quizGate?.passed_count || 0) < Number(quizGate?.required_count || 0)) {
        const error = new Error('All required course quizzes must be passed'); error.statusCode = 409; throw error;
      }
    }
    const [[existing]] = await conn.query(
      'SELECT id,certificate_code,completed_at,status,version FROM course_completions WHERE subscriber_id=? AND course_id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [subscriberId, courseId, tenantId]
    );
    if (existing) {
      if (ownsConnection) await conn.commit();
      return { ...existing, alreadyCompleted: true };
    }
    const id = uuidv4();
    const code = certificateCode();
    const [inserted] = await conn.query(
      `INSERT IGNORE INTO course_completions
       (id,subscriber_id,course_id,certificate_code,completed_at,status,version,tenant_id)
       VALUES (?,?,?,?,NOW(),'active',1,?)`,
      [id, subscriberId, courseId, code, tenantId]
    );
    if (!inserted.affectedRows) {
      const [[concurrent]] = await conn.query(
        'SELECT id,certificate_code,completed_at,status,version FROM course_completions WHERE subscriber_id=? AND course_id=? AND tenant_id=? LIMIT 1',
        [subscriberId, courseId, tenantId]
      );
      if (ownsConnection) await conn.commit();
      return { ...concurrent, alreadyCompleted: true };
    }
    await writeCertificateEvent(conn, {
      tenantId, completionId: id, eventType: 'issued', newCode: code, actor,
      reason: reason ? String(reason).trim().slice(0, 500) : null,
      meta: { completionMode: requireFullProgress ? 'automatic' : 'manual_override' },
    });
    if (eligibility.email) {
      const base = String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/$/, '');
      await outbox.enqueue({
        channel: 'email', recipient: eligibility.email, subject: `شهادة إتمام ${eligibility.title || 'الكورس'}`,
        payload: { html: `<div dir="rtl"><h2>مبروك ${escapeHtml(eligibility.name)}</h2><p>تم إصدار شهادة إتمام ${escapeHtml(eligibility.title || 'الكورس')}.</p><p><a href="${escapeHtml(base)}/certificate/${encodeURIComponent(code)}">عرض الشهادة</a></p></div>` },
        tenantId, dedupeKey: `course-completion:${tenantId}:${subscriberId}:${courseId}`, refType: 'course_completion', refId: id,
      }, conn);
    }
    if (ownsConnection) await conn.commit();
    return { id, certificate_code: code, alreadyCompleted: false, actor };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally { if (ownsConnection) conn.release(); }
}

async function completeCourses({
  tenantId, subscriberIds, courseId, actor, requireFullProgress = true, reason = null,
}) {
  const ids = [...new Set((subscriberIds || []).map(String).filter(Boolean))];
  if (!ids.length || ids.length > 500) {
    const error = new Error('subscriberIds must contain 1-500 unique ids'); error.statusCode = 400; throw error;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const results = [];
    for (const subscriberId of ids) {
      results.push({
        subscriberId,
        ...(await completeCourse({
          tenantId, subscriberId, courseId, actor, requireFullProgress, reason,
        }, conn)),
      });
    }
    await conn.commit();
    return results;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

module.exports = { completeCourse, completeCourses, certificateCode };
