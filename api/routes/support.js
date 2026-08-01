'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Customer-Service Hub — cohesive ticketing module.
// Unifies the previously-scattered ticket routes (were in campaigns.js) and adds
// cross-department ROUTING, SLA tracking, a full TIMELINE, and contact→ticket
// CONVERSION. This is the single home for how a customer problem enters the
// system (website / dashboard / phone / whatsapp) and moves between departments.
// ═══════════════════════════════════════════════════════════════════════════
const logger = require('../lib/logger');
const { createHash, randomBytes } = require('crypto');
const { Router } = require('express');
const router = Router();
const { pool, getStaffIdByEmail } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const outbox = require('../lib/outbox');
const { createNotification, insertNotification } = require('../lib/notification');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { findSubscriberForIdentity } = require('../lib/privacyService');
const { writeAuditEvent } = require('../lib/auditTrail');
const {
  CATEGORY_META, DEPARTMENT_LABEL, DEPARTMENT_ROLES, resolveDepartment, defaultPriority,
  computeSlaDue, pickAssignee, logTicketEvent,
} = require('../lib/ticketRouting');

const CLOSED_STATUSES = ['resolved', 'closed'];
const OPEN_STATUSES = ['open', 'in_progress'];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const hashCsatToken = token => createHash('sha256').update(String(token || '')).digest('hex');
const TEXT_LIMITS = Object.freeze({ subject: 500, body: 20000, reason: 1000 });
const VALID_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
const normalizedEmail = value => String(value || '').trim().toLowerCase();
const ownsTicket = (ticket, subscriber, email) => Boolean(ticket && (
  (subscriber?.id && ticket.subscriber_id === subscriber.id)
  || (email && normalizedEmail(ticket.subscriber_email) === email)
));
const departmentsForRole = role => Object.entries(DEPARTMENT_ROLES)
  .filter(([, roles]) => roles.includes(String(role || '').toLowerCase()))
  .map(([department]) => department);
const ticketScope = (req, alias = 't') => {
  if (req.isSuperAdmin || ['manager', 'admin'].includes(String(req.staffRecord?.role || '').toLowerCase())) {
    return { sql: '1=1', params: [] };
  }
  const departments = departmentsForRole(req.staffRecord?.role);
  if (!departments.length) return { sql: '1=0', params: [] };
  return {
    sql: `(${alias}.department IN (${departments.map(() => '?').join(',')}) OR ${alias}.assigned_to=?)`,
    params: [...departments, req.staffRecord?.id || ''],
  };
};
const canAccessTicket = (req, ticket) => {
  if (!ticket) return false;
  if (req.isSuperAdmin || ['manager', 'admin'].includes(String(req.staffRecord?.role || '').toLowerCase())) return true;
  return ticket.assigned_to === req.staffRecord?.id
    || departmentsForRole(req.staffRecord?.role).includes(ticket.department);
};

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
  subject = cleanText(subject, TEXT_LIMITS.subject);
  body = cleanText(body, TEXT_LIMITS.body);
  if (!subject || !body) throw new Error('Ticket subject and body are required');
  const cat = CATEGORY_META[category] ? category : 'general';
  const dept = resolveDepartment(cat);
  const prio = VALID_PRIORITIES.has(String(priority || '').toLowerCase())
    ? String(priority).toLowerCase()
    : defaultPriority(cat);
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
    await insertNotification(
      conn, 'ticket', 'تذكرة جديدة موجّهة إليك',
      `${name || email || 'عميل'}: ${subject}`,
      { ticketId: id, department: dept }, tenantId, assignee.id
    );
  }
  return { id, department: dept, priority: prio, assignee, slaDue };
}

// ── UNIFIED INBOX ────────────────────────────────────────────────────────────
// Tickets + not-yet-converted contact messages, with routing + SLA, filterable.
router.get('/api/admin/cs/inbox', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const { department, category, status, sla, assignee, q } = req.query;
    const where = ['t.tenant_id = ?', 't.deleted_at IS NULL'];
    const params = [req.tenantId];
    const scope = ticketScope(req);
    where.push(scope.sql);
    params.push(...scope.params);
    if (department) { where.push('t.department = ?'); params.push(department); }
    if (category) { where.push('t.category = ?'); params.push(category); }
    if (status === 'open') where.push(`t.status IN ('open','in_progress')`);
    else if (status) { where.push('t.status = ?'); params.push(status); }
    if (assignee) { where.push('t.assigned_to = ?'); params.push(assignee); }
    if (q) {
      // A complete email address is unambiguous, so match it exactly and let the
      // index serve it. Anything else (subject text, part of a name) stays a
      // contains-scan — there is no safe way to guess an identifier from it.
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) {
        where.push('t.subscriber_email = ?');
        params.push(q);
      } else {
        where.push('(t.subject LIKE ? OR t.subscriber_name LIKE ? OR t.subscriber_email LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
    }
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
          ORDER BY created_at DESC LIMIT 100`, [req.tenantId]);
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
    const scope = ticketScope(req);
    const [[counts]] = await pool.query(
      `SELECT
         SUM(status='open') AS open,
         SUM(status='in_progress') AS in_progress,
         SUM(status IN ('resolved','closed')) AS closed,
         SUM(status IN ('open','in_progress') AND sla_due_at IS NOT NULL AND sla_due_at < NOW() AND first_response_at IS NULL) AS overdue,
         AVG(CASE WHEN first_response_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, first_response_at) END) AS avg_first_response_min
       FROM support_tickets t WHERE t.tenant_id=? AND t.deleted_at IS NULL AND ${scope.sql}`,
      [req.tenantId, ...scope.params]);
    const [byDept] = await pool.query(
      `SELECT COALESCE(department,'—') AS department, COUNT(*) AS total,
              SUM(status IN ('open','in_progress')) AS open
         FROM support_tickets t
        WHERE t.tenant_id=? AND t.deleted_at IS NULL AND ${scope.sql}
        GROUP BY department`, [req.tenantId, ...scope.params]);
    const [workload] = await pool.query(
      `SELECT s.id, s.name, s.role,
              SUM(t.status IN ('open','in_progress')) AS open_tickets,
              SUM(t.status IN ('resolved','closed')) AS closed_tickets
         FROM staff s JOIN support_tickets t ON t.assigned_to = s.id AND t.tenant_id=s.tenant_id
         WHERE s.tenant_id=? AND t.deleted_at IS NULL AND ${scope.sql}
        GROUP BY s.id ORDER BY open_tickets DESC LIMIT 30`,
      [req.tenantId, ...scope.params]);
    res.json({ counts, byDept, workload });
  } catch (e) { logger.error('[cs/stats]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── LIST + DETAIL ────────────────────────────────────────────────────────────
router.get('/api/admin/tickets', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  try {
    const where = ['t.tenant_id = ?', 't.deleted_at IS NULL']; const params = [req.tenantId];
    const scope = ticketScope(req);
    where.push(scope.sql); params.push(...scope.params);
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
    const [[t]] = await pool.query('SELECT * FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [req.params.id, req.tenantId]);
    if (!canAccessTicket(req, t)) return res.status(404).json({ error: 'Not found' });
    const [replies] = await pool.query('SELECT id, ticket_id, author_type, author_name, body, created_at FROM ticket_replies WHERE ticket_id=? AND tenant_id=? ORDER BY created_at ASC', [req.params.id, req.tenantId]);
    const [timeline] = await pool.query('SELECT event_type, actor_name, from_value, to_value, detail, created_at FROM ticket_events WHERE ticket_id=? AND tenant_id=? ORDER BY created_at ASC', [req.params.id, req.tenantId]);
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
    } catch (error) {
      logger.warn('[cs/detail-linked]', { ticketId: req.params.id, error: error.message });
    }
    res.json({ ...t, sla: slaFlag(t), replies, timeline, linked });
  } catch (e) { logger.error('[cs/detail]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CREATE (staff, e.g. phone/whatsapp intake) ───────────────────────────────
router.post('/api/admin/cs/tickets', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    const { category, priority, channel, subscriber_id } = req.body;
    let email = cleanText(req.body.email, 320) || null;
    let name = cleanText(req.body.name, 255) || null;
    const subject = cleanText(req.body.subject, TEXT_LIMITS.subject);
    const body = cleanText(req.body.body, TEXT_LIMITS.body);
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    if (subscriber_id) {
      const [[subscriber]] = await conn.query(
        'SELECT id,email,name FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [subscriber_id, req.tenantId]
      );
      if (!subscriber) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Subscriber not found' }); }
      email = subscriber.email || email;
      name = subscriber.name || name;
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
    const contactEmail = String(c.email || '').toLowerCase().trim();
    const contactPhone = String(c.phone || '').trim();
    if (contactEmail || contactPhone) {
      const conditions = [];
      const identityParams = [req.tenantId];
      if (contactEmail) {
        conditions.push('(email IS NOT NULL AND LOWER(TRIM(email))=?)');
        identityParams.push(contactEmail);
      }
      if (contactPhone) {
        conditions.push('(phone IS NOT NULL AND TRIM(phone)=?)');
        identityParams.push(contactPhone);
      }
      const [[sub]] = await conn.query(
        `SELECT id FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL AND (${conditions.join(' OR ')})
          LIMIT 1`,
        identityParams
      );
      subId = sub?.id || null;
    }
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
  let conn;
  try {
    const { category, priority } = req.body;
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT category,department,priority,assigned_to FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!t) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (!canAccessTicket(req, t)) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const cat = CATEGORY_META[category] ? category : t.category;
    const dept = resolveDepartment(cat);
    const prio = VALID_PRIORITIES.has(String(priority || '').toLowerCase())
      ? String(priority).toLowerCase()
      : t.priority;
    const assignee = await pickAssignee(conn, req.tenantId, dept);
    await conn.query('UPDATE support_tickets SET category=?, department=?, priority=?, assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=?',
      [cat, dept, prio, assignee?.id || null, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'routed', actorId: actor.id, actorName: actor.name, from: `${DEPARTMENT_LABEL[t.department] || t.department || '—'}`, to: `${DEPARTMENT_LABEL[dept] || dept}${assignee ? ' → ' + assignee.name : ''}` });
    await conn.commit(); conn.release(); conn = null;
    if (assignee?.id) createNotification('ticket', 'تذكرة موجّهة إليك', `تم تحويل تذكرة إلى قسمك`, { ticketId: req.params.id }, req.tenantId, assignee.id).catch(() => {});
    res.json({ ok: true, department: dept, assignee });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    logger.error('[cs/route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/cs/contact/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  const status = String(req.body?.status || '').toUpperCase();
  if (!['NEW', 'READ', 'REPLIED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid contact status' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[contact]] = await conn.query(
      'SELECT id,status FROM contact_messages WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!contact) {
      await conn.rollback();
      return res.status(404).json({ error: 'Contact message not found' });
    }
    const transitions = {
      NEW: new Set(['NEW', 'READ', 'REPLIED']),
      READ: new Set(['READ', 'NEW', 'REPLIED']),
      REPLIED: new Set(['REPLIED', 'READ']),
    };
    if (!transitions[contact.status]?.has(status)) {
      await conn.rollback();
      return res.status(409).json({ error: `Invalid contact transition: ${contact.status} -> ${status}` });
    }
    await conn.query(
      'UPDATE contact_messages SET status=? WHERE id=? AND tenant_id=?',
      [status, req.params.id, req.tenantId]
    );
    await writeAuditEvent({
      action: 'CONTACT_MESSAGE_STATUS_CHANGED',
      entityType: 'CONTACT_MESSAGE',
      entityId: req.params.id,
      metadata: { from: contact.status, to: status },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true, status });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[cs/contact-status]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// ── ASSIGN (manual) ──────────────────────────────────────────────────────────
router.put('/api/admin/tickets/:id/assign', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    const { staff_id } = req.body;
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[ticket]] = await conn.query('SELECT id,department FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!ticket) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (!canAccessTicket(req, ticket)) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const [[st]] = staff_id ? await conn.query('SELECT id,name,role FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1', [staff_id, req.tenantId]) : [[null]];
    if (staff_id && !st) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'Invalid staff member' }); }
    const compatibleRoles = DEPARTMENT_ROLES[ticket.department] || [];
    if (st && !['manager', 'admin'].includes(String(st.role || '').toLowerCase())
      && !compatibleRoles.includes(String(st.role || '').toLowerCase())) {
      await conn.rollback(); conn.release(); conn = null;
      return res.status(400).json({ error: 'Staff role is not compatible with the ticket department' });
    }
    await conn.query('UPDATE support_tickets SET assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=?', [st?.id || null, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'assigned', actorId: actor.id, actorName: actor.name, to: st?.name || 'إلغاء الإسناد' });
    await conn.commit(); conn.release(); conn = null;
    if (st?.id) createNotification('ticket', 'تذكرة أُسندت إليك', `تم إسناد تذكرة إليك`, { ticketId: req.params.id }, req.tenantId, st.id).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    logger.error('[cs/assign]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── REPLY (records first response for SLA) ───────────────────────────────────
router.post('/api/admin/tickets/:id/reply', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    const body = cleanText(req.body.body, TEXT_LIMITS.body);
    if (!body) return res.status(400).json({ error: 'body required' });
    const actor = await actorOf(req);
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[t]] = await conn.query(
      'SELECT id,status,department,assigned_to,subject,subscriber_id,subscriber_email,subscriber_name FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!t) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (!canAccessTicket(req, t)) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (t.status === 'closed') {
      await conn.rollback(); conn.release(); conn = null;
      return res.status(409).json({ error: 'Reopen the closed ticket before replying' });
    }
    const replyId = uuidv4();
    await conn.query('INSERT INTO ticket_replies (id, tenant_id, ticket_id, author_type, author_name, body) VALUES (?,?,?,?,?,?)',
      [replyId, req.tenantId, req.params.id, 'STAFF', actor.name, String(body)]);
    // First response closes the SLA clock; move open→in_progress.
    await conn.query(
      `UPDATE support_tickets
          SET status = IF(status IN ('open','resolved'),'in_progress',status),
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
    res.json({
      ok: true,
      reply: { id: replyId, body, author_type: 'staff', author_name: actor.name, created_at: new Date().toISOString() },
    });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[cs/reply]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── STATUS change (+ closed reason) ──────────────────────────────────────────
router.put('/api/admin/tickets/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_inbox'), async (req, res) => {
  let conn;
  try {
    const { status } = req.body;
    const closedReason = cleanText(req.body.closed_reason, TEXT_LIMITS.reason);
    const valid = ['open', 'in_progress', 'resolved', 'closed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'invalid status' });
    if (status === 'closed' && !closedReason) return res.status(400).json({ error: 'closed_reason required when closing a ticket' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[prev]] = await conn.query(
      'SELECT status,department,assigned_to,subject,subscriber_email,subscriber_name,csat_requested_at FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]);
    if (!prev) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (!canAccessTicket(req, prev)) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const transitions = {
      open: new Set(['in_progress', 'resolved', 'closed']),
      in_progress: new Set(['open', 'resolved', 'closed']),
      resolved: new Set(['open', 'in_progress', 'closed']),
      closed: new Set(['open', 'in_progress']),
    };
    if (status !== prev.status && !transitions[prev.status]?.has(status)) {
      await conn.rollback(); conn.release(); conn = null;
      return res.status(409).json({ error: `Invalid status transition: ${prev.status} -> ${status}` });
    }
    await conn.query(
      `UPDATE support_tickets SET status=?, closed_reason=?,
               resolved_at = IF(? IN ('resolved','closed'), COALESCE(resolved_at, NOW()), resolved_at),
               updated_at = NOW() WHERE id=? AND tenant_id=?`,
      [status, closedReason || null, status, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'status_changed', actorId: actor.id, actorName: actor.name, from: prev.status, to: status, detail: closedReason || null });
    // On the first resolution, ask the customer to rate it (CSAT).
    const nowResolved = status === 'resolved' || status === 'closed';
    const wasResolved = prev && CLOSED_STATUSES.includes(String(prev.status || '').toLowerCase());
    if (prev && nowResolved && !wasResolved && !prev.csat_requested_at && prev.subscriber_email) {
      const csatToken = randomBytes(32).toString('hex');
      await conn.query(
        `UPDATE support_tickets
         SET csat_requested_at=NOW(), csat_token_hash=?,
             csat_token_expires_at=DATE_ADD(NOW(), INTERVAL 30 DAY)
         WHERE id=? AND tenant_id=?`,
        [hashCsatToken(csatToken), req.params.id, req.tenantId]
      );
      const clientBaseUrl = String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
      const link = `${clientBaseUrl}/ticket-rating?id=${encodeURIComponent(req.params.id)}&token=${encodeURIComponent(csatToken)}`;
      await outbox.enqueue({
        channel: 'email', recipient: prev.subscriber_email, subject: `كيف كان تقييمك لحل تذكرتك؟ — ${prev.subject || 'دعم'}`,
        payload: { html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
           <h2 style="color:#7c3aed">مرحباً ${escapeHtml(prev.subscriber_name || '')}</h2>
           <p>تم حل تذكرة الدعم الخاصة بك: <strong>${escapeHtml(prev.subject || '')}</strong></p>
           <p>يسعدنا معرفة مدى رضاك عن الحل:</p>
           <div style="text-align:center;margin:20px 0"><a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">قيّم الحل</a></div>
         </div>` },
        tenantId: req.tenantId, dedupeKey: `ticket-csat:${req.tenantId}:${req.params.id}`, refType: 'support_ticket', refId: req.params.id,
      }, conn);
    }
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, status, closed_reason: closedReason || null });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    logger.error('[cs/status]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── CSAT — public rating page data + submission (unauthenticated, id-gated) ─
// RATE-02 precedent applies, but resolves the other way: NOT tenant-scoped,
// deliberately. The email link (see the csat_requested_at block above) is
// `https://mahadnafsy.com/ticket-rating?id=...` — one shared client URL for
// every tenant, not a per-tenant subdomain, and TicketRating.tsx calls this
// route same-origin with no X-Tenant-Id header. A visitor clicking it has no
// subdomain/header/JWT to resolve from, so req.tenantId falls through to
// DEFAULT_TENANT (tenantContext.js) regardless of which tenant the ticket
// actually belongs to. Filtering by req.tenantId here would 404 every CSAT
// link for a non-default tenant's ticket. Unlike the cert-verify route,
// there's no join-based tenant-consistency check to fall back on either —
// but none is needed: support_tickets.id is a UUID PRIMARY KEY (globally
// unique, not composite with tenant_id), so `WHERE id=?` already identifies
// at most one row with no risk of a cross-tenant match, and the id is not
// realistically guessable/enumerable.
router.get('/api/ticket-csat/:id', publicLimiter, async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(404).json({ error: 'Not found' });
    const [[t]] = await pool.query(
      `SELECT subject, csat_score
       FROM support_tickets
        WHERE id=? AND tenant_id IS NOT NULL AND csat_token_hash=?
          AND csat_token_expires_at>=NOW() AND deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, hashCsatToken(token)]
    );
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ subject: t.subject, rated: t.csat_score != null });
  } catch (e) { logger.error('[cs/csat]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/ticket-csat/:id', publicLimiter, async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(404).json({ error: 'Not found' });
    const { score, comment } = req.body || {};
    if (score === undefined || score === null) return res.status(400).json({ error: 'score required' });
    const numScore = Number(score);
    if (!Number.isInteger(numScore) || numScore < 1 || numScore > 5) {
      return res.status(400).json({ error: 'score must be an integer from 1 to 5' });
    }
    const [result] = await pool.query(
      `UPDATE support_tickets
       SET csat_score=?, csat_comment=?, csat_responded_at=NOW()
        WHERE id=? AND tenant_id IS NOT NULL AND csat_token_hash=?
          AND csat_token_expires_at>=NOW() AND csat_score IS NULL AND deleted_at IS NULL`,
      [numScore, comment ? String(comment).trim().slice(0, 2000) : null,
       req.params.id, hashCsatToken(token)]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Not found or already rated' });
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
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[ticket]] = await conn.query(
      'SELECT id,department,assigned_to FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]);
    if (!ticket) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    if (!canAccessTicket(req, ticket)) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const assignee = await pickAssignee(conn, req.tenantId, 'management');
    await conn.query(
      `UPDATE support_tickets SET department='management', priority='high',
               escalated_at=COALESCE(escalated_at, NOW()), assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=?`,
      [assignee?.id || null, req.params.id, req.tenantId]);
    const actor = await actorOf(req);
    const reason = cleanText(req.body.reason, TEXT_LIMITS.reason);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'escalated', actorId: actor.id, actorName: actor.name, to: assignee?.name || 'الإدارة', detail: reason || null });
    await conn.commit(); conn.release(); conn = null;
    createNotification('ticket', '⚠️ تذكرة مُصعّدة', `تم تصعيد تذكرة للإدارة${reason ? ': ' + reason : ''}`, { ticketId: req.params.id }, req.tenantId, assignee?.id || null).catch(() => {});
    res.json({ ok: true, assignee });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    logger.error('[cs/escalate]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ARCHIVE (admin-only; preserve replies and audit history) ─────────────────
router.delete('/api/admin/tickets/:id', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[ticket]] = await conn.query('SELECT id FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.tenantId]);
    if (!ticket) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const actor = await actorOf(req);
    await conn.query(
      'UPDATE support_tickets SET deleted_at=NOW(), deleted_by=?, updated_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [actor.id || req.user?.uid || null, req.params.id, req.tenantId]);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'archived', actorId: actor.id, actorName: actor.name });
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, archived: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[cs/delete]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CLIENT: submit + list own tickets (auto-routed) ──────────────────────────
router.post('/api/me/tickets', requireAuth, async (req, res) => {
  let conn;
  try {
    const subject = cleanText(req.body.subject, TEXT_LIMITS.subject);
    const body = cleanText(req.body.body, TEXT_LIMITS.body);
    const { category } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    const sub = await findSubscriberForIdentity(req.tenantId, req.user, conn, true);
    const email = sub?.email || req.user.email;
    const r = await createRoutedTicket(conn, {
      tenantId: req.tenantId, subscriberId: sub?.id, email, name: sub?.name || req.user.name,
      subject, body, category, channel: 'user_dashboard', actor: { id: null, name: sub?.name || email },
    });
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, id: r.id });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[me/tickets create]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/me/tickets', requireAuth, async (req, res) => {
  try {
    const subscriber = await findSubscriberForIdentity(req.tenantId, req.user);
    const email = normalizedEmail(subscriber?.email || req.user.email);
    const [rows] = await pool.query(
      `SELECT t.id, t.subject, t.status, t.category, t.priority, t.created_at,
              (SELECT COUNT(*) FROM ticket_replies tr WHERE tr.ticket_id=t.id AND tr.tenant_id=t.tenant_id) AS reply_count
         FROM support_tickets t
        WHERE t.tenant_id=? AND t.deleted_at IS NULL
          AND ((?<>'' AND t.subscriber_id=?) OR (?<>'' AND LOWER(TRIM(t.subscriber_email))=?))
        ORDER BY t.created_at DESC LIMIT 50`,
      [req.tenantId, subscriber?.id || '', subscriber?.id || '', email, email]);
    res.json(rows);
  } catch (e) { logger.error('[me/tickets list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: view own ticket + its conversation (ownership-checked by email).
router.get('/api/me/tickets/:id', requireAuth, async (req, res) => {
  try {
    const subscriber = await findSubscriberForIdentity(req.tenantId, req.user);
    const email = normalizedEmail(subscriber?.email || req.user.email);
    const [[t]] = await pool.query(
      'SELECT id,subscriber_id,subject,body,status,category,priority,created_at,subscriber_email FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.tenantId]);
    if (!ownsTicket(t, subscriber, email)) return res.status(404).json({ error: 'Not found' });
    const [replies] = await pool.query(
      'SELECT author_type, author_name, body, created_at FROM ticket_replies WHERE ticket_id=? AND tenant_id=? ORDER BY created_at ASC', [req.params.id, req.tenantId]);
    res.json({ id: t.id, subject: t.subject, body: t.body, status: t.status, category: t.category, priority: t.priority, created_at: t.created_at, replies });
  } catch (e) { logger.error('[me/ticket detail]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: reply to own ticket (re-opens it + notifies the assigned agent).
router.post('/api/me/tickets/:id/reply', requireAuth, async (req, res) => {
  let conn;
  try {
    const body = cleanText(req.body.body, TEXT_LIMITS.body);
    if (!body) return res.status(400).json({ error: 'body required' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    const subscriber = await findSubscriberForIdentity(req.tenantId, req.user, conn, true);
    const email = normalizedEmail(subscriber?.email || req.user.email);
    const [[t]] = await conn.query(
      'SELECT id,subscriber_id,subscriber_email,subscriber_name,subject,assigned_to FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]);
    if (!ownsTicket(t, subscriber, email)) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Not found' }); }
    const replyId = uuidv4();
    const authorName = t.subscriber_name || req.user.name || 'العميل';
    await conn.query('INSERT INTO ticket_replies (id, tenant_id, ticket_id, author_type, author_name, body) VALUES (?,?,?,?,?,?)',
      [replyId, req.tenantId, req.params.id, 'CLIENT', authorName, body]);
    await conn.query("UPDATE support_tickets SET status=IF(status IN ('resolved','closed'),'open',status), updated_at=NOW() WHERE id=? AND tenant_id=?", [req.params.id, req.tenantId]);
    await logTicketEvent(conn, { tenantId: req.tenantId, ticketId: req.params.id, type: 'replied', actorName: t.subscriber_name || 'العميل', detail: String(body).slice(0, 200) });
    await conn.commit(); conn.release(); conn = null;
    createNotification('ticket', 'رد جديد من العميل', `${t.subscriber_name || email}: ${t.subject}`, { ticketId: req.params.id }, req.tenantId, t.assigned_to || null).catch(() => {});
    res.json({
      ok: true,
      reply: { id: replyId, body, author_type: 'subscriber', author_name: authorName, created_at: new Date().toISOString() },
    });
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
        WHERE deleted_at IS NULL AND status IN ('open','in_progress') AND first_response_at IS NULL
          AND sla_due_at IS NOT NULL AND sla_due_at < NOW() AND escalated_at IS NULL
        ORDER BY sla_due_at ASC LIMIT 200`);
    for (const t of rows) {
      const breachMs = Date.now() - new Date(t.sla_due_at).getTime();
      const [[flag]] = await pool.query(
        "SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id=? AND tenant_id=? AND event_type='note' AND to_value='sla_breach'",
        [t.id, t.tenant_id]).catch(() => [[{ n: 1 }]]);
      if (!flag || !flag.n) {
        await logTicketEvent(pool, { tenantId: t.tenant_id, ticketId: t.id, type: 'note', to: 'sla_breach', detail: 'تجاوز زمن الاستجابة (SLA)' });
         createNotification('ticket', '⏰ تجاوز زمن الاستجابة', `تذكرة لم يُرد عليها ضمن المهلة: ${t.subject || ''}`, { ticketId: t.id }, t.tenant_id, t.assigned_to || null).catch(() => {});
      }
      if (breachMs > 6 * 3600 * 1000) { // >6h past due → auto-escalate to management
        const assignee = await pickAssignee(pool, t.tenant_id, 'management');
        await pool.query(
          "UPDATE support_tickets SET department='management', priority='high', escalated_at=NOW(), assigned_to=?, updated_at=NOW() WHERE id=? AND tenant_id=? AND escalated_at IS NULL",
          [assignee?.id || null, t.id, t.tenant_id]);
        await logTicketEvent(pool, { tenantId: t.tenant_id, ticketId: t.id, type: 'escalated', actorName: 'النظام', to: assignee?.name || 'الإدارة', detail: 'تصعيد تلقائي (تجاوز SLA)' });
        // Alert the manager it was escalated to (in-app + WhatsApp if we have a phone).
         createNotification('ticket', '⚠️ تصعيد تلقائي (SLA)', `تذكرة تجاوزت المهلة وصُعّدت للإدارة: ${t.subject || ''}`, { ticketId: t.id, department: 'management' }, t.tenant_id, assignee?.id || null).catch(() => {});
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
