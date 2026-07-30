'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { htmlEmail } = require('../lib/email');
const { createNotification } = require('../lib/notification');
const outbox = require('../lib/outbox');
const { createUnsubscribeToken, verifyUnsubscribeToken, setMarketingConsent, filterSuppressed, destinationHash } = require('../lib/marketingConsent');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { assertSafeWebhookUrl } = require('../lib/webhookSecurity');
const WEBHOOK_EVENTS = new Set([
  'new_lead', 'lead_converted', 'new_subscriber', 'new_payment', 'new_order',
  'refund_requested', 'new_consultation', 'new_contact', 'new_join_us',
]);

function validateWebhookInput({ name, url, secret, events }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255) return 'Invalid webhook name';
  if (typeof url !== 'string' || !url.trim() || url.length > 1000) return 'Invalid webhook URL';
  if (!Array.isArray(events) || events.length === 0 || events.length > WEBHOOK_EVENTS.size ||
      events.some(event => !WEBHOOK_EVENTS.has(event))) return 'Invalid webhook events';
  if (secret !== undefined && secret !== null && typeof secret !== 'string') return 'Invalid webhook secret';
  if (typeof secret === 'string' && secret.length > 255) return 'Webhook secret is too long';
  return null;
}

function publicApiBase(req) {
  const configured = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || String(process.env.ALLOWED_ORIGINS || '').split(',')[0];
  try { return new URL(configured || `${req.protocol}://${req.get('host')}`).origin; }
  catch { return `${req.protocol}://${req.get('host')}`; }
}

function unsubscribeUrl(req, token) {
  return `${publicApiBase(req)}/api/public/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
}

router.get('/api/public/marketing/unsubscribe', publicLimiter, async (req, res) => {
  try {
    const consent = verifyUnsubscribeToken(req.query.token);
    if (consent.tenantId !== req.tenantId) return res.status(400).send('Invalid tenant');
    const token = String(req.query.token || '');
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>إلغاء الرسائل التسويقية</title><body style="font-family:Arial;max-width:600px;margin:60px auto;padding:20px"><h2>إلغاء الرسائل التسويقية</h2><p>لن يؤثر ذلك على رسائل الدفع أو الحساب أو الدراسة.</p><form method="post" action="/api/public/marketing/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit" style="padding:12px 24px">تأكيد إلغاء الاشتراك</button></form></body></html>`);
  } catch { res.status(400).send('Invalid or expired unsubscribe link'); }
});

router.post('/api/public/marketing/unsubscribe', publicLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const consent = verifyUnsubscribeToken(req.body?.token);
    if (consent.tenantId !== req.tenantId) return res.status(400).send('Invalid tenant');
    await setMarketingConsent({ ...consent, subscribed: false, source: 'signed_unsubscribe_link' });
    res.type('html').send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font-family:Arial;max-width:600px;margin:60px auto;padding:20px"><h2>تم إلغاء الرسائل التسويقية بنجاح</h2><p>ستستمر فقط الرسائل التشغيلية الخاصة بحسابك ومدفوعاتك ودراستك.</p></body></html>');
  } catch (error) { res.status(error.statusCode || 400).send('Invalid or expired unsubscribe link'); }
});

router.post('/api/admin/marketing/consent', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { subjectType, subjectId, channel = 'email', subscribed } = req.body || {};
    const result = await setMarketingConsent({
      tenantId: req.tenantId, subjectType, subjectId, channel, subscribed: subscribed === true,
      source: 'admin', actor: req.user?.email || req.user?.uid || 'admin',
    });
    res.json(result);
  } catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Email Campaigns ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/email-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, subject, body_html, audience, audience_filter, status,
              sent_count, fail_count, scheduled_at, sent_at, created_at, created_by
       FROM email_campaigns WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`
    , [req.tenantId]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/email-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, subject, body_html, audience, audience_filter } = req.body;
    if (!title || !subject || !body_html) return res.status(400).json({ error: 'title, subject, body_html required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO email_campaigns (id,tenant_id,title,subject,body_html,audience,audience_filter,status,created_by)
       VALUES (?,?,?,?,?,?,?,'draft',?)`,
      [id, req.tenantId, title, subject, body_html, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.user.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/email-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, subject, body_html, audience, audience_filter } = req.body;
    await pool.query(
      'UPDATE email_campaigns SET title=?,subject=?,body_html=?,audience=?,audience_filter=? WHERE id=? AND tenant_id=? AND status=\'draft\'',
      [title, subject, body_html, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.params.id, req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/email-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM email_campaigns WHERE id=? AND tenant_id=? AND status='draft'", [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Draft campaign not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/email-campaigns/:id/send — fire the campaign
router.post('/api/admin/email-campaigns/:id/send', requireAuth, requireAdmin, async (req, res) => {
  let conn = null;
  let transactionStarted = false;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction(); transactionStarted = true;
    const [[campaign]] = await conn.query(
      `SELECT id, title, subject, body_html, audience, audience_filter, status,
              sent_count, fail_count, scheduled_at, sent_at, created_at, created_by
       FROM email_campaigns WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`, [req.params.id, req.tenantId]
    );
    if (!campaign) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Campaign not found' }); }
    if (campaign.status !== 'draft' && campaign.status !== 'failed') { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Campaign already queued or sent' }); }
    if (campaign.status === 'failed') {
      const [retried] = await conn.query(
        "UPDATE message_outbox SET status='pending',attempts=0,last_error=NULL,next_attempt_at=NOW(),locked_at=NULL,locked_by=NULL WHERE tenant_id=? AND ref_type='email_campaign' AND ref_id=? AND status='dead'",
        [req.tenantId, campaign.id]
      );
      await conn.query("UPDATE email_campaigns SET status='sending',fail_count=0 WHERE id=? AND tenant_id=?", [campaign.id, req.tenantId]);
      await conn.commit(); transactionStarted = false;
      return res.json({ ok: true, retried: retried.affectedRows });
    }

    // Collect recipients
    let emails = [];
    if (campaign.audience === 'subscribers' || campaign.audience === 'all') {
      const [subs] = await conn.query("SELECT id,email,name FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1 AND email IS NOT NULL AND email<>'' AND email LIKE '%@%'", [req.tenantId]);
      emails = [...emails, ...subs.map(s => ({ ...s, subjectType: 'subscriber' }))];
    }
    if (campaign.audience === 'leads' || campaign.audience === 'all') {
      const [leads] = await conn.query("SELECT id,email,name FROM leads WHERE tenant_id=? AND hidden=0 AND deleted_at IS NULL AND email IS NOT NULL AND email<>'' AND email LIKE '%@%'", [req.tenantId]);
      emails = [...emails, ...leads.map(l => ({ ...l, subjectType: 'lead' }))];
    }
    if (campaign.audience === 'manual' && campaign.audience_filter) {
      const filter = tryJson(campaign.audience_filter, {});
      if (Array.isArray(filter.emails) && filter.emails.length) {
        const manual = [...new Set(filter.emails.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))].slice(0, 5000);
        const [subs] = await conn.query(`SELECT id,email,name FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email)) IN (${manual.map(() => '?').join(',')})`, [req.tenantId, ...manual]);
        const [leads] = await conn.query(`SELECT id,email,name FROM leads WHERE tenant_id=? AND hidden=0 AND LOWER(TRIM(email)) IN (${manual.map(() => '?').join(',')})`, [req.tenantId, ...manual]);
        emails = [...subs.map(s => ({ ...s, subjectType: 'subscriber' })), ...leads.map(l => ({ ...l, subjectType: 'lead' }))];
      }
    }
    // Deduplicate
    const seen = new Set();
    emails = emails.filter(e => { const key = e.email?.toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; });
    emails = await filterSuppressed(req.tenantId, 'email', emails, 'email', conn);
    await conn.query("UPDATE email_campaigns SET status='sending',sent_count=0,fail_count=0 WHERE id=? AND tenant_id=?", [campaign.id, req.tenantId]);
    for (const recipient of emails) {
      const token = createUnsubscribeToken({ tenantId: req.tenantId, subjectType: recipient.subjectType, subjectId: recipient.id, channel: 'email' });
      const html = `${campaign.body_html.replace(/\{\{name\}\}/g, recipient.name || '').replace(/\{\{email\}\}/g, recipient.email)}<hr><p style="font-size:12px;color:#666">لإيقاف الرسائل التسويقية فقط: <a href="${unsubscribeUrl(req, token)}">إلغاء الاشتراك</a></p>`;
      await outbox.enqueue({
        channel: 'email', recipient: recipient.email, subject: campaign.subject, payload: { html }, tenantId: req.tenantId,
        dedupeKey: `email-campaign:${campaign.id}:${destinationHash('email', recipient.email)}`, refType: 'email_campaign', refId: campaign.id,
      }, conn);
    }
    if (!emails.length) await conn.query("UPDATE email_campaigns SET status='sent',sent_at=NOW() WHERE id=? AND tenant_id=?", [campaign.id, req.tenantId]);
    await conn.commit(); transactionStarted = false;
    res.json({ ok: true, queued: emails.length, suppressedOrInvalid: 0 });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn?.release(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Task Manager ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const taskManager = (req) => req.isSuperAdmin || ['ADMIN', 'OWNER', 'MANAGER'].includes(String(req.staffRecord?.role || '').toUpperCase());
const taskActorId = (req) => req.staffRecord?.id || req.user?.uid || null;

async function validateTaskReferences(req, task) {
  if (task.assigned_to) {
    const [[staff]] = await pool.query('SELECT id, name FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1', [task.assigned_to, req.tenantId]);
    if (!staff) return { error: 'Assigned staff not found' };
    task.assigned_name = staff.name;
  }
  if (task.related_sub_id) {
    const [[subscriber]] = await pool.query('SELECT id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [task.related_sub_id, req.tenantId]);
    if (!subscriber) return { error: 'Subscriber not found' };
  }
  if (task.related_lead_id) {
    const [[lead]] = await pool.query('SELECT id FROM leads WHERE id=? AND tenant_id=? AND hidden=0 LIMIT 1', [task.related_lead_id, req.tenantId]);
    if (!lead) return { error: 'Lead not found' };
  }
  return null;
}

router.get('/api/admin/tasks', requireAuth, requireAdminOrStaff, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const mineOnly = req.query.mine === '1' || !taskManager(req);
    const [rows] = await pool.query(
      `SELECT id, title, description, assigned_to, assigned_name, related_sub_id, related_lead_id,
              priority, status, due_date, completed_at, created_by, created_at, updated_at
       FROM tasks
       WHERE tenant_id=? AND (?=0 OR assigned_to=?)
       ORDER BY due_date ASC, created_at DESC LIMIT 500`,
      [req.tenantId, mineOnly ? 1 : 0, taskActorId(req)]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/tasks', requireAuth, requireAdminOrStaff, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const t = { ...(req.body || {}) };
    if (!['low','medium','high','urgent'].includes(t.priority || 'medium') || !['todo','in_progress','done','cancelled'].includes(t.status || 'todo')) return res.status(400).json({ error: 'Invalid task status or priority' });
    t.assigned_to = taskManager(req) ? (t.assigned_to || null) : taskActorId(req);
    const refError = await validateTaskReferences(req, t);
    if (refError) return res.status(400).json(refError);
    const id = uuidv4();
    await pool.query(
      `INSERT INTO tasks (id, tenant_id, title, description, assigned_to, assigned_name, related_sub_id, related_lead_id, priority, status, due_date, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, t.title || 'مهمة جديدة', t.description || null, t.assigned_to || null, t.assigned_name || null,
       t.related_sub_id || null, t.related_lead_id || null, t.priority || 'medium',
       t.status || 'todo', t.due_date || null, taskActorId(req)]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/tasks/:id', requireAuth, requireAdminOrStaff, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const t = { ...(req.body || {}) };
    if (!['low','medium','high','urgent'].includes(t.priority || 'medium') || !['todo','in_progress','done','cancelled'].includes(t.status || 'todo')) return res.status(400).json({ error: 'Invalid task status or priority' });
    if (!taskManager(req)) t.assigned_to = taskActorId(req);
    const refError = await validateTaskReferences(req, t);
    if (refError) return res.status(400).json(refError);
    const completedAt = t.status === 'done' ? 'NOW()' : 'NULL';
    const [result] = await pool.query(
      `UPDATE tasks SET title=?, description=?, assigned_to=?, assigned_name=?, priority=?, status=?,
       due_date=?, related_sub_id=?, related_lead_id=?, completed_at=${completedAt}
       WHERE id=? AND tenant_id=?${taskManager(req) ? '' : ' AND (assigned_to=? OR created_by=?)'}`,
      [t.title, t.description || null, t.assigned_to || null, t.assigned_name || null,
       t.priority || 'medium', t.status || 'todo', t.due_date || null,
       t.related_sub_id || null, t.related_lead_id || null, req.params.id, req.tenantId,
       ...(taskManager(req) ? [] : [taskActorId(req), taskActorId(req)])]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/tasks/:id', requireAuth, requireAdminOrStaff, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM tasks WHERE id=? AND tenant_id=?${taskManager(req) ? '' : ' AND (assigned_to=? OR created_by=?)'}`,
      [req.params.id, req.tenantId, ...(taskManager(req) ? [] : [taskActorId(req), taskActorId(req)])]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Support Tickets: MOVED to routes/support.js (Customer-Service Hub) ──
// The ticket routes (/api/admin/tickets*, /api/me/tickets) now live there with
// cross-department routing, SLA tracking, timeline + contact->ticket conversion.


// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Webhooks ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/webhooks', requireAuth, requireAdmin, requirePermission('manage_settings'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id,name,url,events,is_active,last_triggered_at,last_status,created_at FROM webhooks WHERE tenant_id=? ORDER BY created_at DESC', [req.tenantId]);
    res.json(rows.map(r => ({ ...r, events: tryJson(r.events, []) })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/webhooks', requireAuth, requireAdmin, requirePermission('manage_settings'), async (req, res) => {
  try {
    const { name, url, secret, events } = req.body;
    const validationError = validateWebhookInput({ name, url, secret, events });
    if (validationError) return res.status(400).json({ error: validationError });
    const safeUrl = await assertSafeWebhookUrl(url);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO webhooks (id,tenant_id,name,url,secret,events) VALUES (?,?,?,?,?,?)',
      [id, req.tenantId, name, safeUrl, secret || null, JSON.stringify(events || [])]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/webhooks/:id', requireAuth, requireAdmin, requirePermission('manage_settings'), async (req, res) => {
  try {
    const { name, url, secret, events, is_active } = req.body;
    const validationError = validateWebhookInput({ name, url, secret, events });
    if (validationError) return res.status(400).json({ error: validationError });
    const safeUrl = await assertSafeWebhookUrl(url);
    const [result] = await pool.query(
      'UPDATE webhooks SET name=?,url=?,secret=COALESCE(NULLIF(?,\'\'),secret),events=?,is_active=? WHERE id=? AND tenant_id=?',
      [name, safeUrl, secret || null, JSON.stringify(events || []), is_active ? 1 : 0, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/webhooks/:id', requireAuth, requireAdmin, requirePermission('manage_settings'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM webhooks WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/webhooks/:id/test — send a test payload
router.post('/api/admin/webhooks/:id/test', requireAuth, requireAdmin, requirePermission('manage_settings'), async (req, res) => {
  try {
    const [[wh]] = await pool.query(
      `SELECT id, name, url, secret, events, is_active, last_triggered_at, last_status, created_at
       FROM webhooks WHERE id=? AND tenant_id=? LIMIT 1`, [req.params.id, req.tenantId]
    );
    if (!wh) return res.status(404).json({ error: 'Not found' });
    const safeUrl = await assertSafeWebhookUrl(wh.url);
    const payload = { event: 'test', timestamp: new Date().toISOString(), data: { message: 'Test webhook from Mahad' } };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(safeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(wh.secret ? { 'X-Webhook-Secret': wh.secret } : {}) },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    await pool.query('UPDATE webhooks SET last_triggered_at=NOW(),last_status=? WHERE id=? AND tenant_id=?', [resp.status, wh.id, req.tenantId]);
    res.json({ ok: true, status: resp.status });
  } catch (e) {
    await pool.query('UPDATE webhooks SET last_triggered_at=NOW(),last_status=0 WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]).catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Internal webhook trigger helper
async function triggerWebhooks(tenantId, event, data) {
  try {
    if (!tenantId) return;
    const [hooks] = await pool.query("SELECT id,url,secret,events FROM webhooks WHERE tenant_id=? AND is_active=1 AND JSON_CONTAINS(events, ?, '$') LIMIT 100", [tenantId, JSON.stringify(event)]);
    for (const wh of hooks) {
      const safeUrl = await assertSafeWebhookUrl(wh.url);
      const payload = { event, timestamp: new Date().toISOString(), data };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      fetch(safeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(wh.secret ? { 'X-Webhook-Secret': wh.secret } : {}) },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      }).then(r => pool.query('UPDATE webhooks SET last_triggered_at=NOW(),last_status=? WHERE id=? AND tenant_id=?', [r.status, wh.id, tenantId]))
        .catch(() => pool.query('UPDATE webhooks SET last_triggered_at=NOW(),last_status=0 WHERE id=? AND tenant_id=?', [wh.id, tenantId]))
        .finally(() => clearTimeout(t));
    }
  } catch (_) { /* non-fatal */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Budget vs Actual ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/budgets', requireAuth, requireAdmin, async (req, res) => {
  try {
    const month = req.query.month || null; // YYYY-MM
    const [rows] = await pool.query(
      `SELECT id, month, category, budgeted_amount, currency, notes, created_at
       FROM budgets WHERE tenant_id=? AND (? IS NULL OR month=?)
       ORDER BY month DESC, category ASC`,
      [req.tenantId, month, month]
    );
    // Get actual spending per month per category from expenses
    let actual = [];
    if (month) {
      const [exp] = await pool.query(
        `SELECT category,SUM(amount_egp) AS actual FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE_FORMAT(date,'%Y-%m')=? GROUP BY category`,
        [req.tenantId, month]
      );
      actual = exp;
    }
    res.json({ budgets: rows, actual });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/budgets', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { month, category, budgeted_amount, currency, notes } = req.body;
    if (!month || !category) return res.status(400).json({ error: 'month and category required' });
    await pool.query(
      `INSERT INTO budgets (id,tenant_id,month,category,budgeted_amount,currency,notes) VALUES (UUID(),?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE budgeted_amount=VALUES(budgeted_amount), currency=VALUES(currency), notes=VALUES(notes)`,
      [req.tenantId, month, category, budgeted_amount || 0, currency || 'EGP', notes || null]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/budgets/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM budgets WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Budget not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: NPS / Customer Satisfaction ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/nps', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, subscriber_id, subscriber_email, score, comment, payment_id,
              sent_at, responded_at, created_at
       FROM nps_responses WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500`
    , [req.tenantId]);
    const [agg] = await pool.query('SELECT AVG(score) AS avg_score,COUNT(*) AS total,SUM(score>=9) AS promoters,SUM(score<=6) AS detractors FROM nps_responses WHERE tenant_id=? AND responded_at IS NOT NULL', [req.tenantId]);
    const a = agg[0];
    const npsScore = a.total > 0 ? Math.round(((a.promoters - a.detractors) / a.total) * 100) : null;
    res.json({ rows, avg: a.avg_score ? parseFloat((+a.avg_score).toFixed(1)) : null, total: a.total, npsScore });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: submit NPS response (via link from email)
router.post('/api/nps/respond', publicLimiter, async (req, res) => {
  try {
    const { id, score, comment } = req.body;
    if (!id || score === undefined) return res.status(400).json({ error: 'id and score required' });
    const numScore = Number(score);
    if (!Number.isInteger(numScore) || numScore < 0 || numScore > 10) {
      return res.status(400).json({ error: 'score must be an integer from 0 to 10' });
    }
    const [result] = await pool.query(
      'UPDATE nps_responses SET score=?,comment=?,responded_at=NOW() WHERE id=? AND tenant_id=? AND responded_at IS NULL',
      [numScore, comment ? String(comment).trim().slice(0, 2000) : null, id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Survey not found or already answered' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: manually send NPS to subscriber
router.post('/api/admin/nps/send', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    const { subscriber_id } = req.body;
    const [[sub]] = await pool.query('SELECT id,email,name,branch_id FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [subscriber_id, req.tenantId]);
    if (!sub || !sub.email) return res.status(404).json({ error: 'Subscriber not found or no email' });
    // NPS is a marketing-adjacent survey — must respect the same suppression
    // list every other campaign channel does (MKT-09: this used to send
    // straight through sendEmail(), skipping both filterSuppressed() and the
    // outbox, so an unsubscribed subscriber still got surveyed, and a mail
    // provider outage silently lost the send with no retry).
    const [allowed] = await filterSuppressed(req.tenantId, 'email', [sub], 'email');
    if (!allowed) return res.status(409).json({ error: 'Subscriber has opted out of marketing messages' });
    const id = uuidv4();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO nps_responses (id,tenant_id,branch_id,subscriber_id,subscriber_email,sent_at) VALUES (?,?,?,?,?,NOW())',
      [id, req.tenantId, sub.branch_id || null, sub.id, sub.email]
    );
    const link = `https://mahadnafsy.com/nps?id=${id}`;
    await outbox.enqueue({
      channel: 'email', recipient: sub.email, subject: 'كيف تقيّم تجربتك مع معهد الدراسات النفسية؟',
      payload: { html: htmlEmail('تقييمك يهمنا', `
        <p>مرحباً <strong>${sub.name || ''}</strong>،</p>
        <p>يسعدنا معرفة رأيك في خدماتنا. يرجى تقييم تجربتك من 0 إلى 10:</p>
        <div style="text-align:center;margin:20px 0">
          <a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;">قيّم الآن</a>
        </div>
        <p style="color:#9ca3af;font-size:12px">الرابط صالح لمرة واحدة فقط</p>
      `) },
      tenantId: req.tenantId, dedupeKey: `nps:${req.tenantId}:${id}`, refType: 'nps_response', refId: id,
    }, conn);
    await conn.commit();
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn?.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: SMS Campaigns ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/sms-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, message, audience, audience_filter, status,
              sent_count, fail_count, sent_at, created_at, created_by
       FROM sms_campaigns WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`
    , [req.tenantId]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/sms-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, message, audience, audience_filter } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });
    const id = uuidv4();
    await pool.query(
      "INSERT INTO sms_campaigns (id,tenant_id,title,message,audience,audience_filter,status,created_by) VALUES (?,?,?,?,?,?,'draft',?)",
      [id, req.tenantId, title, message, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.user.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/sms-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, message, audience, audience_filter } = req.body;
    await pool.query(
      "UPDATE sms_campaigns SET title=?,message=?,audience=?,audience_filter=? WHERE id=? AND tenant_id=? AND status='draft'",
      [title, message, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.params.id, req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/sms-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM sms_campaigns WHERE id=? AND tenant_id=? AND status='draft'", [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Draft campaign not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/sms-campaigns/:id/send', requireAuth, requireAdmin, async (req, res) => {
  let conn = null;
  let transactionStarted = false;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction(); transactionStarted = true;
    const [[campaign]] = await conn.query(
      `SELECT id, title, message, audience, audience_filter, status,
              sent_count, fail_count, sent_at, created_at, created_by
       FROM sms_campaigns WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`, [req.params.id, req.tenantId]
    );
    if (!campaign) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Not found' }); }
    if (campaign.status !== 'draft' && campaign.status !== 'failed') { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Campaign already queued or sent' }); }
    if (campaign.status === 'failed') {
      const [retried] = await conn.query(
        "UPDATE message_outbox SET status='pending',attempts=0,last_error=NULL,next_attempt_at=NOW(),locked_at=NULL,locked_by=NULL WHERE tenant_id=? AND ref_type='sms_campaign' AND ref_id=? AND status='dead'",
        [req.tenantId, campaign.id]
      );
      await conn.query("UPDATE sms_campaigns SET status='sending',fail_count=0 WHERE id=? AND tenant_id=?", [campaign.id, req.tenantId]);
      await conn.commit(); transactionStarted = false;
      return res.json({ ok: true, retried: retried.affectedRows });
    }

    let phones = [];
    if (campaign.audience === 'subscribers' || campaign.audience === 'all') {
      const [subs] = await conn.query("SELECT id,phone,name FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1 AND phone IS NOT NULL AND phone<>''", [req.tenantId]);
      phones = [...phones, ...subs.map(s => ({ ...s, subjectType: 'subscriber' }))];
    }
    if (campaign.audience === 'leads' || campaign.audience === 'all') {
      const [leads] = await conn.query("SELECT id,phone,name FROM leads WHERE tenant_id=? AND hidden=0 AND deleted_at IS NULL AND phone IS NOT NULL AND phone<>''", [req.tenantId]);
      phones = [...phones, ...leads.map(l => ({ ...l, subjectType: 'lead' }))];
    }
    if (campaign.audience === 'manual' && campaign.audience_filter) {
      const filter = tryJson(campaign.audience_filter, {});
      if (Array.isArray(filter.phones) && filter.phones.length) {
        const manual = [...new Set(filter.phones.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 5000);
        const [subs] = await conn.query(`SELECT id,phone,name FROM subscribers WHERE tenant_id=? AND phone IN (${manual.map(() => '?').join(',')})`, [req.tenantId, ...manual]);
        const [leads] = await conn.query(`SELECT id,phone,name FROM leads WHERE tenant_id=? AND hidden=0 AND phone IN (${manual.map(() => '?').join(',')})`, [req.tenantId, ...manual]);
        phones = [...subs.map(s => ({ ...s, subjectType: 'subscriber' })), ...leads.map(l => ({ ...l, subjectType: 'lead' }))];
      }
    }
    const seen = new Set();
    phones = phones.filter(p => { const key = String(p.phone || '').replace(/\D/g, ''); if (!key || seen.has(key)) return false; seen.add(key); return true; });
    phones = await filterSuppressed(req.tenantId, 'sms', phones, 'phone', conn);
    await conn.query("UPDATE sms_campaigns SET status='sending',sent_count=0,fail_count=0 WHERE id=? AND tenant_id=?", [campaign.id, req.tenantId]);
    for (const recipient of phones) {
      await outbox.enqueue({
        channel: 'sms', recipient: recipient.phone, payload: { message: campaign.message.replace(/\{\{name\}\}/g, recipient.name || '') }, tenantId: req.tenantId,
        dedupeKey: `sms-campaign:${campaign.id}:${destinationHash('sms', recipient.phone)}`, refType: 'sms_campaign', refId: campaign.id,
      }, conn);
    }
    if (!phones.length) await conn.query("UPDATE sms_campaigns SET status='sent',sent_at=NOW() WHERE id=? AND tenant_id=?", [campaign.id, req.tenantId]);
    await conn.commit(); transactionStarted = false;
    res.json({ ok: true, queued: phones.length });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn?.release(); }
});

// Drip Campaigns (drip_campaigns table) used to live here — CRUD only, no
// send worker at all, so creating one here never actually sent anything
// (MKT-05). The real, working drip system — drip_sequences +
// drip_enrollments, with a genuine 15-minute cron worker (see
// routes/analytics/campaigns.js) — already existed under a confusingly
// similar name (MKT-07); DripCampaignsTab.tsx now talks to that one instead.

module.exports = router;
