'use strict';
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson, validate } = require('../lib/helpers');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE v23: Progress Tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// POST /api/me/progress â€” mark a lecture complete (or update watch progress)
router.post('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const { lecture_id, course_id, progress_pct, watch_seconds } = req.body;
    if (!lecture_id) return res.status(400).json({ error: 'lecture_id required' });
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const pct = Math.min(100, Math.max(0, Number(progress_pct) || 100));
    await pool.query(
      `INSERT INTO lecture_completions (id, subscriber_id, lecture_id, course_id, progress_pct, watch_seconds, completed_at)
       VALUES (UUID(),?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE
         progress_pct=GREATEST(progress_pct,VALUES(progress_pct)),
         watch_seconds=GREATEST(watch_seconds,VALUES(watch_seconds)),
         completed_at=IF(VALUES(progress_pct)>=100, NOW(), completed_at)`,
      [sub.id, lecture_id, course_id || null, pct, Number(watch_seconds) || 0]
    );

    // â”€â”€ Auto-certificate check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (course_id) {
      try {
        // Video progress %
        const [[{ total_lectures }]] = await pool.query(
          'SELECT COUNT(*) AS total_lectures FROM lectures WHERE course_id=?', [course_id]);
        const [[{ completed_count }]] = await pool.query(
          'SELECT COUNT(*) AS completed_count FROM lecture_completions WHERE subscriber_id=? AND course_id=? AND progress_pct>=100',
          [sub.id, course_id]);
        const progressPct = total_lectures > 0 ? (completed_count / total_lectures * 100) : 0;

        // Payment %
        const [[{ total_paid }]] = await pool.query(
          "SELECT COALESCE(SUM(amount),0) AS total_paid FROM payments WHERE subscriber_id=? AND course_id=? AND status IN ('paid','confirmed')",
          [sub.id, course_id]);
        const [[courseRow]] = await pool.query('SELECT price, title FROM courses WHERE id=?', [course_id]);
        const paymentPct = (courseRow && courseRow.price > 0) ? (total_paid / courseRow.price * 100) : 100;

        // Thresholds from site_config
        const [[thP]] = await pool.query("SELECT value FROM site_config WHERE `key`='cert_auto_threshold_progress'").catch(() => [[null]]);
        const [[thPay]] = await pool.query("SELECT value FROM site_config WHERE `key`='cert_auto_threshold_payment'").catch(() => [[null]]);
        const threshProgress = parseFloat(thP?.value || '70');
        const threshPayment  = parseFloat(thPay?.value || '90');

        if (progressPct >= threshProgress && paymentPct >= threshPayment) {
          const [[existingCert]] = await pool.query(
            'SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=?', [sub.id, course_id]);
          if (!existingCert) {
            const certCode = `PSY${new Date().getFullYear()}${Math.random().toString(36).slice(2,8).toUpperCase()}`;
            await pool.query(
              'INSERT INTO course_completions (id, subscriber_id, course_id, certificate_code, completed_at) VALUES (UUID(),?,?,?,NOW())',
              [sub.id, course_id, certCode]);
            // Send congratulations email
            const [[subInfo]] = await pool.query('SELECT email, name FROM subscribers WHERE id=?', [sub.id]).catch(() => [[null]]);
            if (subInfo?.email) {
              const certUrl = `${process.env.CLIENT_URL || ''}/certificate/${certCode}`;
              sendEmail(
                subInfo.email,
                `ðŸŽ“ Ù…Ø¨Ø±ÙˆÙƒ! Ø´Ù‡Ø§Ø¯Ø© Ø¥ØªÙ…Ø§Ù… ${courseRow?.title || 'Ø§Ù„ÙƒÙˆØ±Ø³'} Ø¬Ø§Ù‡Ø²Ø©`,
                `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                  <h2 style="color:#7c3aed">ðŸŽ“ Ù…Ø¨Ø±ÙˆÙƒ ÙŠØ§ ${subInfo.name || ''}!</h2>
                  <p>Ø£ØªÙ…Ù…Øª <strong>${Math.round(progressPct)}%</strong> Ù…Ù† Ù…Ø­ØªÙˆÙ‰ Ø§Ù„ÙƒÙˆØ±Ø³ ÙˆØ£ÙƒÙ…Ù„Øª Ù…ØªØ·Ù„Ø¨Ø§Øª Ø§Ù„Ø¯ÙØ¹ â€” Ø´Ù‡Ø§Ø¯ØªÙƒ Ø¬Ø§Ù‡Ø²Ø© Ø§Ù„Ø¢Ù†!</p>
                  <p><a href="${certUrl}" style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Ø¹Ø±Ø¶ Ø§Ù„Ø´Ù‡Ø§Ø¯Ø©</a></p>
                  <p style="color:#666;font-size:12px">Ø±Ù‚Ù… Ø§Ù„Ø´Ù‡Ø§Ø¯Ø©: ${certCode}</p>
                </div>`
              ).catch(() => {});
            }
          }
        }
      } catch (_certErr) { /* don't fail the main request if cert check errors */ }
    }
    // â”€â”€ End auto-certificate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/me/progress?course_id=xxx â€” get all lecture completions for subscriber
router.get('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!sub) return res.json([]);
    const { course_id } = req.query;
    let sql = 'SELECT lecture_id, course_id, progress_pct, watch_seconds, completed_at FROM lecture_completions WHERE subscriber_id=?';
    const params = [sub.id];
    if (course_id) { sql += ' AND course_id=?'; params.push(course_id); }
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/courses/:courseId/progress â€” admin: completion stats per lecture
router.get('/api/admin/courses/:courseId/progress', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT lc.lecture_id, l.title AS lecture_title,
             COUNT(lc.id) AS completions,
             ROUND(AVG(lc.progress_pct),1) AS avg_pct,
             ROUND(AVG(lc.watch_seconds),0) AS avg_watch_sec
      FROM lecture_completions lc
      LEFT JOIN lectures l ON l.id=lc.lecture_id
      WHERE lc.course_id=?
      GROUP BY lc.lecture_id
      ORDER BY completions DESC
    `, [req.params.courseId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE v23: Drip Content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/me/lectures/:lectureId/access â€” check if subscriber can access this lecture
router.get('/api/me/lectures/:lectureId/access', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!sub) return res.status(403).json({ accessible: false, reason: 'not_subscribed' });
    const [[lecture]] = await pool.query(
      'SELECT id, course_id, sort_order, drip_unlock_days FROM course_lectures WHERE id=? LIMIT 1',
      [req.params.lectureId]
    );
    if (!lecture) return res.status(404).json({ accessible: false, reason: 'not_found' });
    // Check enrollment â€” must match this specific course
    const [[enrolled]] = await pool.query(
      'SELECT enrolled_at, access_type, lecture_limit FROM enrollments WHERE subscriber_id=? AND course_id=? LIMIT 1',
      [sub.id, lecture.course_id]
    );
    if (!enrolled) return res.json({ accessible: false, reason: 'not_enrolled' });
    // Access limit check: if enrollment is 'limited', verify lecture position is within allowed count
    if (enrolled.access_type === 'limited' && enrolled.lecture_limit) {
      const limit = Number(enrolled.lecture_limit);
      // Get lecture's 0-based position in the course by sort_order
      const [[posRow]] = await pool.query(
        'SELECT COUNT(*) AS pos FROM course_lectures WHERE course_id=? AND sort_order < ?',
        [lecture.course_id, lecture.sort_order]
      );
      const lectureIndex = Number(posRow?.pos ?? 0); // 0-based index
      if (lectureIndex >= limit) {
        return res.json({ accessible: false, reason: 'access_limited', allowed: limit, position: lectureIndex + 1 });
      }
    }
    // Drip check
    const dripDays = Number(lecture.drip_unlock_days) || 0;
    if (dripDays > 0) {
      const enrolledAt = new Date(enrolled.enrolled_at);
      const unlockAt = new Date(enrolledAt.getTime() + dripDays * 86400000);
      if (Date.now() < unlockAt.getTime()) {
        return res.json({ accessible: false, reason: 'drip_locked', unlocks_at: unlockAt.toISOString() });
      }
    }
    res.json({ accessible: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/lectures/:lectureId/drip â€” set drip_unlock_days
router.patch('/api/admin/lectures/:lectureId/drip', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = Math.max(0, Number(req.body.drip_unlock_days) || 0);
    await pool.query('UPDATE lectures SET drip_unlock_days=? WHERE id=?', [days, req.params.lectureId]);
    res.json({ ok: true, drip_unlock_days: days });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE v23: Live Sessions (Zoom / Google Meet) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/admin/live-sessions?course_id=
router.get('/api/admin/live-sessions', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { course_id } = req.query;
    let sql = `SELECT ls.*, c.title AS course_title FROM live_sessions ls LEFT JOIN courses c ON c.id=ls.course_id WHERE 1=1`;
    const params = [];
    if (course_id) { sql += ' AND ls.course_id=?'; params.push(course_id); }
    sql += ' ORDER BY ls.starts_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/live-sessions â€” create a live session
router.post('/api/admin/live-sessions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at, duration_min, notes } = req.body;
    if (!meeting_url || !starts_at) return res.status(400).json({ error: 'meeting_url and starts_at required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO live_sessions (id, course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at, duration_min, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, course_id||null, title||'', platform||'zoom', meeting_url, meeting_id||null, meeting_pass||null,
       starts_at, duration_min||60, notes||null, req.user?.email||'admin']
    );
    // Notify all enrolled students (best-effort)
    if (course_id) {
      setImmediate(async () => {
        try {
          const [enrolled] = await pool.query(
            `SELECT s.email, s.name, s.phone FROM enrollments e JOIN subscribers s ON s.id=e.subscriber_id WHERE e.course_id=?`,
            [course_id]
          );
          const sessionDate = new Date(starts_at).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' });
          for (const st of enrolled) {
            if (st.email) {
              sendEmail(st.email, `ðŸ”´ Ø¬Ù„Ø³Ø© Ù„Ø§ÙŠÙ Ø¬Ø¯ÙŠØ¯Ø© â€” ${title||''}`,
                `<div dir="rtl"><h2>ØªÙ… Ø¬Ø¯ÙˆÙ„Ø© Ø¬Ù„Ø³Ø© Ù„Ø§ÙŠÙ Ø¬Ø¯ÙŠØ¯Ø©</h2><p>Ø£Ù‡Ù„Ø§Ù‹ ${st.name||''}ØŒ</p><p>ØªÙ… ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆØ¹Ø¯ Ø¬Ù„Ø³Ø© Ù„Ø§ÙŠÙ Ø¨ØªØ§Ø±ÙŠØ® <strong>${sessionDate}</strong></p><p><a href="${meeting_url}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Ø§Ù†Ø¶Ù… Ù„Ù„Ø¬Ù„Ø³Ø©</a></p>${meeting_pass?`<p>ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±: <strong>${meeting_pass}</strong></p>`:''}</div>`
              ).catch(() => {});
            }
            if (st.phone) {
              sendWhatsApp(st.phone, `ðŸ”´ Ø¬Ù„Ø³Ø© Ù„Ø§ÙŠÙ Ø¬Ø¯ÙŠØ¯Ø©!\nðŸ“… ${sessionDate}\nðŸ”— ${meeting_url}${meeting_pass?`\nðŸ”‘ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±: ${meeting_pass}`:''}`).catch(() => {});
            }
          }
        } catch (_) {}
      });
    }
    const [[row]] = await pool.query(
      `SELECT id, course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at,
              duration_min, status, recording_url, notes, created_by, created_at
       FROM live_sessions WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/live-sessions/:id â€” update status/recording
router.patch('/api/admin/live-sessions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const allowed = ['title','platform','meeting_url','meeting_id','meeting_pass','starts_at','duration_min','status','recording_url','notes'];
    const sets = []; const vals = [];
    for (const k of allowed) { if (req.body[k] !== undefined) { sets.push(`${k}=?`); vals.push(req.body[k]); } }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await pool.query(`UPDATE live_sessions SET ${sets.join(',')} WHERE id=?`, vals);
    const [[row]] = await pool.query(
      `SELECT id, course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at,
              duration_min, status, recording_url, notes, created_by, created_at
       FROM live_sessions WHERE id=?`, [req.params.id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/me/live-sessions â€” get upcoming live sessions for enrolled courses
router.get('/api/me/live-sessions', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!sub) return res.json([]);
    const [rows] = await pool.query(`
      SELECT ls.id, ls.course_id, ls.title, ls.platform, ls.meeting_url,
             ls.meeting_id, ls.meeting_pass, ls.starts_at, ls.duration_min,
             ls.status, ls.recording_url, ls.notes, c.title AS course_title
      FROM live_sessions ls
      JOIN courses c ON c.id=ls.course_id
      JOIN enrollments e ON e.course_id=ls.course_id AND e.subscriber_id=?
      WHERE ls.starts_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        AND ls.status IN ('scheduled','live')
      ORDER BY ls.starts_at ASC
    `, [sub.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE v23: Email Sequences â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/admin/email-sequences
router.get('/api/admin/email-sequences', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [seqs] = await pool.query(
      'SELECT id, name, trigger_event, is_active, created_at FROM email_sequences ORDER BY created_at DESC'
    );
    // Batch-load all steps in 1 query instead of N
    const seqIds = seqs.map(s => s.id);
    const allSteps = seqIds.length
      ? (await pool.query('SELECT id, sequence_id, step_order, delay_hours, subject FROM email_sequence_steps WHERE sequence_id IN (?) ORDER BY step_order', [seqIds]))[0]
      : [];
    const stepsMap = {};
    for (const st of allSteps) { (stepsMap[st.sequence_id] = stepsMap[st.sequence_id] || []).push(st); }
    for (const s of seqs) s.steps = stepsMap[s.id] || [];
    res.json(seqs);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/email-sequences â€” create sequence with steps
router.post('/api/admin/email-sequences', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, trigger_event, is_active, steps } = req.body;
    if (!name || !trigger_event) return res.status(400).json({ error: 'name and trigger_event required' });
    const seqId = uuidv4();
    await pool.query(
      'INSERT INTO email_sequences (id, name, trigger_event, is_active) VALUES (?,?,?,?)',
      [seqId, name, trigger_event, is_active !== false ? 1 : 0]
    );
    if (Array.isArray(steps) && steps.length > 0) {
      // Batch INSERT steps in 1 query instead of N
      const stepRows = steps.map(() => '(UUID(),?,?,?,?,?)');
      const stepParams = steps.flatMap((st, i) => [seqId, i + 1, Number(st.delay_hours) || 0, st.subject || '', st.body_html || '']);
      await pool.query(
        `INSERT INTO email_sequence_steps (id, sequence_id, step_order, delay_hours, subject, body_html) VALUES ${stepRows.join(',')}`,
        stepParams
      );
    }
    const [[seq]] = await pool.query(
      'SELECT id, name, trigger_event, is_active, created_at FROM email_sequences WHERE id=?', [seqId]
    );
    const [stepsOut] = await pool.query(
      'SELECT id, sequence_id, step_order, delay_hours, subject, body_html FROM email_sequence_steps WHERE sequence_id=? ORDER BY step_order',
      [seqId]
    );
    res.json({ ...seq, steps: stepsOut });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/email-sequences/:id
router.delete('/api/admin/email-sequences/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM email_sequence_steps WHERE sequence_id=?', [req.params.id]);
    await pool.query('DELETE FROM email_sequences WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});


// Scheduler: every 5 minutes, send due emails
setInterval(async () => {
  try {
    const [due] = await pool.query(
      `SELECT q.id, q.recipient_email, q.recipient_name, s.subject, s.body_html
       FROM email_sequence_queue q
       JOIN email_sequence_steps s ON s.id=q.step_id
       WHERE q.scheduled_at <= NOW() AND q.sent_at IS NULL AND q.failed_at IS NULL
       LIMIT 20`
    );
    for (const item of due) {
      try {
        await sendEmail(item.recipient_email, item.subject,
          item.body_html.replace(/{{name}}/gi, item.recipient_name || '')
        );
        await pool.query('UPDATE email_sequence_queue SET sent_at=NOW() WHERE id=?', [item.id]);
      } catch (mailErr) {
        await pool.query('UPDATE email_sequence_queue SET failed_at=NOW(), error_msg=? WHERE id=?',
          [mailErr.message?.slice(0,500) || 'error', item.id]);
      }
    }
    if (due.length) console.log(`[email-seq] Sent ${due.length} scheduled emails`);
  } catch (e) { console.warn('[email-seq] scheduler error:', e.message); }
}, 5 * 60 * 1000);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE v23: Employee Self-Service (leaves, payslip, commissions) â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// POST /api/staff/me/leaves â€” employee submits own leave request
// GET /api/staff/me/payslip?month=&year= â€” employee views own payslip
// GET /api/staff/me/commissions?month=&year= â€” employee views own commissions
// â”€â”€ Wire email sequences into registration + enrollment triggers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// (Done via monkey-patch on pool post-insert â€” safer to call from the register handler above
//  but here we expose a helper endpoint that can be called retroactively)
router.post('/api/admin/email-sequences/trigger-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { trigger_event, email, name } = req.body;
    if (!trigger_event || !email) return res.status(400).json({ error: 'trigger_event and email required' });
    await enqueueEmailSequence(trigger_event, email, name || '', Date.now());
    res.json({ ok: true, message: `Enqueued ${trigger_event} sequence for ${email}` });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE: Staff Work Schedule (Weekly Shifts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/admin/staff/:staffId/schedule â€” get weekly schedule
router.get('/api/admin/staff/:staffId/schedule', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, staff_id, day_of_week, start_time, end_time, grace_minutes, is_off_day FROM work_schedules WHERE staff_id = ? ORDER BY day_of_week ASC',
      [req.params.staffId]
    );
    // Ensure all 7 days present (fill missing with defaults)
    const days = ['Ø§Ù„Ø£Ø­Ø¯','Ø§Ù„Ø§Ø«Ù†ÙŠÙ†','Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡','Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡','Ø§Ù„Ø®Ù…ÙŠØ³','Ø§Ù„Ø¬Ù…Ø¹Ø©','Ø§Ù„Ø³Ø¨Øª'];
    const schedule = Array.from({ length: 7 }, (_, i) => {
      const existing = rows.find(r => r.day_of_week === i);
      return existing || { staff_id: req.params.staffId, day_of_week: i, day_name: days[i], start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 15, is_off_day: i === 5 || i === 6 ? 1 : 0 };
    });
    res.json(schedule);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/staff/:staffId/schedule â€” upsert full weekly schedule (array of 7 days)
router.put('/api/admin/staff/:staffId/schedule', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { schedule } = req.body; // array of { day_of_week, start_time, end_time, grace_minutes, is_off_day }
    if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule must be an array' });
    if (schedule.length > 0) {
      // Batch UPSERT entire weekly schedule in 1 query instead of N
      const schedRows = schedule.map(() => '(UUID(), ?, ?, ?, ?, ?, ?)');
      const schedParams = schedule.flatMap(day => [
        req.params.staffId, day.day_of_week, day.start_time || '09:00:00',
        day.end_time || '17:00:00', day.grace_minutes ?? 15, day.is_off_day ? 1 : 0,
      ]);
      await pool.query(
        `INSERT INTO work_schedules (id, staff_id, day_of_week, start_time, end_time, grace_minutes, is_off_day)
         VALUES ${schedRows.join(',')}
         ON DUPLICATE KEY UPDATE
           start_time = VALUES(start_time),
           end_time = VALUES(end_time),
           grace_minutes = VALUES(grace_minutes),
           is_off_day = VALUES(is_off_day)`,
        schedParams
      );
    }
    res.json({ ok: true, updated: schedule.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/schedules â€” all staff schedules overview (for weekly roster view)
router.get('/api/admin/schedules', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ws.*, u.name AS staff_name, u.email AS staff_email, u.role AS staff_role
      FROM work_schedules ws
      JOIN users u ON u.id = ws.staff_id
      WHERE u.is_active = 1
      ORDER BY u.name ASC, ws.day_of_week ASC
    `);
    // Group by staff
    const byStaff = {};
    for (const r of rows) {
      if (!byStaff[r.staff_id]) byStaff[r.staff_id] = { staff_id: r.staff_id, name: r.staff_name, email: r.staff_email, role: r.staff_role, days: [] };
      byStaff[r.staff_id].days.push(r);
    }
    res.json(Object.values(byStaff));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/attendance?staff_id=&from=&to=&status= â€” attendance log
router.get('/api/admin/attendance', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id, from, to, status } = req.query;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const toDate   = to   || new Date().toISOString().slice(0, 10);
    let sql = `
      SELECT al.*, u.name AS staff_name, u.email AS staff_email
      FROM attendance_logs al
      JOIN users u ON u.id = al.staff_id
      WHERE al.date BETWEEN ? AND ?
    `;
    const params = [fromDate, toDate];
    if (staff_id) { sql += ' AND al.staff_id = ?'; params.push(staff_id); }
    if (status)   { sql += ' AND al.status = ?';   params.push(status); }
    sql += ' ORDER BY al.date DESC, u.name ASC LIMIT 2000';
    const [rows] = await pool.query(sql, params);

    // Summary stats
    const summary = {
      present: rows.filter(r => r.status === 'PRESENT').length,
      absent: rows.filter(r => r.status === 'ABSENT').length,
      late: rows.filter(r => r.status === 'LATE').length,
      leave: rows.filter(r => r.status === 'LEAVE').length,
      total: rows.length
    };
    res.json({ logs: rows, summary, period: { from: fromDate, to: toDate } });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/attendance â€” log a single attendance record
router.post('/api/admin/attendance', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id, date, check_in, check_out, status, notes } = req.body;
    if (!staff_id || !date) return res.status(400).json({ error: 'staff_id and date required' });
    const totalHours = (check_in && check_out)
      ? parseFloat(((new Date(`2000-01-01T${check_out}`) - new Date(`2000-01-01T${check_in}`)) / 3600000).toFixed(2))
      : null;
    await pool.query(
      `INSERT INTO attendance_logs (id, staff_id, date, check_in, check_out, total_hours, status, notes, source)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'MANUAL_ENTRY')
       ON DUPLICATE KEY UPDATE check_in=VALUES(check_in), check_out=VALUES(check_out),
         total_hours=VALUES(total_hours), status=VALUES(status), notes=VALUES(notes)`,
      [staff_id, date, check_in || null, check_out || null, totalHours, status || 'PRESENT', notes || null]
    );
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/me/schedule â€” employee views own schedule
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE: Performance Appraisals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Auto-create table at startup
pool.query(`
  CREATE TABLE IF NOT EXISTS performance_appraisals (
    id              VARCHAR(36)  NOT NULL DEFAULT (UUID()),
    staff_id        VARCHAR(36)  NOT NULL,
    reviewer_email  VARCHAR(200) NULL,
    period_month    TINYINT      NOT NULL COMMENT '1-12',
    period_year     SMALLINT     NOT NULL,
    kpi_scores      JSON         NULL     COMMENT 'array of {kpi,target,achieved,score}',
    overall_score   DECIMAL(5,2) NULL     COMMENT '0-100',
    grade           VARCHAR(10)  NULL     COMMENT 'A/B/C/D',
    notes           TEXT         NULL,
    status          ENUM('draft','submitted','approved') NOT NULL DEFAULT 'draft',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_pa_staff  (staff_id),
    KEY idx_pa_period (period_year, period_month)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(e => console.warn('[schema] performance_appraisals:', e.message));

// GET /api/admin/appraisals?staff_id=&year=&month=&status=
router.get('/api/admin/appraisals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, year, month, status } = req.query;
    let sql = `
      SELECT pa.*, u.name AS staff_name, u.email AS staff_email, u.role AS staff_role
      FROM performance_appraisals pa
      LEFT JOIN users u ON u.id = pa.staff_id
      WHERE 1=1
    `;
    const params = [];
    if (staff_id) { sql += ' AND pa.staff_id = ?'; params.push(staff_id); }
    if (year)     { sql += ' AND pa.period_year = ?'; params.push(parseInt(year)); }
    if (month)    { sql += ' AND pa.period_month = ?'; params.push(parseInt(month)); }
    if (status)   { sql += ' AND pa.status = ?'; params.push(status); }
    sql += ' ORDER BY pa.period_year DESC, pa.period_month DESC, pa.created_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(r => ({ ...r, kpi_scores: tryJson(r.kpi_scores, []) })));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/appraisals â€” create appraisal
router.post('/api/admin/appraisals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, period_month, period_year, kpi_scores, notes, status } = req.body;
    if (!staff_id || !period_month || !period_year) return res.status(400).json({ error: 'staff_id, period_month, period_year required' });

    const kpis = Array.isArray(kpi_scores) ? kpi_scores : [];
    // Calculate overall score: average of kpi score values
    let overall = null;
    if (kpis.length) {
      const scoreSum = kpis.reduce((s, k) => s + (parseFloat(k.score) || 0), 0);
      overall = parseFloat((scoreSum / kpis.length).toFixed(2));
    }
    const grade = overall === null ? null
      : overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : 'D';

    const id = uuidv4();
    await pool.query(
      `INSERT INTO performance_appraisals (id, staff_id, reviewer_email, period_month, period_year, kpi_scores, overall_score, grade, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, staff_id, req.user.email, parseInt(period_month), parseInt(period_year),
       JSON.stringify(kpis), overall, grade, notes || null, status || 'draft']
    );
    res.status(201).json({ id, overall_score: overall, grade, message: 'Appraisal created' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/appraisals/:id â€” update appraisal
router.patch('/api/admin/appraisals/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kpi_scores, notes, status, overall_score } = req.body;
    const fields = []; const params = [];
    if (kpi_scores !== undefined) {
      const kpis = Array.isArray(kpi_scores) ? kpi_scores : [];
      fields.push('kpi_scores = ?'); params.push(JSON.stringify(kpis));
      // Recalculate grade
      if (kpis.length) {
        const scoreSum = kpis.reduce((s, k) => s + (parseFloat(k.score) || 0), 0);
        const overall  = parseFloat((scoreSum / kpis.length).toFixed(2));
        const grade    = overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : 'D';
        fields.push('overall_score = ?', 'grade = ?');
        params.push(overall, grade);
      }
    }
    if (notes !== undefined)         { fields.push('notes = ?');         params.push(notes); }
    if (status !== undefined)        { fields.push('status = ?');        params.push(status); }
    if (overall_score !== undefined) { fields.push('overall_score = ?'); params.push(parseFloat(overall_score)); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE performance_appraisals SET ${fields.join(', ')} WHERE id = ?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Appraisal not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/appraisals/:id
router.delete('/api/admin/appraisals/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM performance_appraisals WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Appraisal not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/me/appraisals â€” employee views own appraisals
// GET /api/admin/appraisals/summary?year= â€” team performance overview
router.get('/api/admin/appraisals/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const [rows] = await pool.query(`
      SELECT
        u.name AS staff_name, u.role AS staff_role,
        COUNT(*) AS appraisal_count,
        AVG(pa.overall_score) AS avg_score,
        MAX(pa.overall_score) AS best_score,
        MIN(pa.overall_score) AS lowest_score,
        SUM(CASE WHEN pa.grade='A' THEN 1 ELSE 0 END) AS grade_a,
        SUM(CASE WHEN pa.grade='B' THEN 1 ELSE 0 END) AS grade_b,
        SUM(CASE WHEN pa.grade='C' THEN 1 ELSE 0 END) AS grade_c,
        SUM(CASE WHEN pa.grade='D' THEN 1 ELSE 0 END) AS grade_d
      FROM performance_appraisals pa
      LEFT JOIN users u ON u.id = pa.staff_id
      WHERE pa.period_year = ? AND pa.status = 'approved'
      GROUP BY pa.staff_id, u.name, u.role
      ORDER BY avg_score DESC
    `, [year]);
    res.json({ year, team: rows.map(r => ({ ...r, avg_score: parseFloat(r.avg_score || 0).toFixed(1) })) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE: Course Waitlist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Ensure waitlist table + capacity column on courses
(async () => {
  try {
    await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_students INT UNSIGNED NULL COMMENT 'NULL = unlimited'");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS course_waitlist (
        id            VARCHAR(36)  NOT NULL DEFAULT (UUID()),
        course_id     VARCHAR(36)  NOT NULL,
        subscriber_id VARCHAR(36)  NULL,
        name          VARCHAR(200) NULL,
        email         VARCHAR(200) NULL,
        phone         VARCHAR(50)  NULL,
        position      INT UNSIGNED NOT NULL DEFAULT 0,
        status        ENUM('waiting','notified','enrolled','cancelled') NOT NULL DEFAULT 'waiting',
        notified_at   DATETIME     NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_wl_course (course_id, status),
        KEY idx_wl_sub    (subscriber_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[schema] course_waitlist + courses.max_students ready');
  } catch (e) { console.warn('[schema] waitlist:', e.message); }
})();

// GET /api/admin/courses/:courseId/waitlist â€” list waitlist entries
router.get('/api/admin/courses/:courseId/waitlist', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { courseId } = req.params;
    const [rows] = await pool.query(
      `SELECT wl.*, s.client_code
       FROM course_waitlist wl
       LEFT JOIN subscribers s ON s.id = wl.subscriber_id
       WHERE wl.course_id = ?
       ORDER BY wl.position ASC, wl.created_at ASC`,
      [courseId]
    );
    const [[{ enrolled }]] = await pool.query(
      "SELECT COUNT(*) AS enrolled FROM enrollments WHERE course_id = ? AND status != 'cancelled'",
      [courseId]
    );
    const [[course]] = await pool.query('SELECT title, max_students FROM courses WHERE id = ?', [courseId]);
    res.json({
      waitlist: rows,
      enrolled: Number(enrolled),
      max_students: course?.max_students || null,
      available_spots: course?.max_students ? Math.max(0, course.max_students - Number(enrolled)) : null
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/courses/:courseId/waitlist â€” add someone to waitlist
router.post('/api/admin/courses/:courseId/waitlist', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { subscriber_id, name, email, phone } = req.body;
    const [[{ maxPos }]] = await pool.query(
      'SELECT COALESCE(MAX(position), 0) AS maxPos FROM course_waitlist WHERE course_id = ?', [courseId]
    );
    const id = uuidv4();
    await pool.query(
      `INSERT INTO course_waitlist (id, course_id, subscriber_id, name, email, phone, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, courseId, subscriber_id || null, name || null, email || null, phone || null, Number(maxPos) + 1]
    );
    res.status(201).json({ id, position: Number(maxPos) + 1 });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/me/waitlist â€” student joins waitlist for a course
router.post('/api/me/waitlist', requireAuth, async (req, res) => {
  try {
    const { course_id } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id required' });
    const [[sub]] = await pool.query('SELECT id, name, email, phone FROM subscribers WHERE email = ? LIMIT 1', [req.user.email]);
    if (!sub) return res.status(403).json({ error: 'Subscriber account required' });

    // Check not already on waitlist
    const [[existing]] = await pool.query(
      "SELECT id FROM course_waitlist WHERE course_id = ? AND subscriber_id = ? AND status IN ('waiting','notified')",
      [course_id, sub.id]
    );
    if (existing) return res.status(409).json({ error: 'Already on waitlist' });

    const [[{ maxPos }]] = await pool.query(
      'SELECT COALESCE(MAX(position), 0) AS maxPos FROM course_waitlist WHERE course_id = ?', [course_id]
    );
    const id = uuidv4();
    const pos = Number(maxPos) + 1;
    await pool.query(
      `INSERT INTO course_waitlist (id, course_id, subscriber_id, name, email, phone, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, course_id, sub.id, sub.name, sub.email, sub.phone, pos]
    );
    res.status(201).json({ id, position: pos, message: 'Added to waitlist' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/courses/:courseId/waitlist/:id â€” update entry status / notify
router.patch('/api/admin/courses/:courseId/waitlist/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { status, notify } = req.body;
    if (status) {
      await pool.query(
        'UPDATE course_waitlist SET status = ?, notified_at = CASE WHEN ? = ? THEN NOW() ELSE notified_at END WHERE id = ? AND course_id = ?',
        [status, status, 'notified', req.params.id, req.params.courseId]
      );
    }
    if (notify) {
      const [[entry]] = await pool.query(
        `SELECT id, course_id, subscriber_id, name, email, phone, position, status, notified_at, created_at
         FROM course_waitlist WHERE id = ?`, [req.params.id]
      );
      const [[course]] = await pool.query('SELECT title FROM courses WHERE id = ?', [req.params.courseId]);
      if (entry?.email) {
        await sendEmail(entry.email, `ØªÙ†Ø¨ÙŠÙ‡: Ù…ØªØ§Ø­ Ù…Ù‚Ø¹Ø¯ ÙÙŠ ÙƒÙˆØ±Ø³ ${course?.title || ''}`,
          `<p>Ù…Ø±Ø­Ø¨Ø§Ù‹ ${entry.name || ''}ØŒ</p>
           <p>ÙŠØ³Ø¹Ø¯Ù†Ø§ Ø¥Ø®Ø¨Ø§Ø±Ùƒ Ø¨ØªÙˆÙØ± Ù…Ù‚Ø¹Ø¯ ÙÙŠ ÙƒÙˆØ±Ø³ <strong>${course?.title || ''}</strong>.</p>
           <p>ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªÙˆØ§ØµÙ„ Ù…Ø¹Ù†Ø§ ÙÙŠ Ø£Ù‚Ø±Ø¨ ÙˆÙ‚Øª Ù„ØªØ£ÙƒÙŠØ¯ Ø§Ù„ØªØ³Ø¬ÙŠÙ„.</p>
           <p>ÙØ±ÙŠÙ‚ ${entry._instituteName || 'Ù…Ø¹Ù‡Ø¯ Ù…Ù‡Ø§Ø¯'}</p>`
        ).catch(() => {});
        await pool.query('UPDATE course_waitlist SET status = ?, notified_at = NOW() WHERE id = ?', ['notified', req.params.id]);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/courses/:courseId/capacity â€” set max_students
router.patch('/api/admin/courses/:courseId/capacity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { max_students } = req.body;
    await pool.query('UPDATE courses SET max_students = ? WHERE id = ?',
      [max_students ? parseInt(max_students) : null, req.params.courseId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE: Auto Course Completion + Certificate Generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// POST /api/admin/completions â€” admin marks a subscriber as completing a course
// Idempotent: if already completed, returns existing certificate
router.post('/api/admin/completions', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { subscriber_id, course_id } = req.body;
    if (!subscriber_id || !course_id) return res.status(400).json({ error: 'subscriber_id and course_id required' });

    // Check if already completed
    const [[existing]] = await pool.query(
      'SELECT id, subscriber_id, course_id, completed_at, certificate_code, email_sent FROM course_completions WHERE subscriber_id = ? AND course_id = ?',
      [subscriber_id, course_id]
    );
    if (existing) return res.json({ id: existing.id, certificate_code: existing.certificate_code, already_completed: true });

    // Generate certificate code: PSY + year + random6
    const certCode = `PSY${new Date().getFullYear()}${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO course_completions (id, subscriber_id, course_id, certificate_code, completed_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [id, subscriber_id, course_id, certCode]
    );

    // Send certificate email to subscriber
    const [[sub]] = await pool.query('SELECT name, email FROM subscribers WHERE id = ?', [subscriber_id]);
    const [[course]] = await pool.query('SELECT title FROM courses WHERE id = ?', [course_id]);
    if (sub?.email) {
      const certLink = `https://mahadnafsy.com/certificate/${certCode}`;
      await sendEmail(sub.email, `ðŸŽ“ Ù…Ø¨Ø±ÙˆÙƒ! Ø´Ù‡Ø§Ø¯ØªÙƒ ÙÙŠ "${course?.title || 'Ø§Ù„ÙƒÙˆØ±Ø³'}" Ø¬Ø§Ù‡Ø²Ø©`,
        `<div style="direction:rtl;font-family:Arial;max-width:600px;margin:auto">
          <h2 style="color:#B91C1C">Ù…Ø¨Ø±ÙˆÙƒ ${sub.name || ''} ðŸŽ‰</h2>
          <p>Ù„Ù‚Ø¯ Ø£ØªÙ…Ù…Øª Ø¨Ù†Ø¬Ø§Ø­ ÙƒÙˆØ±Ø³ <strong>${course?.title || ''}</strong>.</p>
          <p>ÙŠÙ…ÙƒÙ†Ùƒ ØªØ­Ù…ÙŠÙ„ Ø´Ù‡Ø§Ø¯ØªÙƒ Ù…Ù† Ø§Ù„Ø±Ø§Ø¨Ø· Ø§Ù„ØªØ§Ù„ÙŠ:</p>
          <a href="${certLink}" style="background:#B91C1C;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;display:inline-block;margin:12px 0;font-weight:bold">ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø´Ù‡Ø§Ø¯Ø©</a>
          <p style="color:#999;font-size:12px">ÙƒÙˆØ¯ Ø§Ù„ØªØ­Ù‚Ù‚: ${certCode}</p>
        </div>`
      ).catch(() => {});
    }

    res.status(201).json({ id, certificate_code: certCode, certificate_url: `https://mahadnafsy.com/certificate/${certCode}` });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/completions/bulk â€” bulk mark multiple subscribers as completed
router.post('/api/admin/completions/bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { course_id, subscriber_ids } = req.body;
    if (!course_id || !Array.isArray(subscriber_ids) || !subscriber_ids.length)
      return res.status(400).json({ error: 'course_id and subscriber_ids[] required' });

    const results = [];
    // Batch-check existing completions in 1 query instead of N
    const [existingRows] = await pool.query(
      `SELECT subscriber_id, certificate_code FROM course_completions WHERE course_id=? AND subscriber_id IN (${subscriber_ids.map(() => '?').join(',')})`,
      [course_id, ...subscriber_ids]
    );
    const existingMap = new Map(existingRows.map(r => [r.subscriber_id, r.certificate_code]));
    const toInsert = [];
    for (const subscriber_id of subscriber_ids) {
      if (existingMap.has(subscriber_id)) {
        results.push({ subscriber_id, certificate_code: existingMap.get(subscriber_id), skipped: true });
      } else {
        const certCode = `PSY${new Date().getFullYear()}${Math.random().toString(36).slice(2,8).toUpperCase()}`;
        const newId = uuidv4();
        toInsert.push({ id: newId, subscriber_id, certCode });
        results.push({ subscriber_id, certificate_code: certCode, created: true });
      }
    }
    // Batch INSERT in chunks of 200 â€” restores per-item error reporting on chunk failure
    const COMP_CHUNK = 200;
    for (let ci = 0; ci < toInsert.length; ci += COMP_CHUNK) {
      const chunk = toInsert.slice(ci, ci + COMP_CHUNK);
      const compRows = chunk.map(() => '(?,?,?,?,NOW())');
      const compParams = chunk.flatMap(r => [r.id, r.subscriber_id, course_id, r.certCode]);
      try {
        await pool.query(
          `INSERT INTO course_completions (id, subscriber_id, course_id, certificate_code, completed_at) VALUES ${compRows.join(',')}`,
          compParams
        );
      } catch (batchErr) {
        // Mark every subscriber in the failed chunk with the specific error
        const failedSet = new Set(chunk.map(r => r.subscriber_id));
        for (const r of results) {
          if (r.created && failedSet.has(r.subscriber_id)) {
            r.created = false;
            r.error = batchErr.message;
          }
        }
      }
    }

    const created = results.filter(r => r.created).length;
    const skipped = results.filter(r => r.skipped).length;
    res.json({ results, created, skipped, total: results.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/completions?course_id=&subscriber_id= â€” list completions
router.get('/api/admin/completions', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { course_id, subscriber_id } = req.query;
    let sql = `
      SELECT cc.*, s.name AS subscriber_name, s.email AS subscriber_email, s.client_code,
             c.title AS course_title
      FROM course_completions cc
      JOIN subscribers s ON s.id = cc.subscriber_id
      JOIN courses c ON c.id = cc.course_id
      WHERE 1=1
    `;
    const params = [];
    if (course_id)     { sql += ' AND cc.course_id = ?';     params.push(course_id); }
    if (subscriber_id) { sql += ' AND cc.subscriber_id = ?'; params.push(subscriber_id); }
    sql += ' ORDER BY cc.completed_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(r => ({ ...r, certificate_url: `https://mahadnafsy.com/certificate/${r.certificate_code}` })));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE: Referral Earnings Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/admin/referrals â€” admin view all referral codes + earnings
router.get('/api/admin/referrals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT rc.*, s.name AS owner_name, s.email AS owner_email, s.client_code
      FROM referral_codes rc
      LEFT JOIN subscribers s ON s.id = rc.subscriber_id
      ORDER BY rc.uses DESC, rc.earnings DESC
      LIMIT 500
    `);
    const [[totals]] = await pool.query(
      'SELECT SUM(uses) AS total_uses, SUM(earnings) AS total_earnings, COUNT(*) AS total_codes FROM referral_codes'
    );
    res.json({ codes: rows, totals });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/referrals/:code/subscribers â€” who registered with this code
router.get('/api/admin/referrals/:code/subscribers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.email, s.client_code, s.created_at
       FROM subscribers s
       WHERE s.referral_code = ?
       ORDER BY s.created_at DESC`,
      [req.params.code]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/referrals/:id/earnings â€” manually adjust referral earnings
router.patch('/api/admin/referrals/:id/earnings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { earnings, adjustment_note } = req.body;
    await pool.query('UPDATE referral_codes SET earnings = ? WHERE id = ?', [parseFloat(earnings) || 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ FEATURE: Student Community / Forum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

pool.query(`
  CREATE TABLE IF NOT EXISTS forum_posts (
    id            VARCHAR(36)  NOT NULL DEFAULT (UUID()),
    author_id     VARCHAR(36)  NOT NULL COMMENT 'subscriber.id',
    author_name   VARCHAR(200) NULL,
    course_id     VARCHAR(36)  NULL     COMMENT 'NULL = general community, set = course-specific',
    parent_id     VARCHAR(36)  NULL     COMMENT 'NULL = top-level post, set = reply',
    title         VARCHAR(300) NULL     COMMENT 'only for top-level posts',
    body          TEXT         NOT NULL,
    upvotes       INT UNSIGNED NOT NULL DEFAULT 0,
    is_pinned     TINYINT(1)   NOT NULL DEFAULT 0,
    is_hidden     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fp_course  (course_id),
    KEY idx_fp_parent  (parent_id),
    KEY idx_fp_author  (author_id),
    KEY idx_fp_pinned  (is_pinned, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(e => console.warn('[schema] forum_posts:', e.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS forum_upvotes (
    post_id       VARCHAR(36)  NOT NULL,
    subscriber_id VARCHAR(36)  NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, subscriber_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(e => console.warn('[schema] forum_upvotes:', e.message));

// GET /api/community/posts?course_id=&page=&limit=
// Public to authenticated clients â€” list posts (top-level only by default)
router.get('/api/community/posts', requireAuth, async (req, res) => {
  try {
    const courseId = req.query.course_id || null;
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(100, parseInt(req.query.limit) || 20);
    const offset   = (page - 1) * limit;

    let where = 'WHERE fp.parent_id IS NULL AND fp.is_hidden = 0';
    const params = [];
    if (courseId) { where += ' AND fp.course_id = ?'; params.push(courseId); }
    else           { where += ' AND fp.course_id IS NULL'; }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM forum_posts fp ${where}`, params);
    const [posts] = await pool.query(`
      SELECT fp.*,
             (SELECT COUNT(*) FROM forum_posts r WHERE r.parent_id = fp.id AND r.is_hidden = 0) AS reply_count
      FROM forum_posts fp
      ${where}
      ORDER BY fp.is_pinned DESC, fp.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({ posts, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/community/posts/:id â€” single post with replies
router.get('/api/community/posts/:id', requireAuth, async (req, res) => {
  try {
    const [[post]] = await pool.query(
      `SELECT id, author_id, author_name, course_id, parent_id, title, body, upvotes, is_pinned, is_hidden, created_at, updated_at
       FROM forum_posts WHERE id = ? AND is_hidden = 0`, [req.params.id]
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const [replies] = await pool.query(
      `SELECT id, author_id, author_name, course_id, parent_id, title, body, upvotes, is_pinned, is_hidden, created_at, updated_at
       FROM forum_posts WHERE parent_id = ? AND is_hidden = 0 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ post, replies });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/community/posts â€” create post or reply
router.post('/api/community/posts', requireAuth, async (req, res) => {
  try {
    const { title, body, course_id, parent_id } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'body required' });

    // Resolve subscriber from auth user
    const [[sub]] = await pool.query('SELECT id, name FROM subscribers WHERE firebase_uid = ? OR email = ?',
      [req.user.uid || '', req.user.email || '']);
    if (!sub) return res.status(403).json({ error: 'Subscriber account required' });

    // If reply, validate parent exists
    if (parent_id) {
      const [[parent]] = await pool.query('SELECT id FROM forum_posts WHERE id = ? AND is_hidden = 0', [parent_id]);
      if (!parent) return res.status(404).json({ error: 'Parent post not found' });
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO forum_posts (id, author_id, author_name, course_id, parent_id, title, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sub.id, sub.name || 'Ø·Ø§Ù„Ø¨', course_id || null, parent_id || null,
       parent_id ? null : (title || 'Ù…ÙˆØ¶ÙˆØ¹ Ø¬Ø¯ÙŠØ¯'), body.trim()]
    );
    res.status(201).json({ id, message: 'Post created' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/community/posts/:id/upvote â€” toggle upvote
router.post('/api/community/posts/:id/upvote', requireAuth, async (req, res) => {
  try {
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE firebase_uid = ? OR email = ?',
      [req.user.uid || '', req.user.email || '']);
    if (!sub) return res.status(403).json({ error: 'Subscriber required' });

    const [[existing]] = await pool.query('SELECT 1 FROM forum_upvotes WHERE post_id = ? AND subscriber_id = ?',
      [req.params.id, sub.id]);

    if (existing) {
      await pool.query('DELETE FROM forum_upvotes WHERE post_id = ? AND subscriber_id = ?', [req.params.id, sub.id]);
      await pool.query('UPDATE forum_posts SET upvotes = GREATEST(0, upvotes - 1) WHERE id = ?', [req.params.id]);
      res.json({ upvoted: false });
    } else {
      await pool.query('INSERT IGNORE INTO forum_upvotes (post_id, subscriber_id) VALUES (?, ?)', [req.params.id, sub.id]);
      await pool.query('UPDATE forum_posts SET upvotes = upvotes + 1 WHERE id = ?', [req.params.id]);
      res.json({ upvoted: true });
    }
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/community/posts/:id â€” admin: pin/hide post
router.patch('/api/admin/community/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { is_pinned, is_hidden } = req.body;
    const fields = []; const params = [];
    if (is_pinned !== undefined) { fields.push('is_pinned = ?'); params.push(is_pinned ? 1 : 0); }
    if (is_hidden !== undefined) { fields.push('is_hidden = ?'); params.push(is_hidden ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE forum_posts SET ${fields.join(', ')} WHERE id = ?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Post not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/community/posts/:id â€” admin delete
router.delete('/api/admin/community/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Soft-delete: hide post and all its replies
    await pool.query('UPDATE forum_posts SET is_hidden = 1 WHERE id = ? OR parent_id = ?', [req.params.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/community/posts?hidden=1 â€” admin: list all including hidden
router.get('/api/admin/community/posts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const showHidden = req.query.hidden === '1';
    const course_id  = req.query.course_id || null;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    let where = showHidden ? 'WHERE fp.parent_id IS NULL' : 'WHERE fp.parent_id IS NULL AND fp.is_hidden = 0';
    const params = [];
    if (course_id) { where += ' AND fp.course_id = ?'; params.push(course_id); }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM forum_posts fp ${where}`, params);
    const [posts] = await pool.query(`
      SELECT fp.*,
             (SELECT COUNT(*) FROM forum_posts r WHERE r.parent_id = fp.id) AS reply_count
      FROM forum_posts fp ${where}
      ORDER BY fp.is_pinned DESC, fp.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    res.json({ posts, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});


module.exports = router;
