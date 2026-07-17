'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'admin-operations-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { parseLimit, parseOffset } = require('../lib/helpers');
const { sendEmail, htmlEmail } = require('../lib/email');
const { branchIdForBranch, defaultDigitalBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

function routeError(res, error, message = 'admin operations route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function appendTenantScope(sql, alias, tenantId, params) {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  params.push(effectiveTenantId);
  if (effectiveTenantId === DEFAULT_TENANT_ID) {
    return `${sql} AND (${col} = ? OR ${col} IS NULL OR ${col} = '')`;
  }
  return `${sql} AND ${col} = ?`;
}

router.get('/api/admin/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const params = [];
    const where = appendTenantScope('WHERE 1=1', '', scopedTenantId(req), params);
    const [rows] = await pool.query(
      `SELECT id, description, amount, currency, category, date, receipt_url, note, staff_id,
       vat_rate, vat_amount, amount_before_vat, created_at
       FROM expenses ${where} ORDER BY date DESC LIMIT 500`,
      params);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e2 = req.body;
    const id = e2.id || uuidv4();
    const tenantId = scopedTenantId(req);
    const branchCode = defaultDigitalBranch(e2.branch);
    // Column is `note` (singular) in the real schema — inserting into `notes`
    // threw "Unknown column 'notes'" and silently broke ALL expense creation
    // (confirmed: expenses table was empty in prod). Accept either field name
    // from the request body.
    await pool.query(
      `INSERT INTO expenses (id, tenant_id, branch_id, date, description, amount, currency, category, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE description=VALUES(description), amount=VALUES(amount),
         category=VALUES(category), note=VALUES(note)`,
      [id, tenantId, branchIdForBranch(branchCode), e2.date || new Date().toISOString().slice(0, 10), e2.description || '',
       e2.amount || 0, e2.currency || 'EGP', e2.category || 'other', e2.note ?? e2.notes ?? null,
       e2.created_at || new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e2 = req.body;
    // `note` (singular) is the real column — `notes` does not exist.
    const params = [e2.description || '', e2.amount || 0, e2.category || 'other', e2.note ?? e2.notes ?? null, req.params.id];
    const where = appendTenantScope('id=?', '', scopedTenantId(req), params);
    await pool.query(
      `UPDATE expenses SET description=?, amount=?, category=?, note=? WHERE ${where}`,
      params
    );
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Soft delete (recoverable + auditable), NOT a hard DELETE. Every financial
    // report already filters `WHERE deleted_at IS NULL` (finance.js, analytics/
    // financial.js, campaigns.js, misc/analytics.js), so a soft-deleted expense
    // disappears from all reports exactly like a hard delete did — same visible
    // behavior — but the row survives for recovery and audit instead of being
    // destroyed. The `deleted_at` column is owned by migration 017.
    // NOTE: deliberately no journal reversal here — the live POST (above) does not
    // post an expense journal entry on creation, so reversing on delete would post
    // a phantom entry and unbalance the ledger. Restoring expense↔ledger journaling
    // is tracked separately.
    const params = [req.params.id];
    const where = appendTenantScope('id=?', '', scopedTenantId(req), params);
    await pool.query(`UPDATE expenses SET deleted_at=NOW() WHERE ${where} AND deleted_at IS NULL`, params);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const offset = parseOffset(req.query.offset);
    const [rows] = await pool.query(
      'SELECT id, action, entity, entity_id, label, actor, at FROM activity_logs ORDER BY at DESC LIMIT ? OFFSET ?',
      [limit, offset]);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      'INSERT IGNORE INTO activity_logs (id, action, entity, entity_name, user_id, at) VALUES (?,?,?,?,?,?)',
      [id, a.action || '', a.entity || '', a.entity_name || '', a.user_id || req.user.uid,
       a.at || new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/join-us', requireAuth, requireAdminOrStaff, requirePermission('view_join_us'), async (req, res) => {
  try {
    const params = [];
    let where = appendTenantScope('WHERE 1=1', '', scopedTenantId(req), params);
    if (req.query.type && req.query.type !== 'all') {
      where += ' AND type = ?';
      params.push(String(req.query.type).toUpperCase());
    }
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, specialty, experience, type, linkedin, message, status, admin_note, created_at
       FROM join_us_applications ${where} ORDER BY created_at DESC LIMIT 500`,
      params);
    res.json(rows.map(r => ({
      ...r,
      application_category: String(r.type || '').toUpperCase() === 'STAFF' ? 'HR' : 'ACADEMIC',
    })));
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/join-us/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_join_us'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    const params = [status || 'new', notes || null, req.params.id];
    const where = appendTenantScope('id=?', '', scopedTenantId(req), params);
    await pool.query(`UPDATE join_us_applications SET status=?, message=COALESCE(?,message) WHERE ${where}`, params);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/join-us/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_join_us'), async (req, res) => {
  try {
    const params = [req.params.id];
    const where = appendTenantScope('id=?', '', scopedTenantId(req), params);
    await pool.query(`DELETE FROM join_us_applications WHERE ${where}`, params);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/contact-messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const params = [];
    let where = appendTenantScope('WHERE 1=1', '', scopedTenantId(req), params);
    if (req.query.status && req.query.status !== 'all') {
      where += ' AND status = ?';
      params.push(String(req.query.status));
    }
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, subject, message, status, admin_note, created_at
       FROM contact_messages ${where} ORDER BY created_at DESC LIMIT 500`,
      params);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const params = [req.body.status || 'new', req.params.id];
    const where = appendTenantScope('id=?', '', scopedTenantId(req), params);
    await pool.query(`UPDATE contact_messages SET status=? WHERE ${where}`, params);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const params = [req.params.id];
    const where = appendTenantScope('id=?', '', scopedTenantId(req), params);
    await pool.query(`DELETE FROM contact_messages WHERE ${where}`, params);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      'SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at FROM quiz_attempts ORDER BY taken_at DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      `INSERT INTO quiz_attempts (id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE score=VALUES(score), passed=VALUES(passed)`,
      [id, a.subscriberId || null, a.quizId || null, a.courseId || null,
       a.score || 0, a.passed ? 1 : 0, JSON.stringify(a.answers || []),
       a.takenAt || new Date().toISOString()]
    );
    if (a.passed && a.courseId && a.subscriberId) {
      try {
        const [[alreadyDone]] = await pool.query('SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=? LIMIT 1', [a.subscriberId, a.courseId]);
        if (!alreadyDone) {
          const certCode = 'MHAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
          await pool.query('INSERT IGNORE INTO course_completions (id, subscriber_id, course_id, certificate_code) VALUES (UUID(),?,?,?)', [a.subscriberId, a.courseId, certCode]);
          const [[course]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [a.courseId]);
          const [[sub]] = await pool.query('SELECT name, email FROM subscribers WHERE id=? LIMIT 1', [a.subscriberId]);
          if (sub?.email) {
            sendEmail(sub.email, `🎓 مبروك! اجتزت اختبار "${course?.title || ''}"`,
              htmlEmail('شهادة إتمام', `
                <p>مبروك <strong>${sub.name || ''}</strong>!</p>
                <p>لقد اجتزت بنجاح اختبار <strong>${course?.title || ''}</strong>.</p>
                <div class="otp-box">${certCode}</div>
                <p>يمكنك التحقق من شهادتك على موقعنا.</p>
              `)
            ).catch(() => {});
          }
        }
      } catch (cerr) { logger.warn('[quiz] auto-cert error:', cerr.message); }
    }
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/quiz-attempts/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM quiz_attempts WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { routeError(res, e); }
});

router.post('/api/admin/next-client-code', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await pool.query('UPDATE client_code_counter SET next_value = next_value + 1 WHERE id = 1');
    const [[row]] = await pool.query('SELECT next_value FROM client_code_counter WHERE id = 1');
    const code = `C${(row.next_value - 1)}`;
    res.json({ ok: true, code });
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/sync-client-code-counter', requireAuth, requireAdmin, async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM subscribers WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM leads WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const maxVal = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const newNext = maxVal >= 10000 ? maxVal + 1 : 10001;
    await conn.query(
      'UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?',
      [newNext, newNext]
    );
    await conn.commit();
    const [[counterRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    res.json({ ok: true, maxExisting: maxVal, counterNow: counterRow.next_value });
  } catch (e) {
    await conn.rollback();
    routeError(res, e);
  } finally { conn.release(); }
});

router.post('/api/admin/client-code', requireAuth, requireAdmin, async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const next = rows[0]?.next_value ?? 10001;
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
    await conn.commit();
    res.json({ ok: true, code: `C${next}` });
  } catch (e) {
    await conn.rollback();
    routeError(res, e);
  } finally { conn.release(); }
});

module.exports = router;
