'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { addDaysToDateOnly, isValidDateOnly, safeDateOnly } = require('../lib/dates');
const { BRANCHES, normalizeBranch } = require('../constants/branches');
const { resolveFinancialScope } = require('../lib/financialScope');

router.post('/api/admin/migrate-branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const VALID = BRANCHES;
    const normBranch = normalizeBranch;

    // 1. Get leads with NULL/empty branch but crm_data has a branch value
    const [rows] = await pool.query(
      `SELECT id, crm_data FROM leads WHERE tenant_id = ? AND (branch IS NULL OR branch = '') AND crm_data IS NOT NULL`,
      [req.tenantId]
    );

    let fixed = 0;
    const fix1Ids = [], fix1Vals = [];
    for (const row of rows) {
      let crmData = {};
      try { crmData = typeof row.crm_data === 'string' ? JSON.parse(row.crm_data) : (row.crm_data || {}); } catch {}
      const rawBranch = crmData.branch || null;
      const norm = normBranch(rawBranch);
      if (norm && VALID.includes(norm)) {
        fix1Ids.push(row.id);
        fix1Vals.push(norm);
        fixed++;
      }
    }
    if (fix1Ids.length > 0) {
      const caseWhen = fix1Ids.map(() => 'WHEN ? THEN ?').join(' ');
      const caseParams = fix1Ids.flatMap((rowId, i) => [rowId, fix1Vals[i]]);
      await pool.query(
        `UPDATE leads SET branch = CASE id ${caseWhen} END WHERE id IN (${fix1Ids.map(() => '?').join(',')}) AND tenant_id = ?`,
        [...caseParams, ...fix1Ids, req.tenantId]
      );
    }

    // 2. Also fix leads where branch column has lowercase/hyphen value stored as '' by checking crm_data
    // Additionally fix crm_data.branch to match the column
    const [all] = await pool.query(`SELECT id, branch, crm_data FROM leads WHERE tenant_id = ? AND branch IS NOT NULL AND branch != ''`, [req.tenantId]);
    let crmFixed = 0;
    const fix2Ids = [], fix2Vals = [];
    for (const row of all) {
      let crmData = {};
      try { crmData = typeof row.crm_data === 'string' ? JSON.parse(row.crm_data) : (row.crm_data || {}); } catch {}
      const normCol = normBranch(row.branch);
      if (normCol !== row.branch && VALID.includes(normCol)) {
        fix2Ids.push(row.id);
        fix2Vals.push(normCol);
        crmFixed++;
      }
    }
    if (fix2Ids.length > 0) {
      const caseWhen = fix2Ids.map(() => 'WHEN ? THEN ?').join(' ');
      const caseParams = fix2Ids.flatMap((rowId, i) => [rowId, fix2Vals[i]]);
      await pool.query(
        `UPDATE leads SET branch = CASE id ${caseWhen} END WHERE id IN (${fix2Ids.map(() => '?').join(',')}) AND tenant_id = ?`,
        [...caseParams, ...fix2Ids, req.tenantId]
      );
    }

    res.json({ ok: true, fixedFromCrmData: fixed, normalizedColumn: crmFixed, total: rows.length });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/payments', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const { startDate, endDate, channel, paymentType } = req.query;
    const limit = Math.min(5000, Math.max(1, Number.parseInt(req.query.limit, 10) || 2000));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    // Non-super-admin staff who are not managers/accountants can only see their own payments
    const requestedBranch = req.query.branch && req.query.branch !== 'all' ? req.query.branch : null;
    const scope = resolveFinancialScope(req, { requestedBranch, allowAssigned: true });
    let sql = `SELECT p.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.client_code AS subscriber_client_code
               FROM payments p
               LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
               WHERE p.tenant_id = ? AND p.deleted_at IS NULL`;
    const params = [req.tenantId];
    if (startDate)   { sql += ' AND p.date >= ?';           params.push(startDate); }
    if (endDate)     { sql += ' AND p.date <= ?';           params.push(endDate); }
    if (channel)     { sql += ' AND p.payment_method = ?';  params.push(channel); }
    if (paymentType) { sql += ' AND p.payment_type = ?';    params.push(String(paymentType).toUpperCase()); }
    if (scope.branchId) {
      sql += ' AND p.branch_id = ?';
      params.push(scope.branchId);
    } else if (scope.kind === 'assigned_cs' || scope.kind === 'assigned_sales') {
      const assignmentColumn = scope.kind === 'assigned_cs' ? 'assigned_cs_id' : 'assigned_sales_id';
      // Show payments where this staff is recorded as the seller (staff_id match),
      // OR where the subscriber is assigned to this staff — covers the 76% of payments
      // that were entered without staff_id but belong to assigned clients.
      sql += ` AND (p.staff_id = ? OR p.subscriber_id IN (
        SELECT id FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND ${assignmentColumn} = ?
      ))`;
      params.push(scope.staffId, req.tenantId, scope.staffId);
    }
    sql += ' ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(p => {
      const dateStr = safeDateOnly(p.date);
      return {
        id: p.id,
        subscriberId: p.subscriber_id,
        subscriberName: p.subscriber_name || '',
        subscriberPhone: p.subscriber_phone || '',
        subscriberClientCode: p.subscriber_client_code || null,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        amount: Number(p.amount) || 0,
        amountEgp: Number(p.amount_egp) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        certId: p.certificate_request_id || null,
        branch: p.branch || null,
      };
    }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/payments/review — Central payment review: all payments with full details
// Supports: status=pending|paid|failed|all, paymentType, staffId, source, dateFrom, dateTo, search, page
router.get('/api/admin/payments/review', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const { status, paymentType, staffId, source, branch, dateFrom, dateTo, search, page = 1, limit: qLimit = 100 } = req.query;
    if ((dateFrom && !isValidDateOnly(dateFrom)) || (dateTo && !isValidDateOnly(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    if (status && !['all', 'pending', 'paid', 'failed', 'refunded'].includes(String(status))) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    if (String(search || '').length > 120) return res.status(400).json({ error: 'Search is too long' });
    const requestedBranch = branch && branch !== 'all' ? branch : null;
    const scope = resolveFinancialScope(req, { requestedBranch, allowAssigned: true });
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(qLimit) || 100));
    const offset = (pageNum - 1) * pageSize;

    let where = 'p.tenant_id = ? AND p.deleted_at IS NULL';
    const params = [req.tenantId];

    if (status && status !== 'all') {
      if (status === 'paid') {
        where += ` AND (p.status = 'paid' OR p.status IS NULL)`;
      } else {
        where += ` AND p.status = ?`;
        params.push(status);
      }
    }
    if (paymentType && paymentType !== 'all') {
      where += ` AND p.payment_type = ?`;
      params.push(paymentType.toUpperCase());
    }
    if (staffId) {
      where += ` AND p.staff_id = ?`;
      params.push(staffId);
    }
    if (source && source !== 'all') {
      where += ` AND p.source = ?`;
      params.push(source);
    }
    if (scope.branchId) {
      where += ' AND p.branch_id = ?';
      params.push(scope.branchId);
    }
    if (dateFrom) {
      where += ` AND p.date >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND p.date < ?`;
      params.push(addDaysToDateOnly(dateTo, 1));
    }
    if (search) {
      // Left as a contains-scan on purpose. Unlike a client code (^C\d+$) or a
      // complete email, there is no pattern here that reliably marks an
      // identifier: a 6+ character alphanumeric string is just as likely to be a
      // partial phone number or part of a name, so routing it to an exact match
      // would silently return nothing for a perfectly reasonable search.
      where += ` AND (s.name LIKE ? OR s.phone LIKE ? OR p.transaction_id LIKE ? OR p.item_title LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    // Restrict non-admin staff to their own payments
    // EXCEPTION: manager/accountant roles see ALL payments regardless of who entered them
    if (scope.kind === 'assigned_cs' || scope.kind === 'assigned_sales') {
      const assignmentColumn = scope.kind === 'assigned_cs' ? 'assigned_cs_id' : 'assigned_sales_id';
      // Show: payments directly attributed to this staff, OR payments for their assigned subscribers
      // Do NOT include random NULL-staff_id payments that belong to other staff's clients
      where += ` AND (p.staff_id = ? OR p.subscriber_id IN
        (SELECT id FROM subscribers
         WHERE tenant_id=? AND deleted_at IS NULL AND ${assignmentColumn} = ?))`;
      params.push(scope.staffId, req.tenantId, scope.staffId);
    }

    const countParams = [...params];
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
       WHERE ${where}`,
      countParams
    );

    // Cursor (keyset) pagination — opt-in via ?cursor=, else offset. Perf #14.
    let pagWhere = where, pagParams = [...params, pageSize, offset], pagTail = 'LIMIT ? OFFSET ?', nextCursorFn = null;
    if (req.query.cursor) {
      const { keyset } = require('../lib/pagination');
      const ks = keyset(req.query, { col: 'p.date', idCol: 'p.id', limit: pageSize, maxLimit: 200 });
      pagWhere = `${where} AND ${ks.where}`;
      pagParams = [...params, ...ks.params, ks.limit];
      pagTail = 'LIMIT ?';
      nextCursorFn = ks.nextCursor;
    }
    const dataParams = pagParams;
    const [rows] = await pool.query(
      `SELECT p.*,
              s.name AS subscriber_name, s.phone AS subscriber_phone,
              s.client_code AS subscriber_client_code, s.email AS subscriber_email,
              c.title_ar AS course_title_ar, c.title AS course_title
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
       LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id=p.tenant_id
       WHERE ${pagWhere}
       ORDER BY p.date DESC, p.id DESC
       ${pagTail}`,
      dataParams
    );
    if (nextCursorFn) { const nc = nextCursorFn(rows); if (nc) res.set('X-Next-Cursor', nc); }

    // Also get paymob/online orders (from orders table) for unified view
    // Only when not filtering by staffId (those are online/automatic)
    let onlineOrders = [];
    if (scope.kind === 'all' && !scope.branchId && (!staffId || source === 'paymob')) {
      let oFilters = '';
      const oParams = [req.tenantId];
      // Dedupe: a successful paymob order is ALSO written into `payments`
      // (id = 'paymob-' + order.id, same transaction_id). Without this guard the
      // same online sale appears twice in the unified list (once as a payment,
      // once as an order) and inflates any client-side total. Only surface orders
      // that have NO twin payment row (e.g. legacy orders predating the sync).
      oFilters += ` AND NOT EXISTS (
        SELECT 1 FROM payments pp
        WHERE pp.tenant_id=orders.tenant_id AND pp.deleted_at IS NULL
          AND (pp.id = CONCAT('paymob-', orders.id)
           OR (orders.transaction_id IS NOT NULL AND orders.transaction_id <> ''
               AND pp.transaction_id = orders.transaction_id))
      )`;
      if (dateFrom) { oFilters += ` AND created_at >= ?`; oParams.push(dateFrom); }
      if (dateTo)   { oFilters += ` AND created_at < ?`; oParams.push(addDaysToDateOnly(dateTo, 1)); }
      if (search)   { oFilters += ` AND (customer_name LIKE ? OR customer_email LIKE ?)`; oParams.push(`%${search}%`, `%${search}%`); }
      if (paymentType && paymentType !== 'all') {
        oFilters += ` AND type = ?`; oParams.push(paymentType.toLowerCase());
      }
      // Only include online orders on page 1 when no status/source filter that excludes them
      const includeOnline = (!status || status === 'all' || status === 'paid') && (!source || source === 'all' || source === 'paymob');
      if (includeOnline && pageNum === 1) {
        const [oRows] = await pool.query(
             `SELECT id, customer_name, customer_email, customer_phone, amount, currency, type AS payment_type,
                     item_title, transaction_id, payment_method, created_at AS date, 'paid' AS status, 'paymob' AS source
              FROM orders WHERE tenant_id=? AND status='paid' ${oFilters}
              ORDER BY created_at DESC LIMIT 200`,
            oParams
        );
        onlineOrders = oRows.map(o => ({
            id: o.id, subscriberId: null, subscriberName: o.customer_name || '',
            subscriberPhone: o.customer_phone || '', subscriberEmail: o.customer_email || '',
            subscriberClientCode: null, courseId: null, bundleId: null,
            amount: Number(o.amount) || 0, currency: o.currency || 'EGP',
            paymentType: (o.payment_type || 'course').toLowerCase(),
            paymentMethod: o.payment_method || 'paymob',
            transactionId: o.transaction_id || null, isInstallment: false,
            note: null, at: safeDateOnly(o.date),
            status: 'paid', staffId: null, staffName: 'موقع (أونلاين)', fromAccountNumber: null,
            source: 'paymob', itemTitle: o.item_title || null, certType: null,
            courseTitleAr: null, courseTitle: null,
        }));
      }
    }

    const mappedRows = rows.map(p => {
      const dateStr = safeDateOnly(p.date);
      return {
        id: p.id, subscriberId: p.subscriber_id,
        subscriberName: p.subscriber_name || '', subscriberPhone: p.subscriber_phone || '',
        subscriberEmail: p.subscriber_email || '', subscriberClientCode: p.subscriber_client_code || null,
        courseId: p.course_id || null, bundleId: p.bundle_id || null,
        amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        note: p.note || null, at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null, staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null, certType: p.cert_type || null,
        certId: p.certificate_request_id || null,
        courseTitleAr: p.course_title_ar || null, courseTitle: p.course_title || null,
      };
    });

    // Summary by type (for accounting breakdown)
    const [typeSummary] = await pool.query(
      `SELECT p.payment_type,
              SUM(CASE WHEN (p.status='paid' OR p.status IS NULL) AND p.currency='EGP' THEN p.amount ELSE 0 END) AS total_egp,
              COUNT(*) AS count,
              SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END) AS pending_count
       FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
       WHERE ${where}
       GROUP BY p.payment_type`,
      countParams
    );

    res.json({
      total: Number(total),
      page: pageNum,
      pageSize,
      rows: [...mappedRows, ...onlineOrders],
      typeSummary: typeSummary.map(t => ({
        paymentType: (t.payment_type || 'other').toLowerCase(),
        totalEGP: Number(t.total_egp) || 0,
        count: Number(t.count) || 0,
        pendingCount: Number(t.pending_count) || 0,
      })),
    });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

module.exports = router;
