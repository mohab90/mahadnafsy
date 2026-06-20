'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { sendEmail, htmlEmail } = require('../lib/email');
const { createNotification } = require('../lib/notification');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../lib/logger').child({ route: 'progress' });

// Client saves their own lecture progress. Completing all course lectures at >=90%
// creates a course completion and notifies the learner/admin.
router.patch('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const emailNorm = email?.toLowerCase().trim() || '';
    if (!emailNorm && !uid) return res.status(400).json({ error: 'No identity in token' });

    const { lectureId, pct } = req.body || {};
    if (!lectureId || pct === undefined) return res.status(400).json({ error: 'lectureId and pct required' });

    const progress = Math.min(100, Math.max(0, Number(pct) || 0));
    const [[sub]] = await pool.query(
      'SELECT id, crm_json FROM subscribers WHERE firebase_uid = ? OR LOWER(TRIM(email)) = ? LIMIT 1',
      [uid || '', emailNorm]
    );
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });

    const crm = tryJson(sub.crm_json, {});
    crm.lectureProgress = { ...(crm.lectureProgress || {}), [lectureId]: progress };
    await pool.query('UPDATE subscribers SET crm_json = ? WHERE id = ?', [JSON.stringify(crm), sub.id]);

    let completionData = null;
    if (progress >= 90) {
      try {
        const [[lec]] = await pool.query('SELECT course_id FROM course_lectures WHERE id=? LIMIT 1', [lectureId]);
        if (lec?.course_id) {
          const courseId = lec.course_id;
          const [[alreadyDone]] = await pool.query(
            'SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=? LIMIT 1',
            [sub.id, courseId]
          );
          if (!alreadyDone) {
            const [allLecs] = await pool.query('SELECT id FROM course_lectures WHERE course_id=?', [courseId]);
            if (allLecs.length > 0) {
              const lp = crm.lectureProgress || {};
              const allWatched = allLecs.every(l => (lp[l.id] || 0) >= 90);
              if (allWatched) {
                const certCode = 'MHAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
                await pool.query(
                  'INSERT IGNORE INTO course_completions (id, subscriber_id, course_id, certificate_code) VALUES (UUID(),?,?,?)',
                  [sub.id, courseId, certCode]
                );
                const [[course]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [courseId]);
                const [[subInfo]] = await pool.query('SELECT name FROM subscribers WHERE id=? LIMIT 1', [sub.id]);

                if (emailNorm) {
                  sendEmail(
                    emailNorm,
                    `🎓 مبروك! أتممت كورس "${course?.title || ''}"`,
                    htmlEmail('شهادة إتمام', `
                      <p>مبروك <strong>${subInfo?.name || ''}</strong>!</p>
                      <p>لقد أتممت بنجاح كورس <strong>${course?.title || ''}</strong>.</p>
                      <p>كود الشهادة الرقمية الخاص بك:</p>
                      <div class="otp-box">${certCode}</div>
                      <p>يمكنك التحقق من الشهادة على موقعنا باستخدام هذا الكود.</p>
                    `)
                  ).catch(() => {});
                }

                await createNotification(
                  'certificate',
                  'إتمام كورس',
                  `${subInfo?.name || emailNorm} أتم كورس "${course?.title || ''}"`,
                  { courseId, certCode }
                );
                completionData = { completed: true, certCode };
              }
            }
          }
        }
      } catch (error) {
        logger.warn('completion check error', { error: error.message });
      }
    }

    res.json({ ok: true, ...(completionData || {}) });
  } catch (error) {
    logger.error('save progress failed', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/subscribers/:id/progress', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subId = req.params.id;
    const [lpRows] = await pool.query(
      `SELECT lp.*, cl.title AS lecture_title, cl.course_id, c.title AS course_title
       FROM lecture_progress lp
       LEFT JOIN course_lectures cl ON cl.id = lp.lecture_id
       LEFT JOIN courses c ON c.id = lp.course_id
       WHERE lp.subscriber_id = ?
       ORDER BY lp.updated_at DESC`,
      [subId]
    );

    const [[sub]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subId]);
    const crm = tryJson(sub?.crm_json, {});
    const crmProgress = crm.lectureProgress || {};
    const enrolledIds = (crm.enrolledCourseIds || []).filter(id => !id.startsWith('bundle:'));
    const courseStats = [];

    if (enrolledIds.length > 0) {
      const ph = enrolledIds.map(() => '?').join(',');
      const [allLectures] = await pool.query(
        `SELECT id, title, course_id FROM course_lectures WHERE course_id IN (${ph}) ORDER BY course_id, sort_order`,
        enrolledIds
      );
      const [allCourses] = await pool.query(`SELECT id, title FROM courses WHERE id IN (${ph})`, enrolledIds);
      const lecturesByCourse = {};
      allLectures.forEach(l => { (lecturesByCourse[l.course_id] = lecturesByCourse[l.course_id] || []).push(l); });
      const courseMap = Object.fromEntries(allCourses.map(c => [c.id, c.title]));

      for (const courseId of enrolledIds) {
        const lectures = lecturesByCourse[courseId] || [];
        const total = lectures.length;
        const completed = lectures.filter(l => (crmProgress[l.id] || 0) >= 90).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        courseStats.push({ courseId, courseTitle: courseMap[courseId] || courseId, total, completed, pct });
      }
    }

    res.json({ lpRows, crmProgress, courseStats });
  } catch (error) {
    logger.error('admin progress failed', { error: error.message, subscriberId: req.params.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
