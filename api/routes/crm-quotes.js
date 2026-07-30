'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ module: 'crm-quotes-route' });
const { leadScope } = require('../lib/leadAccess');
const { logLeadEventStrict } = require('../lib/crm');
const { getTenantSetting } = require('../lib/tenantSettings');
const outbox = require('../lib/outbox');
const {
  money,
  quoteNumber,
  validateQuoteInput,
  loadCatalogSnapshots,
  calculateQuote,
  resolveDiscountApproval,
} = require('../lib/crmQuotes');
const {
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
} = require('../middleware/auth');

const router = express.Router();
const view = [requireAuth, requireAdminOrStaff, requirePermission('view_leads')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_leads')];
const actor = req => String(req.staffRecord?.id || req.user?.email || req.user?.uid || 'system');
const fail = (res, error, label) => {
  logger.error(label, error);
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
};
const exactDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

async function quotePolicy(tenantId) {
  const value = await getTenantSetting('crm_quote_policy', {
    tenantId,
    fallback: { discount_bands: null, default_valid_days: 14 },
  });
  return {
    discountBands: value?.discount_bands,
    defaultValidDays: Math.min(Math.max(Number(value?.default_valid_days) || 14, 1), 90),
  };
}

router.get('/api/admin/crm/quotes', ...view, async (req, res) => {
  try {
    const scope = leadScope(req, 'l');
    if (scope.none) return res.json([]);
    const params = [req.tenantId, ...scope.params];
    let filters = '';
    if (req.query.status) {
      filters += ' AND q.status=?';
      params.push(String(req.query.status));
    }
    if (req.query.lead_id) {
      filters += ' AND q.lead_id=?';
      params.push(String(req.query.lead_id));
    }
    const [rows] = await pool.query(
      `SELECT q.*,l.name AS lead_name,l.email AS lead_email,l.phone AS lead_phone,
              COUNT(qi.id) AS item_count,
              GROUP_CONCAT(qo.order_id ORDER BY qo.created_at SEPARATOR ',') AS order_ids
         FROM crm_quotes q
         JOIN leads l ON l.id=q.lead_id AND l.tenant_id=q.tenant_id
         LEFT JOIN crm_quote_items qi ON qi.quote_id=q.id AND qi.tenant_id=q.tenant_id
         LEFT JOIN crm_quote_orders qo ON qo.quote_id=q.id AND qo.tenant_id=q.tenant_id
        WHERE q.tenant_id=?${scope.sql}${filters}
        GROUP BY q.id
        ORDER BY q.created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'CRM quote list failed');
  }
});

router.get('/api/admin/crm/quotes/:id', ...view, async (req, res) => {
  try {
    const scope = leadScope(req, 'l');
    const [[quote]] = await pool.query(
      `SELECT q.*,l.name AS lead_name,l.email AS lead_email,l.phone AS lead_phone
         FROM crm_quotes q
         JOIN leads l ON l.id=q.lead_id AND l.tenant_id=q.tenant_id
        WHERE q.id=? AND q.tenant_id=?${scope.sql} LIMIT 1`,
      [req.params.id, req.tenantId, ...scope.params]
    );
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const [items] = await pool.query(
      `SELECT * FROM crm_quote_items WHERE quote_id=? AND tenant_id=? ORDER BY sort_order`,
      [quote.id, req.tenantId]
    );
    const [approvals] = await pool.query(
      `SELECT * FROM crm_quote_approvals WHERE quote_id=? AND tenant_id=? ORDER BY created_at`,
      [quote.id, req.tenantId]
    );
    res.json({ ...quote, items, approvals });
  } catch (error) {
    fail(res, error, 'CRM quote detail failed');
  }
});

router.post('/api/admin/crm/quotes', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const validated = validateQuoteInput(req.body);
    const scope = leadScope(req, 'l');
    await conn.beginTransaction();
    const [[lead]] = await conn.query(
      `SELECT l.id,l.subscriber_id FROM leads l
        WHERE l.id=? AND l.tenant_id=? AND l.hidden=0${scope.sql} LIMIT 1 FOR UPDATE`,
      [req.body?.lead_id, req.tenantId, ...scope.params]
    );
    if (!lead) {
      await conn.rollback();
      return res.status(404).json({ error: 'Lead not found' });
    }
    const subscriberId = req.body?.subscriber_id || lead.subscriber_id || null;
    if (subscriberId) {
      const [[subscriber]] = await conn.query(
        'SELECT id FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [subscriberId, req.tenantId]
      );
      if (!subscriber) {
        await conn.rollback();
        return res.status(400).json({ error: 'Subscriber does not belong to this tenant' });
      }
    }
    const snapshots = await loadCatalogSnapshots(conn, req.tenantId, validated);
    const priced = calculateQuote(validated, snapshots);
    const policy = await quotePolicy(req.tenantId);
    const approval = resolveDiscountApproval(priced.discountPercent, policy.discountBands);
    const validUntil = exactDate(req.body?.valid_until)
      || new Date(Date.now() + policy.defaultValidDays * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const latestValidity = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    if (validUntil < today || validUntil > latestValidity) {
      throw Object.assign(new Error('Quote validity must be between today and one year'), { statusCode: 400 });
    }
    const id = crypto.randomUUID();
    const number = quoteNumber();
    await conn.query(
      `INSERT INTO crm_quotes
         (id,tenant_id,quote_number,lead_id,subscriber_id,currency,status,valid_until,
          subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,
          approval_required,approval_level,approval_policy_snapshot,notes,terms,created_by,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, number, lead.id, subscriberId,
        priced.currency, approval.required ? 'pending_approval' : 'draft', validUntil,
        priced.subtotal, priced.discountPercent, priced.discountAmount, priced.taxPercent,
        priced.taxAmount, priced.total, approval.required ? 1 : 0,
        approval.level, JSON.stringify(approval),
        String(req.body?.notes || '').trim() || null,
        String(req.body?.terms || '').trim() || null,
        actor(req), actor(req),
      ]
    );
    for (const item of priced.items) {
      await conn.query(
        `INSERT INTO crm_quote_items
           (id,tenant_id,quote_id,item_type,item_id,description,quantity,unit_price,
            line_subtotal,catalog_snapshot,sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          crypto.randomUUID(), req.tenantId, id, item.itemType, item.itemId, item.title,
          item.quantity, item.unitPrice, item.lineSubtotal, JSON.stringify(item), item.sortOrder,
        ]
      );
    }
    if (approval.required) {
      await conn.query(
        `INSERT INTO crm_quote_approvals (id,tenant_id,quote_id,decision,actor_id,note)
         VALUES (?,?,?,'requested',?,?)`,
        [crypto.randomUUID(), req.tenantId, id, actor(req), `Discount ${priced.discountPercent}%`]
      );
    }
    await logLeadEventStrict(
      lead.id, 'quote_created', `تم إنشاء عرض السعر ${number}`,
      { quoteId: id, quoteNumber: number, total: priced.total, currency: priced.currency, approvalRequired: approval.required, approvalLevel: approval.level },
      req.tenantId, conn
    );
    await conn.commit();
    res.status(201).json({ ok: true, id, quote_number: number, status: approval.required ? 'pending_approval' : 'draft', approval, ...priced });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM quote creation failed');
  } finally {
    conn.release();
  }
});

router.post('/api/admin/crm/quotes/:id/actions', ...manage, async (req, res) => {
  const action = String(req.body?.action || '').toLowerCase();
  if (!['approve', 'reject', 'send', 'accept', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'Unsupported quote action' });
  }
  const conn = await pool.getConnection();
  try {
    const scope = leadScope(req, 'l');
    if (scope.none) return res.status(404).json({ error: 'Quote not found' });
    await conn.beginTransaction();
    const [[quote]] = await conn.query(
      `SELECT q.*,l.name AS lead_name,l.email AS lead_email
         FROM crm_quotes q
         JOIN leads l ON l.id=q.lead_id AND l.tenant_id=q.tenant_id
        WHERE q.id=? AND q.tenant_id=?${scope.sql} LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId, ...scope.params]
    );
    if (!quote) {
      await conn.rollback();
      return res.status(404).json({ error: 'Quote not found' });
    }
    const allowed = {
      approve: ['pending_approval'],
      reject: ['pending_approval'],
      send: ['draft', 'approved'],
      accept: ['sent', 'approved'],
      cancel: ['draft', 'pending_approval', 'approved', 'sent'],
    };
    if (!allowed[action].includes(quote.status)) {
      await conn.rollback();
      return res.status(409).json({ error: `Cannot ${action} quote from ${quote.status}` });
    }
    if (['approve', 'reject'].includes(action) && actor(req) === String(quote.created_by)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Quote approval requires a separate reviewer', code: 'QUOTE_APPROVAL_SOD' });
    }
    if (action === 'approve') {
      let approvalSnapshot = {};
      try {
        approvalSnapshot = typeof quote.approval_policy_snapshot === 'string'
          ? JSON.parse(quote.approval_policy_snapshot)
          : (quote.approval_policy_snapshot || {});
      } catch {}
      const allowedRoles = Array.isArray(approvalSnapshot.roles) ? approvalSnapshot.roles : [];
      const reviewerRole = String(req.staffRecord?.role || (req.isSuperAdmin ? 'admin' : '')).toLowerCase();
      if (allowedRoles.length && !allowedRoles.includes(reviewerRole)) {
        await conn.rollback();
        return res.status(403).json({
          error: `Quote requires ${quote.approval_level} approval`,
          code: 'QUOTE_APPROVAL_LEVEL_REQUIRED',
        });
      }
    }
    const nextStatus = { approve: 'approved', reject: 'rejected', send: 'sent', accept: 'accepted', cancel: 'cancelled' }[action];
    const timestamp = { approve: 'approved_at', reject: 'rejected_at', send: 'sent_at', accept: 'accepted_at' }[action];
    await conn.query(
      `UPDATE crm_quotes
          SET status=?,updated_by=?${timestamp ? `,${timestamp}=NOW()` : ''}${action === 'approve' ? ',approved_by=?' : ''}
        WHERE id=? AND tenant_id=?`,
      action === 'approve'
        ? [nextStatus, actor(req), actor(req), quote.id, req.tenantId]
        : [nextStatus, actor(req), quote.id, req.tenantId]
    );
    if (['approve', 'reject'].includes(action)) {
      await conn.query(
        `INSERT INTO crm_quote_approvals (id,tenant_id,quote_id,decision,actor_id,note)
         VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), req.tenantId, quote.id, action === 'approve' ? 'approved' : 'rejected', actor(req), String(req.body?.note || '').slice(0, 1000) || null]
      );
    }
    if (action === 'send') {
      if (!quote.lead_email) {
        await conn.rollback();
        return res.status(400).json({ error: 'Lead email is required to send the quote' });
      }
      const [items] = await conn.query(
        'SELECT description,quantity,line_subtotal FROM crm_quote_items WHERE quote_id=? AND tenant_id=? ORDER BY sort_order',
        [quote.id, req.tenantId]
      );
      const lines = items.map(item =>
        `<li>${escapeHtml(item.description)} × ${escapeHtml(item.quantity)} — ${escapeHtml(item.line_subtotal)} ${escapeHtml(quote.currency)}</li>`).join('');
      await outbox.enqueue({
        channel: 'email',
        recipient: quote.lead_email,
        subject: `عرض السعر ${quote.quote_number}`,
        payload: {
          html: `<h2>مرحبًا ${escapeHtml(quote.lead_name)}</h2><p>تفاصيل عرض السعر ${escapeHtml(quote.quote_number)}</p><ul>${lines}</ul><p><strong>الإجمالي: ${escapeHtml(quote.total)} ${escapeHtml(quote.currency)}</strong></p><p>صالح حتى ${escapeHtml(quote.valid_until)}</p>`,
        },
        tenantId: req.tenantId,
        dedupeKey: `crm-quote:${req.tenantId}:${quote.id}:v1`,
        refType: 'crm_quote',
        refId: quote.id,
      }, conn);
    }
    await logLeadEventStrict(
      quote.lead_id, `quote_${action}`, `Quote ${quote.quote_number}: ${action}`,
      { quoteId: quote.id, quoteNumber: quote.quote_number, from: quote.status, to: nextStatus },
      req.tenantId, conn
    );
    await conn.commit();
    res.json({ ok: true, status: nextStatus });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM quote action failed');
  } finally {
    conn.release();
  }
});

router.post('/api/admin/crm/quotes/:id/convert', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const scope = leadScope(req, 'l');
    if (scope.none) return res.status(404).json({ error: 'Quote not found' });
    await conn.beginTransaction();
    const [[quote]] = await conn.query(
      `SELECT q.*,l.name,l.email,l.phone,l.branch_id,l.assigned_sales_id,l.assigned_sales_name
         FROM crm_quotes q JOIN leads l ON l.id=q.lead_id AND l.tenant_id=q.tenant_id
        WHERE q.id=? AND q.tenant_id=?${scope.sql} LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId, ...scope.params]
    );
    if (!quote) {
      await conn.rollback();
      return res.status(404).json({ error: 'Quote not found' });
    }
    if (quote.status !== 'accepted') {
      await conn.rollback();
      return res.status(409).json({ error: 'Only accepted quotes can be converted' });
    }
    const subscriberId = req.body?.subscriber_id || quote.subscriber_id;
    const [[subscriber]] = await conn.query(
      'SELECT id,name,email,phone,branch_id FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [subscriberId, req.tenantId]
    );
    if (!subscriber) {
      await conn.rollback();
      return res.status(400).json({ error: 'A tenant subscriber is required before quote conversion' });
    }
    const [items] = await conn.query(
      'SELECT * FROM crm_quote_items WHERE quote_id=? AND tenant_id=? ORDER BY sort_order FOR UPDATE',
      [quote.id, req.tenantId]
    );
    const orders = [];
    let allocated = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const amount = index === items.length - 1
        ? money(Number(quote.total) - allocated)
        : money(Number(quote.total) * Number(item.line_subtotal) / Number(quote.subtotal || 1));
      allocated = money(allocated + amount);
      const orderId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO orders
           (id,type,item_id,item_title,amount,currency,payment_method,customer_name,customer_email,
            customer_phone,status,subscriber_id,course_id,bundle_id,tenant_id,branch_id,notes,
            staff_id,staff_name)
         VALUES (?,?,?,?,?,?,'MANUAL',?,?,?,'PENDING',?,?,?,?,?,?,?,?)`,
        [
          orderId, item.item_type.toUpperCase(), item.item_id, item.description, amount, quote.currency,
          subscriber.name || quote.name, subscriber.email || quote.email, subscriber.phone || quote.phone,
          subscriber.id, item.item_type === 'course' ? item.item_id : null,
          item.item_type === 'bundle' ? item.item_id : null, req.tenantId,
          subscriber.branch_id || quote.branch_id || 'branch-other',
          `Created from CRM quote ${quote.quote_number}`, quote.assigned_sales_id || null,
          quote.assigned_sales_name || null,
        ]
      );
      await conn.query(
        'INSERT INTO crm_quote_orders (tenant_id,quote_id,quote_item_id,order_id) VALUES (?,?,?,?)',
        [req.tenantId, quote.id, item.id, orderId]
      );
      orders.push(orderId);
    }
    await conn.query(
      `UPDATE crm_quotes SET status='converted',converted_at=NOW(),subscriber_id=?,updated_by=?
        WHERE id=? AND tenant_id=?`,
      [subscriber.id, actor(req), quote.id, req.tenantId]
    );
    await logLeadEventStrict(
      quote.lead_id, 'quote_converted', `تم تحويل عرض السعر ${quote.quote_number} إلى طلبات معلقة`,
      { quoteId: quote.id, orderIds: orders, total: quote.total, currency: quote.currency },
      req.tenantId, conn
    );
    await conn.commit();
    res.status(201).json({ ok: true, status: 'converted', order_ids: orders });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'CRM quote conversion failed');
  } finally {
    conn.release();
  }
});

module.exports = router;
