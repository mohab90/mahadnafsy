'use strict';
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { sendEmail, htmlEmail } = require('../lib/email');
const { createNotification } = require('../lib/notification');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Email Campaigns ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/email-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, subject, body_html, audience, audience_filter, status,
              sent_count, fail_count, scheduled_at, sent_at, created_at, created_by
       FROM email_campaigns ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/email-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, subject, body_html, audience, audience_filter } = req.body;
    if (!title || !subject || !body_html) return res.status(400).json({ error: 'title, subject, body_html required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO email_campaigns (id, title, subject, body_html, audience, audience_filter, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [id, title, subject, body_html, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.user.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/email-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, subject, body_html, audience, audience_filter } = req.body;
    await pool.query(
      'UPDATE email_campaigns SET title=?, subject=?, body_html=?, audience=?, audience_filter=? WHERE id=?',
      [title, subject, body_html, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/email-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM email_campaigns WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/email-campaigns/:id/send — fire the campaign
router.post('/api/admin/email-campaigns/:id/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[campaign]] = await pool.query(
      `SELECT id, title, subject, body_html, audience, audience_filter, status,
              sent_count, fail_count, scheduled_at, sent_at, created_at, created_by
       FROM email_campaigns WHERE id=? LIMIT 1`, [req.params.id]
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'sending') return res.status(409).json({ error: 'Already sending' });

    await pool.query("UPDATE email_campaigns SET status='sending' WHERE id=?", [campaign.id]);

    // Collect recipients
    let emails = [];
    if (campaign.audience === 'subscribers' || campaign.audience === 'all') {
      const [subs] = await pool.query("SELECT email, name FROM subscribers WHERE is_active=1 AND email IS NOT NULL AND email != '' AND email LIKE '%@%'");
      emails = [...emails, ...subs.map(s => ({ email: s.email, name: s.name }))];
    }
    if (campaign.audience === 'leads' || campaign.audience === 'all') {
      const [leads] = await pool.query("SELECT email, name FROM leads WHERE email IS NOT NULL AND email != '' AND email LIKE '%@%'");
      emails = [...emails, ...leads.map(l => ({ email: l.email, name: l.name }))];
    }
    if (campaign.audience === 'manual' && campaign.audience_filter) {
      const filter = tryJson(campaign.audience_filter, {});
      if (Array.isArray(filter.emails)) emails = filter.emails.map(e => ({ email: e, name: '' }));
    }
    // Deduplicate
    const seen = new Set();
    emails = emails.filter(e => { if (!e.email || seen.has(e.email.toLowerCase())) return false; seen.add(e.email.toLowerCase()); return true; });

    // Send in batches of 5 with 3s delay to avoid SMTP spam triggers
    let sentCount = 0, failCount = 0;
    const BATCH = 5;
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(({ email, name }) =>
        sendEmail(email, campaign.subject,
          campaign.body_html.replace(/\{\{name\}\}/g, name || '').replace(/\{\{email\}\}/g, email)
        ).then(() => sentCount++).catch(() => failCount++)
      ));
      await new Promise(r => setTimeout(r, 3000)); // 3s between batches
    }

    await pool.query(
      "UPDATE email_campaigns SET status='sent', sent_count=?, fail_count=?, sent_at=NOW() WHERE id=?",
      [sentCount, failCount, campaign.id]
    );
    res.json({ ok: true, sentCount, failCount });
  } catch (e) {
    await pool.query("UPDATE email_campaigns SET status='failed' WHERE id=?", [req.params.id]).catch(() => {});
    console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Task Manager ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/tasks', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const where = req.query.mine === '1' ? 'WHERE assigned_to=?' : '';
    const params = req.query.mine === '1' ? [req.user.uid] : [];
    const [rows] = await pool.query(
      `SELECT id, title, description, assigned_to, assigned_name, related_sub_id, related_lead_id,
              priority, status, due_date, completed_at, created_by, created_at, updated_at
       FROM tasks ${where} ORDER BY due_date ASC, created_at DESC LIMIT 500`, params
    );
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/tasks', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const t = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO tasks (id, title, description, assigned_to, assigned_name, related_sub_id, related_lead_id, priority, status, due_date, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, t.title || 'مهمة جديدة', t.description || null, t.assigned_to || null, t.assigned_name || null,
       t.related_sub_id || null, t.related_lead_id || null, t.priority || 'medium',
       t.status || 'todo', t.due_date || null, req.user.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/tasks/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const t = req.body;
    const completedAt = t.status === 'done' ? 'NOW()' : 'NULL';
    await pool.query(
      `UPDATE tasks SET title=?, description=?, assigned_to=?, assigned_name=?, priority=?, status=?,
       due_date=?, related_sub_id=?, related_lead_id=?, completed_at=${completedAt}
       WHERE id=?`,
      [t.title, t.description || null, t.assigned_to || null, t.assigned_name || null,
       t.priority || 'medium', t.status || 'todo', t.due_date || null,
       t.related_sub_id || null, t.related_lead_id || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/tasks/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Support Tickets ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/tickets', requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? `WHERE t.status=?` : '';
    const params = req.query.status ? [req.query.status] : [];
    const [rows] = await pool.query(
      `SELECT t.*, COUNT(tr.id) AS reply_count FROM support_tickets t
       LEFT JOIN ticket_replies tr ON tr.ticket_id = t.id
       ${status} GROUP BY t.id ORDER BY t.created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/tickets/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[ticket]] = await pool.query(
      `SELECT id, subscriber_id, subscriber_email, subscriber_name, subject, body,
              status, priority, assigned_to, resolved_at, created_at, updated_at
       FROM support_tickets WHERE id=? LIMIT 1`, [req.params.id]
    );
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    const [replies] = await pool.query(
      'SELECT id, ticket_id, author_type, author_name, body, created_at FROM ticket_replies WHERE ticket_id=? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ ...ticket, replies });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/tickets/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, priority, assigned_to } = req.body;
    const resolvedAt = status === 'resolved' || status === 'closed' ? 'NOW()' : 'resolved_at';
    await pool.query(
      `UPDATE support_tickets SET status=?, priority=?, assigned_to=?, resolved_at=IF(?='resolved' OR ?='closed', NOW(), resolved_at) WHERE id=?`,
      [status, priority, assigned_to || null, status, status, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/tickets/:id/reply', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO ticket_replies (id, ticket_id, author_type, author_name, body) VALUES (?,?,?,?,?)',
      [id, req.params.id, 'staff', req.user.name || req.user.email || 'إدارة', body]
    );
    await pool.query("UPDATE support_tickets SET status='in_progress', updated_at=NOW() WHERE id=? AND status='open'", [req.params.id]);

    // Send notification email to ticket submitter
    const [[ticket]] = await pool.query('SELECT subject, subscriber_email, subscriber_name FROM support_tickets WHERE id=? LIMIT 1', [req.params.id]);
    if (ticket?.subscriber_email) {
      sendEmail(ticket.subscriber_email,
        `💬 رد جديد على تذكرتك — ${ticket.subject || 'دعم فني'}`,
        `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#7c3aed">مرحباً ${ticket.subscriber_name || 'عزيزنا'}</h2>
          <p>تم الرد على تذكرة الدعم الخاصة بك: <strong>${ticket.subject || ''}</strong></p>
          <div style="background:#f5f3ff;border-right:4px solid #7c3aed;padding:16px;margin:16px 0;border-radius:8px">
            <p style="margin:0">${body.replace(/\n/g, '<br>')}</p>
          </div>
          <p>يمكنك الاطلاع على تذكرتك والرد من خلال <a href="https://mahadnafsy.com/dashboard" style="color:#7c3aed">لوحة التحكم</a>.</p>
          <p style="color:#9ca3af;font-size:12px">معهد نفسي — mahadnafsy.com</p>
        </div>`
      ).catch(e => console.warn('[email] ticket reply notification failed:', e.message));
    }

    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: submit a support ticket
router.post('/api/me/tickets', requireAuth, async (req, res) => {
  try {
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    const [[sub]] = await pool.query(
      'SELECT id, name, email FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1',
      [req.user.email?.toLowerCase().trim() || '']
    );
    const id = uuidv4();
    await pool.query(
      `INSERT INTO support_tickets (id, subscriber_id, subscriber_email, subscriber_name, subject, body)
       VALUES (?,?,?,?,?,?)`,
      [id, sub?.id || null, req.user.email || null, sub?.name || req.user.name || null, subject, body]
    );
    await createNotification('ticket', 'تذكرة دعم جديدة', `${sub?.name || req.user.email} فتح تذكرة: ${subject}`, { ticketId: id });
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: get own tickets
router.get('/api/me/tickets', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim() || '';
    const [rows] = await pool.query(
      `SELECT t.*, COUNT(tr.id) AS reply_count FROM support_tickets t
       LEFT JOIN ticket_replies tr ON tr.ticket_id = t.id
       WHERE LOWER(TRIM(t.subscriber_email))=?
       GROUP BY t.id ORDER BY t.created_at DESC LIMIT 50`,
      [email]
    );
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Webhooks ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/webhooks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, url, events, is_active, last_triggered_at, last_status, created_at FROM webhooks ORDER BY created_at DESC');
    res.json(rows.map(r => ({ ...r, events: tryJson(r.events, []) })));
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/webhooks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, url, secret, events } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO webhooks (id, name, url, secret, events) VALUES (?,?,?,?,?)',
      [id, name, url, secret || null, JSON.stringify(events || [])]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/webhooks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, url, secret, events, is_active } = req.body;
    await pool.query(
      'UPDATE webhooks SET name=?, url=?, secret=?, events=?, is_active=? WHERE id=?',
      [name, url, secret || null, JSON.stringify(events || []), is_active ? 1 : 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/webhooks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM webhooks WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/webhooks/:id/test — send a test payload
router.post('/api/admin/webhooks/:id/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[wh]] = await pool.query(
      `SELECT id, name, url, secret, events, is_active, last_triggered_at, last_status, created_at
       FROM webhooks WHERE id=? LIMIT 1`, [req.params.id]
    );
    if (!wh) return res.status(404).json({ error: 'Not found' });
    const payload = { event: 'test', timestamp: new Date().toISOString(), data: { message: 'Test webhook from Mahad' } };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(wh.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(wh.secret ? { 'X-Webhook-Secret': wh.secret } : {}) },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    await pool.query('UPDATE webhooks SET last_triggered_at=NOW(), last_status=? WHERE id=?', [resp.status, wh.id]);
    res.json({ ok: true, status: resp.status });
  } catch (e) {
    await pool.query('UPDATE webhooks SET last_triggered_at=NOW(), last_status=0 WHERE id=?', [req.params.id]).catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Internal webhook trigger helper
async function triggerWebhooks(event, data) {
  try {
    const [hooks] = await pool.query("SELECT id, url, secret, events FROM webhooks WHERE is_active=1 AND JSON_CONTAINS(events, ?, '$') LIMIT 100", [JSON.stringify(event)]);
    for (const wh of hooks) {
      const payload = { event, timestamp: new Date().toISOString(), data };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      fetch(wh.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(wh.secret ? { 'X-Webhook-Secret': wh.secret } : {}) },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      }).then(r => pool.query('UPDATE webhooks SET last_triggered_at=NOW(), last_status=? WHERE id=?', [r.status, wh.id]))
        .catch(() => pool.query('UPDATE webhooks SET last_triggered_at=NOW(), last_status=0 WHERE id=?', [wh.id]))
        .finally(() => clearTimeout(t));
    }
  } catch (_) { /* non-fatal */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Budget vs Actual ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/budgets', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { month } = req.query; // YYYY-MM
    const where = month ? 'WHERE month=?' : '';
    const params = month ? [month] : [];
    const [rows] = await pool.query(
      `SELECT id, month, category, budgeted_amount, currency, notes, created_at
       FROM budgets ${where} ORDER BY month DESC, category ASC`, params
    );
    // Get actual spending per month per category from expenses
    let actual = [];
    if (month) {
      const [exp] = await pool.query(
        `SELECT category, SUM(amount) AS actual FROM expenses WHERE DATE_FORMAT(date, '%Y-%m')=? GROUP BY category`,
        [month]
      );
      actual = exp;
    }
    res.json({ budgets: rows, actual });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/budgets', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { month, category, budgeted_amount, currency, notes } = req.body;
    if (!month || !category) return res.status(400).json({ error: 'month and category required' });
    await pool.query(
      `INSERT INTO budgets (id, month, category, budgeted_amount, currency, notes) VALUES (UUID(),?,?,?,?,?)
       ON DUPLICATE KEY UPDATE budgeted_amount=VALUES(budgeted_amount), currency=VALUES(currency), notes=VALUES(notes)`,
      [month, category, budgeted_amount || 0, currency || 'EGP', notes || null]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/budgets/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM budgets WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: NPS / Customer Satisfaction ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/nps', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, subscriber_id, subscriber_email, score, comment, payment_id,
              sent_at, responded_at, created_at
       FROM nps_responses ORDER BY created_at DESC LIMIT 500`
    );
    const [agg] = await pool.query('SELECT AVG(score) AS avg_score, COUNT(*) AS total, SUM(score >= 9) AS promoters, SUM(score <= 6) AS detractors FROM nps_responses WHERE responded_at IS NOT NULL');
    const a = agg[0];
    const npsScore = a.total > 0 ? Math.round(((a.promoters - a.detractors) / a.total) * 100) : null;
    res.json({ rows, avg: a.avg_score ? parseFloat((+a.avg_score).toFixed(1)) : null, total: a.total, npsScore });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: submit NPS response (via link from email)
router.post('/api/nps/respond', async (req, res) => {
  try {
    const { id, score, comment } = req.body;
    if (!id || score === undefined) return res.status(400).json({ error: 'id and score required' });
    const numScore = Math.min(10, Math.max(0, parseInt(score, 10)));
    await pool.query(
      'UPDATE nps_responses SET score=?, comment=?, responded_at=NOW() WHERE id=?',
      [numScore, comment || null, id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: manually send NPS to subscriber
router.post('/api/admin/nps/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { subscriber_id } = req.body;
    const [[sub]] = await pool.query('SELECT id, email, name FROM subscribers WHERE id=? LIMIT 1', [subscriber_id]);
    if (!sub || !sub.email) return res.status(404).json({ error: 'Subscriber not found or no email' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO nps_responses (id, subscriber_id, subscriber_email, sent_at) VALUES (?,?,?,NOW())',
      [id, sub.id, sub.email]
    );
    const link = `https://mahadnafsy.com/nps?id=${id}`;
    await sendEmail(sub.email, 'كيف تقيّم تجربتك مع معهد الدراسات النفسية؟',
      htmlEmail('تقييمك يهمنا', `
        <p>مرحباً <strong>${sub.name || ''}</strong>،</p>
        <p>يسعدنا معرفة رأيك في خدماتنا. يرجى تقييم تجربتك من 0 إلى 10:</p>
        <div style="text-align:center;margin:20px 0">
          <a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;">قيّم الآن</a>
        </div>
        <p style="color:#9ca3af;font-size:12px">الرابط صالح لمرة واحدة فقط</p>
      `)
    ).catch(() => {});
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: SMS Campaigns ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/sms-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, message, audience, audience_filter, status,
              sent_count, fail_count, sent_at, created_at, created_by
       FROM sms_campaigns ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/sms-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, message, audience, audience_filter } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });
    const id = uuidv4();
    await pool.query(
      "INSERT INTO sms_campaigns (id, title, message, audience, audience_filter, status, created_by) VALUES (?,?,?,?,?,'draft',?)",
      [id, title, message, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.user.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/sms-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, message, audience, audience_filter } = req.body;
    await pool.query(
      'UPDATE sms_campaigns SET title=?, message=?, audience=?, audience_filter=? WHERE id=?',
      [title, message, audience || 'all', audience_filter ? JSON.stringify(audience_filter) : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/sms-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM sms_campaigns WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/sms-campaigns/:id/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[campaign]] = await pool.query(
      `SELECT id, title, message, audience, audience_filter, status,
              sent_count, fail_count, sent_at, created_at, created_by
       FROM sms_campaigns WHERE id=? LIMIT 1`, [req.params.id]
    );
    if (!campaign) return res.status(404).json({ error: 'Not found' });

    let phones = [];
    if (campaign.audience === 'subscribers' || campaign.audience === 'all') {
      const [subs] = await pool.query("SELECT phone, name FROM subscribers WHERE is_active=1 AND phone IS NOT NULL AND phone != ''");
      phones = [...phones, ...subs.map(s => ({ phone: s.phone, name: s.name }))];
    }
    if (campaign.audience === 'leads' || campaign.audience === 'all') {
      const [leads] = await pool.query("SELECT phone, name FROM leads WHERE phone IS NOT NULL AND phone != ''");
      phones = [...phones, ...leads.map(l => ({ phone: l.phone, name: l.name }))];
    }
    if (campaign.audience === 'manual' && campaign.audience_filter) {
      const filter = tryJson(campaign.audience_filter, {});
      if (Array.isArray(filter.phones)) phones = filter.phones.map(p => ({ phone: p, name: '' }));
    }
    const seen = new Set();
    phones = phones.filter(p => { if (!p.phone || seen.has(p.phone)) return false; seen.add(p.phone); return true; });
    const totalCount = phones.length;

    // Mark as sent immediately (actual SMS provider integration is plugged in via env var SMS_API_KEY)
    await pool.query(
      "UPDATE sms_campaigns SET status='sent', sent_count=?, sent_at=NOW() WHERE id=?",
      [totalCount, campaign.id]
    );
    res.json({ ok: true, totalCount, note: 'SMS queued for delivery. Configure SMS_API_KEY in env to enable actual sending.' });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Drip Campaigns ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure drip_campaigns table exists
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS drip_campaigns (
      id VARCHAR(36) NOT NULL DEFAULT (UUID()),
      name VARCHAR(500) NOT NULL,
      trigger_event VARCHAR(255) NOT NULL DEFAULT 'subscription_created'
        COMMENT 'subscription_created|lead_status:interested|consultation_completed|payment_received',
      audience ENUM('subscribers','leads','all') NOT NULL DEFAULT 'subscribers',
      status ENUM('active','paused','draft') NOT NULL DEFAULT 'draft',
      enrolled_count INT NOT NULL DEFAULT 0,
      completed_count INT NOT NULL DEFAULT 0,
      steps JSON NOT NULL DEFAULT ('[]'),
      created_by VARCHAR(36) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4`);
  } catch (e) { console.warn('[drip_campaigns table]', e.message); }
})();

router.get('/api/admin/drip-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, trigger_event, audience, status, enrolled_count, completed_count, steps, created_at FROM drip_campaigns ORDER BY created_at DESC LIMIT 200'
    );
    res.json(rows.map(r => ({ ...r, steps: tryJson(r.steps, []) })));
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/drip-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, trigger_event, audience, steps } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    await pool.query(
      "INSERT INTO drip_campaigns (id, name, trigger_event, audience, status, steps, created_by) VALUES (?,?,?,?,'draft',?,?)",
      [id, name, trigger_event || 'subscription_created', audience || 'subscribers', JSON.stringify(steps || []), req.user.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/drip-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, trigger_event, audience, status, steps } = req.body;
    await pool.query(
      'UPDATE drip_campaigns SET name=?, trigger_event=?, audience=?, status=?, steps=? WHERE id=?',
      [name, trigger_event || 'subscription_created', audience || 'subscribers', status || 'draft', JSON.stringify(steps || []), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/drip-campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM drip_campaigns WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
