'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate } = require('../../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, validate } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logPaymentAudit, logFinancialAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { syncLeadDealValue } = require('../public-orders');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { paymobLimiter, whatsappSendLimiter, publicLimiter, contactLimiter } = require('../../middleware/rateLimits');
const { safeDateOnly } = require('../../lib/dates');
const { isString, validateBody } = require('../../middleware/validate');

async function postExpenseJournal(expense, sign, actor) {
  const amt = await toEgp(Number(expense.amount) || 0, expense.currency);
  if (!amt) return;
  const [accCode, accName] = _expenseAccountCode(expense.category);
  const dateStr = String(expense.date || new Date().toISOString()).slice(0, 10);
  const label = sign > 0
    ? `مصروف ${expense.amount} ${expense.currency || 'EGP'} (= ${amt} EGP) — ${expense.description || accName}`
    : `عكس مصروف ${expense.amount} ${expense.currency || 'EGP'} (= ${amt} EGP) — ${expense.description || accName}`;
  const lines = sign > 0
    ? [
        { account_code: accCode, account_name: accName,      debit: amt, credit: 0 },
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0,   credit: amt },
      ]
    : [
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: amt, credit: 0 },
        { account_code: accCode, account_name: accName,      debit: 0,   credit: amt },
      ];
  await postJournalEntry(sign > 0 ? 'expense' : 'expense_reversal', expense.id, dateStr, label, lines, actor || 'system');
}

router.post('/api/admin/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e2 = req.body;
    const id = e2.id || uuidv4();
    const expDate = e2.date || new Date().toISOString().slice(0, 10);
    await assertWritable(expDate); // reject writes into a closed accounting period
    const [result] = await pool.query(
      `INSERT INTO expenses (id, date, description, amount, currency, category, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE description=VALUES(description), amount=VALUES(amount),
         category=VALUES(category), notes=VALUES(notes)`,
      [id, e2.date||new Date().toISOString().slice(0,10), e2.description||'',
       e2.amount||0, e2.currency||'EGP', e2.category||'other', e2.notes||null,
       e2.created_at||new Date().toISOString()]
    );
    // affectedRows: 1 = fresh insert, 2 = duplicate-key update (already journaled via PATCH path)
    if (result.affectedRows === 1) {
      postExpenseJournal({ ...e2, id }, +1, req.user?.email).catch(() => {});
    }
    res.json({ ok: true, id });
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: e.message });
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});
router.patch('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e2 = req.body;
    const [[oldExp]] = await pool.query('SELECT id, date, description, amount, currency, category FROM expenses WHERE id=? LIMIT 1', [req.params.id]);
    await pool.query(
      'UPDATE expenses SET description=?, amount=?, category=?, notes=? WHERE id=?',
      [e2.description||'', e2.amount||0, e2.category||'other', e2.notes||null, req.params.id]
    );
    // Journal: reverse the old amount then post the new one (keeps ledger = expenses table)
    if (oldExp) {
      postExpenseJournal(oldExp, -1, req.user?.email)
        .then(() => postExpenseJournal({ ...oldExp, ...e2, id: req.params.id }, +1, req.user?.email))
        .catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[oldExp]] = await pool.query('SELECT id, date, description, amount, currency, category FROM expenses WHERE id=? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    // Soft delete (recoverable) — reverse the ledger entry only on a real transition.
    const [del] = await pool.query('UPDATE expenses SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [req.params.id]);
    if (oldExp && del.affectedRows > 0) postExpenseJournal(oldExp, -1, req.user?.email).catch(() => {});
    res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Activity Logs POST ────────────────────────────────────────────────────────
router.post('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      'INSERT IGNORE INTO activity_logs (id, action, entity, entity_name, user_id, at) VALUES (?,?,?,?,?,?)',
      [id, a.action||'', a.entity||'', a.entity_name||'', a.user_id||req.user.uid,
       a.at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Subscriber enrollments & payments ─────────────────────────────────────────
router.post('/api/admin/enrollments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    // Allow: super-admins OR online_manager staff
    if (!req.isSuperAdmin) {
      const role = (req.staffRecord?.role || '').toLowerCase();
      if (role !== 'online_manager') return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { subscriber_id, course_id, bundle_id, access_level, lecture_limit } = req.body;
    if (!subscriber_id || (!course_id && !bundle_id)) return res.status(400).json({ error: 'subscriber_id and course_id or bundle_id required' });
    const accessType = access_level === 'limited' ? 'limited' : 'full';
    await pool.query(
      `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type, lecture_limit)
       VALUES (?,?,?,?,NOW(),?,?)
       ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), lecture_limit=VALUES(lecture_limit)`,
      [uuidv4(), subscriber_id, course_id || null, bundle_id || null, accessType, lecture_limit || null]
    );

    // Send enrollment confirmation email
    setImmediate(async () => {
      try {
        const [[subData]] = await pool.query('SELECT name, email, phone FROM subscribers WHERE id=? LIMIT 1', [subscriber_id]);
        if (!subData?.email) return;
        let itemName = 'الاشتراك';
        if (course_id) {
          const [[courseRow]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [course_id]);
          itemName = courseRow?.title || 'الكورس';
        } else if (bundle_id) {
          const [[bundleRow]] = await pool.query('SELECT title FROM bundles WHERE id=? LIMIT 1', [bundle_id]);
          itemName = bundleRow?.title || 'الباقة';
        }
        // Lifecycle "enrolled" — WhatsApp only (the branded email below covers email).
        require('../../lib/lifecycle').trigger(
          'enrolled',
          { name: subData.name, email: subData.email, phone: subData.phone, courseTitle: itemName },
          { channels: ['whatsapp'], dedupeKey: `enrolled:${subscriber_id}:${course_id || bundle_id || ''}` }
        );
        await sendEmail(subData.email,
          `🎓 تم تسجيلك في ${itemName}`,
          `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#7c3aed">مبروك ${subData.name || 'عزيزنا'}! 🎉</h2>
            <p>تم تسجيلك بنجاح في: <strong>${itemName}</strong></p>
            <p>يمكنك الوصول إليه الآن من خلال <a href="https://mahadnafsy.com/dashboard" style="color:#7c3aed">لوحة التحكم</a>.</p>
            <p style="color:#9ca3af;font-size:12px">معهد نفسي — mahadnafsy.com</p>
          </div>`
        );
      } catch (e) { logger.warn('[email] enrollment confirmation failed:', e.message); }
    });

    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// ── Join-Us Applications admin GET/PUT/DELETE ────────────────────────────────
router.get('/api/admin/join-us', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, specialty, experience, type, linkedin, message, status, admin_note, created_at
       FROM join_us_applications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500`, [req.tenantId]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/join-us/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body;
    await pool.query('UPDATE join_us_applications SET status=?, message=COALESCE(?,message) WHERE id=?',
      [status||'new', notes||null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/join-us/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM join_us_applications WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Contact Messages admin GET/PATCH/DELETE ───────────────────────────────────
router.get('/api/admin/contact-messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, subject, message, status, admin_note, created_at
       FROM contact_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500`, [req.tenantId]);
    // Client compares lowercase status and reads camelCase adminNote.
    res.json(rows.map(r => ({ ...r, status: String(r.status || 'new').toLowerCase(), adminNote: r.admin_note, createdAt: r.created_at })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sets = [], params = [];
    if (req.body.status !== undefined) { sets.push('status=?'); params.push(String(req.body.status || 'new').toUpperCase()); }
    if (req.body.adminNote !== undefined || req.body.admin_note !== undefined) {
      sets.push('admin_note=?'); params.push(req.body.adminNote ?? req.body.admin_note ?? null);
    }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.params.id);
    await pool.query(`UPDATE contact_messages SET ${sets.join(', ')} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM contact_messages WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// ── Quiz Attempts GET/POST/DELETE ─────────────────────────────────────────────
router.get('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      'SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at FROM quiz_attempts ORDER BY taken_at DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      `INSERT INTO quiz_attempts (id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE score=VALUES(score), passed=VALUES(passed)`,
      [id, a.subscriberId||null, a.quizId||null, a.courseId||null,
       a.score||0, a.passed?1:0, JSON.stringify(a.answers||[]),
       a.takenAt||new Date().toISOString()]
    );
    // ── Auto-certificate on quiz pass ──────────────────────────────────────────
    if (a.passed && a.courseId && a.subscriberId) {
      try {
        const [[alreadyDone]] = await pool.query('SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=? LIMIT 1', [a.subscriberId, a.courseId]);
        if (!alreadyDone) {
          const certCode = 'MHAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
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
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/quiz-attempts/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM quiz_attempts WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Client Code Counter (atomic) ──────────────────────────────────────────────
router.post('/api/admin/next-client-code', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE client_code_counter SET next_value = next_value + 1 WHERE id = 1');
    const [[row]] = await pool.query('SELECT next_value FROM client_code_counter WHERE id = 1');
    const code = `C${(row.next_value - 1)}`;
    res.json({ ok: true, code });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Sync counter to MAX existing code ─────────────────────────────────────────
// Call this once to repair the counter if codes were assigned locally in bulk
router.post('/api/admin/sync-client-code-counter', requireAuth, requireAdmin, async (req, res) => {
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
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});


// POST /api/admin/leads/migrate-branches — fill branch column from rawBranch (crm_json) or notes for branchless leads
router.post('/api/admin/leads/migrate-branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const normB = (v) => {
      if (!v) return null;
      const s = v.trim().toLowerCase().replace(/[\s_\-]/g, '');
      if (s.includes('دقي') || s.includes('daqqi') || s.includes('dokki')) return 'DAQQI';
      if (s.includes('تجمع') || s.includes('tagamoa') || s.includes('tagamo') || s.includes('قاهرةالجديدة') || s.includes('cairo') || s.includes('قاطميه') || s.includes('قطاميه') || s.includes('qatat')) return 'TAGAMOA';
      if (s.includes('online') || s.includes('اونلاين') || s.includes('أونلاين') || s.includes('اون')) {
        if (s.includes('سعودي') || s.includes('saudi')) return 'ONLINE_SAUDI';
        if (s.includes('خارج') || s.includes('abroad')) return 'ONLINE_ABROAD';
        return 'ONLINE_EGYPT';
      }
      if (s.length >= 2) return 'OTHER';
      return null;
    };

    const tryParseJson = (s, def) => { try { return JSON.parse(s); } catch { return def; } };

    const [rows] = await pool.query(
      `SELECT id, notes, crm_json FROM leads WHERE hidden=0 AND (branch IS NULL OR branch='')`
    );

    let updated = 0;
    const results = [];
    for (const row of rows) {
      const crm = tryParseJson(row.crm_json, {});
      // 1. Try rawBranch from crm_json first
      let raw = (crm.rawBranch || '').trim();
      // 2. Try crm_json.branch (stored as e.g. "online-egypt", "other", "daqqi")
      if (!raw && crm.branch) raw = String(crm.branch).trim();
      // 3. Fallback: extract from notes "الفرع: X"
      if (!raw && row.notes) {
        const m = /الفرع:\s*([^|\n]+)/.exec(row.notes);
        if (m) raw = m[1].trim();
      }
      if (!raw) continue;
      const branch = normB(raw);
      if (!branch) { results.push({ id: row.id, raw, branch: null }); continue; }
      await pool.query('UPDATE leads SET branch=? WHERE id=?', [branch, row.id]);
      updated++;
      results.push({ id: row.id, raw, branch });
    }
    res.json({ ok: true, updated, total: rows.length, results });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin data-maintenance tools (cleanup-junk-leads, cleanup-staff-subscribers,
// fix-auto-subscribers, bulk-assign-client-codes, fix-all-codes) moved to
// routes/admin-maintenance.js to slim core.js (Refactor #3).

// ── is-staff check ────────────────────────────────────────────────────────────
module.exports = router;
