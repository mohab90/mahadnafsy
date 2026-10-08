'use strict';

// «زر اسمه تقييم … فقط للعملاء اللى متسكنه داخل الروندات … التقييمات دي تظهر في
// صفحة حساب العميل نفسه … صفحه اسمها التقييمات لخدمه العملاء وللادارة ولفرع
// الدقي … موشر ظاهر في صف العميل داخل الروند» (8 Oct 2026).
//
// manage_daqqi is exactly who was named: the administration, customer service
// and the branch desks (Dokki, and Tagamoa for its own rounds). The client's
// file reads the ratings through «رحلة العميل» (lib/customerTimeline.js).

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { requireDaqqiAccess } = require('../lib/daqqiAccess');
const { canTouchBranch, roundsScopeSql } = require('../lib/physicalBranches');
const { signerName } = require('../lib/staffNames');
const { SCORES, scoreOf, averageOf } = require('../lib/clientRatings');

const readers = [requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess];

async function reachableRound(req, roundId) {
  const [[round]] = await pool.query(
    `SELECT r.id, r.code, r.branch, r.course_id,
            COALESCE(NULLIF(TRIM(r.instructor_name), ''), s.name) AS instructor_name
       FROM daqqi_rounds r
       LEFT JOIN staff s ON s.id = r.instructor_id AND s.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ? LIMIT 1`,
    [roundId, req.tenantId]);
  return round && canTouchBranch(req, round.branch) ? round : null;
}

// POST /api/admin/daqqi-rounds/:roundId/ratings — a housed client's rating.
router.post('/api/admin/daqqi-rounds/:roundId/ratings', ...readers, async (req, res) => {
  try {
    const round = await reachableRound(req, req.params.roundId);
    if (!round) return res.status(404).json({ error: 'الروند مش موجود' });
    const subscriberId = String(req.body?.subscriberId || '');
    const [[housed]] = await pool.query(
      'SELECT 1 AS ok FROM daqqi_attendees WHERE tenant_id = ? AND round_id = ? AND subscriber_id = ? LIMIT 1',
      [req.tenantId, round.id, subscriberId]);
    if (!housed) return res.status(409).json({ error: 'التقييم للعملاء المتسكنين في الروند بس' });
    const scores = SCORES.map(({ key }) => scoreOf(req.body?.[key]));
    if (scores.some(score => score === null)) return res.status(400).json({ error: 'كل تقييم من 1 لـ 10' });
    const note = String(req.body?.note || '').trim().slice(0, 2000) || null;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO client_ratings
         (id, tenant_id, subscriber_id, round_id, branch, course_id, instructor_name,
          instructor_score, material_score, delivery_score, branch_staff_score, note, created_by_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, subscriberId, round.id, round.branch, round.course_id, round.instructor_name || null,
        ...scores, note, req.staffRecord?.id || null, signerName(req)]);
    const row = Object.fromEntries(SCORES.map(({ column }, i) => [column, scores[i]]));
    res.json({ ok: true, id, average: averageOf(row) });
  } catch (e) { logger.error('[client-ratings/create]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/daqqi-rounds/:roundId/ratings — for the round's attendee rows:
// each client's latest rating, and how many there are.
router.get('/api/admin/daqqi-rounds/:roundId/ratings', ...readers, async (req, res) => {
  try {
    const round = await reachableRound(req, req.params.roundId);
    if (!round) return res.status(404).json({ error: 'الروند مش موجود' });
    const [rows] = await pool.query(
      `SELECT subscriber_id, instructor_score, material_score, delivery_score, branch_staff_score, note, created_at
         FROM client_ratings
        WHERE tenant_id = ? AND round_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [req.tenantId, round.id]);
    const bySubscriber = {};
    for (const row of rows) {
      const seen = bySubscriber[row.subscriber_id];
      if (seen) { seen.count += 1; continue; }
      bySubscriber[row.subscriber_id] = { average: averageOf(row), count: 1, at: row.created_at, note: row.note || null };
    }
    res.json(bySubscriber);
  } catch (e) { logger.error('[client-ratings/round]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/client-ratings — «التقييمات»: every rating in reach, newest first.
router.get('/api/admin/client-ratings', ...readers, async (req, res) => {
  try {
    const where = ['cr.tenant_id = ?', 'cr.deleted_at IS NULL'];
    const params = [req.tenantId];
    const scope = roundsScopeSql(req, 'cr');
    if (scope.sql) { where.push(scope.sql.replace(/^ AND /, '')); params.push(...scope.params); }
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : null;
    if (from) { where.push('cr.created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('cr.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const [rows] = await pool.query(
      `SELECT cr.id, cr.subscriber_id, cr.round_id, cr.branch, cr.course_id, cr.instructor_name,
              cr.instructor_score, cr.material_score, cr.delivery_score, cr.branch_staff_score,
              cr.note, cr.created_by_name, cr.created_at,
              s.name AS subscriber_name, s.phone AS subscriber_phone, s.client_code,
              r.code AS round_code, COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
         FROM client_ratings cr
         LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id = cr.tenant_id
         LEFT JOIN daqqi_rounds r ON r.id = cr.round_id AND r.tenant_id = cr.tenant_id
         LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id = cr.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY cr.created_at DESC LIMIT 2000`, params);
    res.json(rows.map(row => ({
      id: row.id,
      subscriberId: row.subscriber_id,
      subscriberName: row.subscriber_name || '',
      phone: row.subscriber_phone || '',
      clientCode: row.client_code || null,
      roundId: row.round_id,
      roundCode: row.round_code || null,
      branch: row.branch,
      courseTitle: row.course_title || null,
      instructorName: row.instructor_name || null,
      scores: Object.fromEntries(SCORES.map(({ key, column }) => [key, Number(row[column])])),
      average: averageOf(row),
      note: row.note || null,
      by: row.created_by_name || null,
      at: row.created_at,
    })));
  } catch (e) { logger.error('[client-ratings/list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/client-ratings/:id — the administration's: kept, out of every view.
router.delete('/api/admin/client-ratings/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE client_ratings SET deleted_at = NOW() WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'التقييم مش موجود' });
    res.json({ ok: true });
  } catch (e) { logger.error('[client-ratings/delete]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
