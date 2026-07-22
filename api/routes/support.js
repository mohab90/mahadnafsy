'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Customer-Service Hub — cohesive ticketing module.
// Unifies the previously-scattered ticket routes (were in campaigns.js) and adds
// cross-department ROUTING, SLA tracking, a full TIMELINE, and contact→ticket
// CONVERSION. This is the single home for how a customer problem enters the
// system (website / dashboard / phone / whatsapp) and moves between departments.
// ═══════════════════════════════════════════════════════════════════════════
const logger = require('../lib/logger');
const { Router } = require('express');
const router = Router();
const { pool, getStaffIdByEmail } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const outbox = require('../lib/outbox');
const { createNotification } = require('../lib/notification');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const {
  CATEGORY_META, DEPARTMENT_LABEL, resolveDepartment, defaultPriority,
  computeSlaDue, pickAssignee, logTicketEvent,
} = require('../lib/ticketRouting');

const CLOSED_STATUSES = ['resolved', 'closed'];
const OPEN_STATUSES = ['open', 'in_progress'];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function actorOf(req) {
  const name = req.user?.name || req.user?.email || 'إدارة';
  let id = req.staffRecord?.id || null;
  if (!id && req.user?.email) { try { id = await getStaffIdByEmail(req.user.email, req.tenantId); } catch { /* ignore */ } }
  return { id, name };
}

function slaFlag(t) {
  if (CLOSED_STATUSES.includes(String(t.status || '').toLowerCase())) return 'closed';
  if (t.first_response_at) return 'answered';
  if (!t.sla_due_at) return 'ontime';
  const due = new Date(t.sla_due_at).getTime();
  const now = Date.now();
  if (now > due) return 'overdue';
  if (due - now < 2 * 3600 * 1000) return 'due_soon';
  return 'ontime';
}

// Create a ticket with full routing + SLA. Returns the inserted row id.
async function createRoutedTicket(conn, {
  tenantId, subscriberId, email, name, subject, body, category, priority, channel,
  sourceType, sourceId, actor,
}) {
  const cat = CATEGORY_META[category] ? category : 'general';
  const dept = resolveDepartment(cat);
  const prio = priority || defaultPriority(cat);
  const slaDue = computeSlaDue(prio);
  const assignee = await pickAssignee(conn, tenantId, dept);
  const id = uuidv4();
  await conn.query(
    `INSERT INTO support_tickets
       (id, tenant_id, subscriber_id, subscriber_email, subscriber_name, subject, body,
        status, priority, category, department, channel, source_type, source_id,
        assigned_to, sla_due_at)
     VALUES (?,?,?,?,?,?,?, 'open', ?,?,?,?,?,?,?,?)`,
    [id, tenantId, subscriberId || null, email || null, name || null, subject, body,
     prio, cat, dept, channel || 'system', sourceType || null, sourceId || null,
     assignee?.id || null, slaDue]
  );
  await logTicketEvent(conn, { tenantId, ticketId: id, type: 'created', actorId: actor?.id, actorName: actor?.name, to: cat, detail: subject });
  await logTicketEvent(conn, { tenantId, ticketId: id, type: 'routed', actorId: actor?.id, actorName: actor?.name, to: `${DEPARTMENT_LABEL[dept] || dept}${assignee ? ' → ' + assignee.name : ''}` });
  if (assignee?.id) {
    createNotification('ticket', 'تذكرة جديدة موجّهة إليك', `${name || email || 'عميل'}: ${subject}`, { ticketId: id, department: dept }, tenantId).catch(() => {});
  }
  return { id, department: dept, priority: prio, assignee, slaDue };
}

// ── UNIFIED INBOX ────────────────────────────────────────────────────────────
// Tickets + not-yet-converted contact messages, with routing + SLA, filterable.
router.get('/api/admin/cs/inbox', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { department, category, status, sla, assignee, q } = req.query;
    const where = ['t.tenant_id = ?'];
    const params = [req.tenantId];
    if (department) { where.push('t.department = ?'); params.push(department); }
    if (category) { where.push('t.category = ?'); params.push(category); }
    if (status === 'open') where.push(`t.status IN ('open','in_progress')`);
    else if (status) { where.push('t.status = ?'); params.push(status); }
    if (assignee) { where.push('t.assigned_to = ?'); params.push(assignee); }
    if (q) { where.push('(t.subject LIKE ? OR t.subscriber_name LIKE ? OR t.subscriber_email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const [rows] = await pool.query(
      `SELECT t.id, t.subject, t.subscriber_name, t.subscriber_email, t.status, t.priority,
              t.category, t.department, t.channel, t.assigned_to, t.sla_due_at,
              t.first_response_at, t.escalated_at, t.created_at,
              s.name AS assignee_name,
              (SELECT COUNT(*) FROM ticket_replies tr WHERE tr.ticket_id = t.id AND tr.tenant_id=t.tenant_id) AS reply_count
         FROM support_tickets t
         LEFT JOIN staff s ON s.id = t.assigned_to AND s.tenant_id=t.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(t.status,'open','in_progress','resolved','closed'), t.created_at DESC
        LIMIT 300`, params);
    let tickets = rows.map(r => ({ ...r, kind: 'ticket', sla: slaFlag(r) }));
    if (sla) tickets = tickets.filter(t => t.sla === sla);

    // Un-triaged website contact messages (not converted to a ticket yet).
    let contacts = [];
    if (!department && !category && !assignee && (!status || status === 'open')) {
      const [crows] = await pool.query(
        `SELECT id, name, email, phone, subject, message, status, priority, created_at
           FROM contact_messages
          WHERE tenant_id = ? AND converted_ticket_id IS NULL
            AND LOWER(COALESCE(status,'new')) IN ('new','read','pending','unread')
          ORDER BY created_at DESC LIMIT 100`, [req.tenantId]).catch(() => [[]]);
      contacts = crows.map(r => ({
        id: r.id, kind: 'contact', subject: r.subject || 'رسالة تواصل',
        subscriber_name: r.name, subscriber_email: r.email, phone: r.phone,
        preview: String(r.message || '').slice(0, 140), status: String(r.status || 'new').toLowerCase(),
        priority: r.priority || 'medium', created_at: r.created_at, sla: 'untriaged',
      }));
    }
    res.json({ tickets, contacts, categories: CATEGORY_META, departments: DEPARTMENT_LABEL });
  } catch (e) { logger.error('[cs/inbox]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── STATS + AGENT WORKLOAD ───────────────────────────────────────────────────
router.get('/api/admin/cs/stats', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const [[counts]] = await pool.query(
      `SELECT
         SUM(status='open') AS open,
         SUM(status='in_progress') AS in_progress,
         SUM(status IN ('resolved','closed')) AS closed,
         SUM(status IN ('open','in_progress') AND sla_due_at IS NOT NULL AND sla_due_at < NOW() AND first_response_at IS NULL) AS overdue,
         AVG(CASE WHEN first_response_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, first_response_at) END) AS avg_first_response_min
       FROM support_tickets WHERE tenant_id = ?`, [req.tenantId]);
    const [byDept] = await pool.query(
      `SELECT COALESCE(department,'—') AS department, COUNT(*) AS total,
              SUM(status IN ('open','in_progress')) AS open
         FROM support_tickets WHERE tenant_id = ? GROUP BY department`, [req.tenantId]);
    const [workload] = await pool.query(
      `SELECT s.id, s.name, s.role,
              SUM(t.status IN ('open','in_progress')) AS open_tickets,
              SUM(t.status IN ('resolved','closed')) AS closed_tickets
         FROM staff s JOIN support_tickets t ON t.assigned_to = s.id AND t.tenant_id=s.tenant_id
        WHERE s.tenant_id=?
        GROUP BY s.id ORDER BY open_tickets DESC LIMIT 30`, [req.tenantId]);
    res.json({ counts, byDept, workload });
  } catch (e) { logger.error('[cs/stats]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── LIST + DETAIL ────────────────────────────────────────────────────────────
router.get('/api/admin/tickets', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const where = ['t.tenant_id = ?']; const params = [req.tenantId];
    if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
    const [rows] = await pool.query(
      `SELECT t.*, s.name AS assignee_name,
              (SELECT COUNT(*) FROM ticket_replies tr WHERE tr.ticket_id=t.id AND tr.tenant_id=t.tenant_id) AS reply_count
         FROM support_tickets t LEFT JOIN staff s ON s.id=t.assigned_to AND s.tenant_id=t.tenant_id
        WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT 500`, params);
    res.json(rows.map(r => ({ ...r, sla: slaFlag(r) })));
  } catch (e) { logger.error('[cs/list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/tickets/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const [[t]] = await pool.query('SELECT * FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const [replies] = await pool.query('SELECT id, ticket_id, author_type, author_name, body, created_at FROM ticket_replies WHERE ticket_id=? AND tenant_id=? ORDER BY created_at ASC', [req.params.id, req.tenantId]);
    const [timeline] = await pool.query('SELECT event_type, actor_name, from_value, to_value, detail, created_at FROM ticket_events WHERE ticket_id=? AND tenant_id=? ORDER BY created_at ASC', [req.params.id, req.tenantId]).catch(() => [[]]);
    // Linked origin entity (what the ticket is actually about).
    let linked = null;
    try {
      if (t.subscriber_id) {
        const [[sub]] = await pool.query('SELECT id, name, email, phone, client_code, branch FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [t.subscriber_id, req.tenantId]);
        if (sub) linked = { type: 'subscriber', ...sub };
      }
      if (t.source_type === 'payment' && t.source_id) {
        const [[p]] = await pool.query('SELECT id, amount, currency, payment_type, status, `date` FROM payments WHERE id=? AND tenant_id=? LIMIT 1', [t.source_id, req.tenantId]);
        if (p) linked = { type: 'payment', ...p, subscriber: linked };
      }
    } catch { /* linked entity is best-effort */ }
    res.json({ ...t, sla: slaFlag(t), replies, timeline, linked });
  } catch (e) { logger.error('[cs/detail]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CREATE (staff, e.g. phone/whatsapp intake) ───────────────────────────────
router.post('/api/admin/cs/tickets', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    const { subject, body, category, priority, channel, subscriber_id, email, name } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    if (subscriber_id) {
      const [[subscriber]] = await conn.query('SELECT id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriber_id, req.tenantId]);
      if (!subscriber) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Subscriber not found' }); }
    }
    const actor = await actorOf(req);
    const r = await createRoutedTicket(conn, {
      tenantId: req.tenantId, subscriberId: subscriber_id, email, name, subject, body,
      category, priority, channel: channel || 'phone', actor,
    });
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, ...r });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[cs/create]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CONVERT a website contact message → routed ticket ────────────────────────
router.post('/api/admin/cs/contact/:id/convert', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[c]] = await conn.query('SELECT * FROM contact_messages WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!c) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (c.converted_ticket_id) { await conn.rollback(); conn.release(); conn = null; return res.status(409).json({ error: 'Already converted', ticketId: c.converted_ticket_id }); }
    // Link to an existing subscriber by email/phone if we can.
    let subId = null;
    try {
      const [[sub]] = await conn.query(
        'SELECT id FROM subscribers WHERE tenant_id=? AND ((email IS NOT NULL AND LOWER(TRIM(email))=?) OR (phone IS NOT NULL AND phone=?)) LIMIT 1',
        [req.tenantId, String(c.email || '').toLowerCase().trim(), c.phone || '']);
      subId = sub?.id || null;
    } catch { /* ignore */ }
    const actor = await actorOf(req);
    const r = await createRoutedTicket(conn, {
      tenantId: req.tenantId, subscriberId: subId, email: c.email, name: c.name,
      subject: c.subject || 'رسالة من نموذج التواصل', body: c.message,
      category: req.body.category, priority: req.body.priority, channel: 'web_contact',
      sourceType: 'contact_message', sourceId: c.id, actor,
    });
    await conn.query("UPDATE contact_messages SET status='REPLIED', converted_ticket_id=? WHERE id=? AND tenant_id=?", [r.id, c.id, req.tenantId]);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: r.id, type: 'converted', actorId: actor.id, actorName: actor.name, from: 'contact_message', detail: c.subject || null });
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, ...r });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[cs/convert]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── RE-ROUTE (change category → recompute dept + reassign) ───────────────────
router.put('/api/admin/tickets/:id/route', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { category, priority } = req.body;
    const [[t]] = await pool.query('SELECT category, department, priority FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const cat = CATEGORY_META[category] ? category : t.category;
    const dept = resolveDepartment(cat);
    const prio = priority || t.priority;
    const assignee = await pickAssignee(pool, req.tenantId, dept);
    await pool.query('UPDATE support_tickets SET category=?, department=?, priority=?, assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=?',
      [cat, dept, prio, assignee?.id || null, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(pool, { tenantId: req.tenantId, ticketId: req.params.id, type: 'routed', actorId: actor.id, actorName: actor.name, from: `${DEPARTMENT_LABEL[t.department] || t.department || '—'}`, to: `${DEPARTMENT_LABEL[dept] || dept}${assignee ? ' → ' + assignee.name : ''}` });
    if (assignee?.id) createNotification('ticket', 'تذكرة موجّهة إليك', `تم تحويل تذكرة إلى قسمك`, { ticketId: req.params.id }, req.tenantId).catch(() => {});
    res.json({ ok: true, department: dept, assignee });
  } catch (e) { logger.error('[cs/route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── ASSIGN (manual) ──────────────────────────────────────────────────────────
router.put('/api/admin/tickets/:id/assign', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { staff_id } = req.body;
    const [[ticket]] = await pool.query('SELECT id FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    const [[st]] = staff_id ? await pool.query('SELECT id, name FROM staff WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [staff_id, req.tenantId]) : [[null]];
    if (staff_id && !st) return res.status(400).json({ error: 'Invalid staff member' });
    await pool.query('UPDATE support_tickets SET assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=?', [st?.id || null, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(pool, { tenantId: req.tenantId, ticketId: req.params.id, type: 'assigned', actorId: actor.id, actorName: actor.name, to: st?.name || 'إلغاء الإسناد' });
    if (st?.id) createNotification('ticket', 'تذكرة أُسندت إليك', `تم إسناد تذكرة إليك`, { ticketId: req.params.id }, req.tenantId).catch(() => {});
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/assign]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── REPLY (records first response for SLA) ───────────────────────────────────
router.post('/api/admin/tickets/:id/reply', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });
    const actor = await actorOf(req);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[t]] = await conn.query(
      'SELECT id,subject,subscriber_id,subscriber_email,subscriber_name FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!t) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const replyId = uuidv4();
    await conn.query('INSERT INTO ticket_replies (id, tenant_id, ticket_id, author_type, author_name, body) VALUES (?,?,?,?,?,?)',
      [replyId, req.tenantId, req.params.id, 'STAFF', actor.name, String(body)]);
    // First response closes the SLA clock; move open→in_progress.
    await pool.query(
      `UPDATE support_tickets
          SET status = IF(status='open','in_progress',status),
              first_response_at = COALESCE(first_response_at, NOW()),
              first_response_by = COALESCE(first_response_by, ?),
              updated_at = NOW()
        WHERE id=? AND tenant_id=?`, [actor.id, req.params.id, req.tenantId]);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'replied', actorId: actor.id, actorName: actor.name, detail: String(body).slice(0, 200) });
    if (t?.subscriber_email) {
      await outbox.enqueue({
        channel: 'email', recipient: t.subscriber_email, subject: `رد جديد على تذكرتك — ${t.subject || 'دعم'}`,
        payload: { html: `<div dir="rtl"><h2>مرحباً ${escapeHtml(t.subscriber_name || 'عزيزنا')}</h2><p>تم الرد على تذكرتك: <strong>${escapeHtml(t.subject)}</strong></p><div>${escapeHtml(body).replace(/\n/g, '<br>')}</div><p><a href="${escapeHtml(process.env.CLIENT_URL || 'https://mahadnafsy.com')}/dashboard">افتح لوحة التحكم</a></p></div>` },
        tenantId: req.tenantId, dedupeKey: `ticket-reply:${req.tenantId}:${replyId}`, refType: 'support_ticket', refId: req.params.id,
      }, conn);
    }
    let phone = null;
    if (t.subscriber_id) { const [[subscriber]] = await conn.query('SELECT phone FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [t.subscriber_id, req.tenantId]); phone = subscriber?.phone || null; }
    if (!phone && t.subscriber_email) { const [[subscriber]] = await conn.query('SELECT phone FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, String(t.subscriber_email).toLowerCase().trim()]); phone = subscriber?.phone || null; }
    if (phone) await outbox.enqueue({
      channel: 'whatsapp', recipient: phone,
      payload: { message: `رد جديد على تذكرتك "${t.subject || ''}":\n\n${String(body)}\n\nتابع المحادثة من لوحة التحكم.` },
      tenantId: req.tenantId, dedupeKey: `ticket-reply-wa:${req.tenantId}:${replyId}`, refType: 'support_ticket', refId: req.params.id,
    }, conn);
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[cs/reply]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── STATUS change (+ closed reason) ──────────────────────────────────────────
router.put('/api/admin/tickets/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { status, closed_reason } = req.body;
    const valid = ['open', 'in_progress', 'resolved', 'closed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const [[prev]] = await pool.query('SELECT status, subject, subscriber_email, subscriber_name, csat_requested_at FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!prev) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `UPDATE support_tickets SET status=?, closed_reason=?,
              resolved_at = IF(? IN ('resolved','closed'), COALESCE(resolved_at, NOW()), resolved_at),
              updated_at = NOW() WHERE id=? AND tenant_id=?`,
      [status, closed_reason || null, status, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(pool, { tenantId: req.tenantId, ticketId: req.params.id, type: 'status_changed', actorId: actor.id, actorName: actor.name, from: prev?.status, to: status, detail: closed_reason || null });
    // On the first resolution, ask the customer to rate it (CSAT).
    const nowResolved = status === 'resolved' || status === 'closed';
    const wasResolved = prev && CLOSED_STATUSES.includes(String(prev.status || '').toLowerCase());
    if (prev && nowResolved && !wasResolved && !prev.csat_requested_at && prev.subscriber_email) {
      await pool.query('UPDATE support_tickets SET csat_requested_at=NOW() WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]).catch(() => {});
      const link = `https://mahadnafsy.com/ticket-rating?id=${req.params.id}`;
      sendEmail(prev.subscriber_email, `كيف كان تقييمك لحل تذكرتك؟ — ${prev.subject || 'دعم'}`,
        `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
           <h2 style="color:#7c3aed">مرحباً ${prev.subscriber_name || ''}</h2>
           <p>تم حل تذكرة الدعم الخاصة بك: <strong>${prev.subject || ''}</strong></p>
           <p>يسعدنا معرفة مدى رضاك عن الحل:</p>
           <div style="text-align:center;margin:20px 0"><a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">قيّم الحل</a></div>
         </div>`).catch(e => logger.warn('[cs/csat email]', e.message));
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/status]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CSAT — public rating page data + submission (unauthenticated, id-gated) ─
router.get('/api/ticket-csat/:id', async (req, res) => {
  try {
    const [[t]] = await pool.query('SELECT subject, csat_score FROM support_tickets WHERE id=? LIMIT 1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ subject: t.subject, rated: t.csat_score != null });
  } catch (e) { logger.error('[cs/csat]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/ticket-csat/:id', async (req, res) => {
  try {
    const { score, comment } = req.body;
    if (score === undefined || score === null) return res.status(400).json({ error: 'score required' });
    const numScore = Math.min(5, Math.max(1, parseInt(score, 10)));
    await pool.query(
      'UPDATE support_tickets SET csat_score=?, csat_comment=?, csat_responded_at=NOW() WHERE id=?',
      [numScore, comment ? String(comment).slice(0, 2000) : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/csat]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Canned reply templates (admin-managed) ───────────────────────────────────
router.get('/api/admin/support/canned-responses', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, body, category FROM support_canned_responses WHERE tenant_id=? ORDER BY category, title',
      [req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[cs/canned]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/support/canned-responses', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { title, body, category } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const actor = await actorOf(req);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO support_canned_responses (id, tenant_id, title, body, category, created_by) VALUES (?,?,?,?,?,?)',
      [id, req.tenantId, String(title).slice(0, 200), String(body).slice(0, 4000), category ? String(category).slice(0, 100) : 'عام', actor.id]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[cs/canned]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put('/api/admin/support/canned-responses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { title, body, category } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    await pool.query(
      'UPDATE support_canned_responses SET title=?, body=?, category=?, updated_at=NOW() WHERE id=? AND tenant_id=?',
      [String(title).slice(0, 200), String(body).slice(0, 4000), category ? String(category).slice(0, 100) : 'عام', req.params.id, req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/canned]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/support/canned-responses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    await pool.query('DELETE FROM support_canned_responses WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/canned]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── FAQ knowledge base (admin-managed; public read lives in public.js) ──────
router.get('/api/admin/faq', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, question, answer, category, sort_order, is_published, created_at FROM faq_entries WHERE tenant_id=? ORDER BY category, sort_order, created_at',
      [req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[cs/faq]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/faq', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { question, answer, category, sort_order, is_published } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO faq_entries (id, tenant_id, question, answer, category, sort_order, is_published, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.tenantId, String(question).slice(0, 500), String(answer).slice(0, 5000), category ? String(category).slice(0, 100) : 'عام', Number(sort_order) || 0, is_published === false ? 0 : 1, (await actorOf(req)).id]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[cs/faq]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put('/api/admin/faq/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { question, answer, category, sort_order, is_published } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
    await pool.query(
      'UPDATE faq_entries SET question=?, answer=?, category=?, sort_order=?, is_published=?, updated_at=NOW() WHERE id=? AND tenant_id=?',
      [String(question).slice(0, 500), String(answer).slice(0, 5000), category ? String(category).slice(0, 100) : 'عام', Number(sort_order) || 0, is_published === false ? 0 : 1, req.params.id, req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/faq]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/faq/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    await pool.query('DELETE FROM faq_entries WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ ok: true });
  } catch (e) { logger.error('[cs/faq]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── ESCALATE to management ───────────────────────────────────────────────────
router.post('/api/admin/tickets/:id/escalate', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const assignee = await pickAssignee(pool, req.tenantId, 'management');
    await pool.query(
      `UPDATE support_tickets SET department='management', priority='high',
               escalated_at=COALESCE(escalated_at, NOW()), assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=?`,
      [assignee?.id || null, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(pool, { tenantId: req.tenantId, ticketId: req.params.id, type: 'escalated', actorId: actor.id, actorName: actor.name, to: assignee?.name || 'الإدارة', detail: req.body.reason || null });
    createNotification('ticket', '⚠️ تذكرة مُصعّدة', `تم تصعيد تذكرة للإدارة${req.body.reason ? ': ' + req.body.reason : ''}`, { ticketId: req.params.id }, req.tenantId).catch(() => {});
    res.json({ ok: true, assignee });
  } catch (e) { logger.error('[cs/escalate]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── DELETE (admin cleanup — e.g. test/duplicate tickets) ─────────────────────
router.delete('/api/admin/tickets/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[ticket]] = await conn.query('SELECT id FROM support_tickets WHERE id=? AND tenant_id=? FOR UPDATE', [req.params.id, req.tenantId]);
    if (!ticket) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    await conn.query('DELETE FROM ticket_replies WHERE ticket_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.query('DELETE FROM ticket_events WHERE ticket_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.query('DELETE FROM support_tickets WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[cs/delete]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CLIENT: submit + list own tickets (auto-routed) ──────────────────────────
router.post('/api/me/tickets', requireAuth, async (req, res) => {
  let conn;
  try {
    const { subject, body, category } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[sub]] = await conn.query('SELECT id, name, email FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, req.user.email?.toLowerCase().trim() || '']);
    const r = await createRoutedTicket(conn, {
      tenantId: req.tenantId, subscriberId: sub?.id, email: req.user.email, name: sub?.name || req.user.name,
      subject, body, category, channel: 'user_dashboard', actor: { id: null, name: sub?.name || req.user.email },
    });
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, id: r.id });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[me/tickets create]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/me/tickets', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.subject, t.status, t.category, t.priority, t.created_at,
              (SELECT COUNT(*) FROM ticket_replies tr WHERE tr.ticket_id=t.id) AS reply_count
         FROM support_tickets t WHERE t.tenant_id=? AND LOWER(TRIM(t.subscriber_email))=?
        ORDER BY t.created_at DESC LIMIT 50`, [req.tenantId, req.user.email?.toLowerCase().trim() || '']);
    res.json(rows);
  } catch (e) { logger.error('[me/tickets list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: view own ticket + its conversation (ownership-checked by email).
router.get('/api/me/tickets/:id', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim() || '';
    const [[t]] = await pool.query(
      'SELECT id, subject, body, status, category, priority, created_at, subscriber_email FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!t || String(t.subscriber_email || '').toLowerCase().trim() !== email) return res.status(404).json({ error: 'Not found' });
    const [replies] = await pool.query(
      'SELECT author_type, author_name, body, created_at FROM ticket_replies WHERE ticket_id=? AND tenant_id=? ORDER BY created_at ASC', [req.params.id, req.tenantId]);
    res.json({ id: t.id, subject: t.subject, body: t.body, status: t.status, category: t.category, priority: t.priority, created_at: t.created_at, replies });
  } catch (e) { logger.error('[me/ticket detail]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: reply to own ticket (re-opens it + notifies the assigned agent).
router.post('/api/me/tickets/:id/reply', requireAuth, async (req, res) => {
  let conn;
  try {
    const { body } = req.body;
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'body required' });
    const email = req.user.email?.toLowerCase().trim() || '';
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[t]] = await conn.query(
      'SELECT id, subscriber_email, subscriber_name, subject FROM support_tickets WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!t || String(t.subscriber_email || '').toLowerCase().trim() !== email) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    await conn.query('INSERT INTO ticket_replies (id, tenant_id, ticket_id, author_type, author_name, body) VALUES (?,?,?,?,?,?)',
      [uuidv4(), req.tenantId, req.params.id, 'CLIENT', t.subscriber_name || req.user.name || 'العميل', String(body)]);
    await conn.query("UPDATE support_tickets SET status=IF(status IN ('resolved','closed'),'open',status), updated_at=NOW() WHERE id=? AND tenant_id=?", [req.params.id, req.tenantId]);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'replied', actorName: t.subscriber_name || 'العميل', detail: String(body).slice(0, 200) });
    await conn.commit(); conn.release(); conn = null;
    createNotification('ticket', 'رد جديد من العميل', `${t.subscriber_name || email}: ${t.subject}`, { ticketId: req.params.id }, req.tenantId).catch(() => {});
    res.json({ ok: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[me/ticket reply]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── SLA + ESCALATION WORKER ──────────────────────────────────────────────────
// Periodic sweep: any open ticket past its SLA with no first response gets a
// one-time breach alert (guarded by a ticket_events note); if it stays unanswered
// well past due it auto-escalates to management. Self-scheduled (unref'd), so it
// never keeps the process alive and is a no-op until the DB is reachable.
async function slaSweep() {
  try {
    const [rows] = await pool.query(
      `SELECT id, tenant_id, assigned_to, sla_due_at, subject
         FROM support_tickets
        WHERE status IN ('open','in_progress') AND first_response_at IS NULL
          AND sla_due_at IS NOT NULL AND sla_due_at < NOW() AND escalated_at IS NULL
        ORDER BY sla_due_at ASC LIMIT 200`);
    for (const t of rows) {
      const breachMs = Date.now() - new Date(t.sla_due_at).getTime();
      const [[flag]] = await pool.query(
        "SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id=? AND tenant_id=? AND event_type='note' AND to_value='sla_breach'",
        [t.id, t.tenant_id]).catch(() => [[{ n: 1 }]]);
      if (!flag || !flag.n) {
        await logTicketEvent(pool, { tenantId: t.tenant_id, ticketId: t.id, type: 'note', to: 'sla_breach', detail: 'تجاوز زمن الاستجابة (SLA)' });
        createNotification('ticket', '⏰ تجاوز زمن الاستجابة', `تذكرة لم يُرد عليها ضمن المهلة: ${t.subject || ''}`, { ticketId: t.id }, t.tenant_id).catch(() => {});
      }
      if (breachMs > 6 * 3600 * 1000) { // >6h past due → auto-escalate to management
        const assignee = await pickAssignee(pool, t.tenant_id, 'management');
        await pool.query(
          "UPDATE support_tickets SET department='management', priority='high', escalated_at=NOW(), assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=? AND escalated_at IS NULL",
          [assignee?.id || null, t.id, t.tenant_id]);
        await logTicketEvent(pool, { tenantId: t.tenant_id, ticketId: t.id, type: 'escalated', actorName: 'النظام', to: assignee?.name || 'الإدارة', detail: 'تصعيد تلقائي (تجاوز SLA)' });
        // Alert the manager it was escalated to (in-app + WhatsApp if we have a phone).
        createNotification('ticket', '⚠️ تصعيد تلقائي (SLA)', `تذكرة تجاوزت المهلة وصُعّدت للإدارة: ${t.subject || ''}`, { ticketId: t.id, department: 'management' }, t.tenant_id).catch(() => {});
        if (assignee?.id) {
          try {
            const [[mgr]] = await pool.query('SELECT phone FROM staff WHERE id=? AND tenant_id=? LIMIT 1', [assignee.id, t.tenant_id]);
            const notifyWhatsApp = (phone, message) => require('../lib/whatsapp').sendWhatsApp(phone, message, { tenantId: t.tenant_id });
            if (mgr?.phone) notifyWhatsApp(mgr.phone, `⚠️ تذكرة دعم تجاوزت زمن الاستجابة وتم تصعيدها إليك: ${t.subject || ''}`).catch(() => {});
          } catch { /* whatsapp best-effort */ }
        }
      }
    }
  } catch (e) { logger.warn('[cs/slaSweep]', e.message); }
}
function scheduleSlaSweep() {
  const iv = setInterval(() => { slaSweep().catch(() => {}); }, 10 * 60 * 1000); // every 10 min
  if (iv.unref) iv.unref();
  return iv;
}
scheduleSlaSweep();

module.exports = router;
