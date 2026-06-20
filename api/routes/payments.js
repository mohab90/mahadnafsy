'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { safeDateOnly } = require('../lib/dates');

router.post('/api/admin/migrate-branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const VALID = ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'];
    const normBranch = (v) => v ? String(v).toUpperCase().replace(/[-\s]/g, '_') : null;

    // 1. Get leads with NULL/empty branch but crm_data has a branch value
    const [rows] = await pool.query(
      `SELECT id, crm_data FROM leads WHERE (branch IS NULL OR branch = '') AND crm_data IS NOT NULL`
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
        `UPDATE leads SET branch = CASE id ${caseWhen} END WHERE id IN (${fix1Ids.map(() => '?').join(',')})`,
        [...caseParams, ...fix1Ids]
      );
    }

    // 2. Also fix leads where branch column has lowercase/hyphen value stored as '' by checking crm_data
    // Additionally fix crm_data.branch to match the column
    const [all] = await pool.query(`SELECT id, branch, crm_data FROM leads WHERE branch IS NOT NULL AND branch != ''`);
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
        `UPDATE leads SET branch = CASE id ${caseWhen} END WHERE id IN (${fix2Ids.map(() => '?').join(',')})`,
        [...caseParams, ...fix2Ids]
      );
    }

    res.json({ ok: true, fixedFromCrmData: fixed, normalizedColumn: crmFixed, total: rows.length });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/payments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { startDate, endDate, channel, paymentType } = req.query;
    // Non-super-admin staff who are not managers/accountants can only see their own payments
    const managerRoles = new Set(['MANAGER','ADMIN','ACCOUNTANT','DAQQI_MANAGER']);
    const isManagerRole = req.staffRecord && managerRoles.has((req.staffRecord.role || '').toUpperCase());
    let sql = `SELECT p.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.client_code AS subscriber_client_code
               FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id WHERE 1`;
    const params = [];
    if (startDate)   { sql += ' AND p.date >= ?';           params.push(startDate); }
    if (endDate)     { sql += ' AND p.date <= ?';           params.push(endDate); }
    if (channel)     { sql += ' AND p.payment_method = ?';  params.push(channel); }
    if (paymentType) { sql += ' AND p.payment_type = ?';    params.push(String(paymentType).toUpperCase()); }
    const { branch: branchFilter } = req.query;
    if (branchFilter) { sql += ' AND p.branch = ?'; params.push(String(branchFilter).toUpperCase()); }
    if (req.staffRecord && !req.isSuperAdmin && !isManagerRole) {
      // Show payments where this staff is recorded as the seller (staff_id match),
      // OR where the subscriber is assigned to this staff — covers the 76% of payments
      // that were entered without staff_id but belong to assigned clients.
      sql += ' AND (p.staff_id = ? OR p.subscriber_id IN (SELECT id FROM subscribers WHERE assigned_sales_id = ? OR assigned_cs_id = ?))';
      params.push(req.staffRecord.id, req.staffRecord.id, req.staffRecord.id);
    }
    sql += ' ORDER BY p.date DESC LIMIT 2000';
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
        branch: p.branch || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/payments/review — Central payment review: all payments with full details
// Supports: status=pending|paid|failed|all, paymentType, staffId, source, dateFrom, dateTo, search, page
router.get('/api/admin/payments/review', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { status, paymentType, staffId, source, branch, dateFrom, dateTo, search, page = 1, limit: qLimit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(200, parseInt(qLimit) || 100);
    const offset = (pageNum - 1) * pageSize;

    let where = '1=1';
    const params = [];

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
    if (branch && branch !== 'all') {
      const branchId = String(branch).trim().toUpperCase().replace(/[-\s]/g, '_');
      if (branchId === 'DAQQI') {
        where += ` AND p.branch IN ('DAQQI','DQI')`;
      } else {
        where += ` AND p.branch = ?`;
        params.push(branchId);
      }
    }
    if (dateFrom) {
      where += ` AND p.date >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND p.date <= ?`;
      params.push(dateTo);
    }
    if (search) {
      where += ` AND (s.name LIKE ? OR s.phone LIKE ? OR p.transaction_id LIKE ? OR p.item_title LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    // Restrict non-admin staff to their own payments
    // EXCEPTION: manager/accountant roles see ALL payments regardless of who entered them
    const managerRoles = new Set(['MANAGER','ADMIN','ACCOUNTANT','DAQQI_MANAGER','RECEPTION_DAQQI']);
    const isManagerRole = req.staffRecord && managerRoles.has((req.staffRecord.role || '').toUpperCase());
    if (req.staffRecord && !req.isSuperAdmin && !isManagerRole) {
      // Show: payments directly attributed to this staff, OR payments for their assigned subscribers
      // Do NOT include random NULL-staff_id payments that belong to other staff's clients
      where += ` AND (p.staff_id = ? OR p.subscriber_id IN
        (SELECT id FROM subscribers WHERE assigned_sales_id = ? OR assigned_cs_id = ?))`;
      params.push(req.staffRecord.id, req.staffRecord.id, req.staffRecord.id);
    }

    const countParams = [...params];
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id WHERE ${where}`,
      countParams
    );

    const dataParams = [...params, pageSize, offset];
    const [rows] = await pool.query(
      `SELECT p.*,
              s.name AS subscriber_name, s.phone AS subscriber_phone,
              s.client_code AS subscriber_client_code, s.email AS subscriber_email,
              c.title_ar AS course_title_ar, c.title AS course_title
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id
       LEFT JOIN courses c ON c.id = p.course_id
       WHERE ${where}
       ORDER BY p.date DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      dataParams
    );

    // Also get paymob/online orders (from orders table) for unified view
    // Only when not filtering by staffId (those are online/automatic)
    let onlineOrders = [];
    if ((!staffId || source === 'paymob') && (!branch || branch === 'all')) {
      let oWhere = `status = 'paid'`;
      // Dedupe: a successful paymob order is ALSO written into `payments`
      // (id = 'paymob-' + order.id, same transaction_id). Without this guard the
      // same online sale appears twice in the unified list (once as a payment,
      // once as an order) and inflates any client-side total. Only surface orders
      // that have NO twin payment row (e.g. legacy orders predating the sync).
      oWhere += ` AND NOT EXISTS (
        SELECT 1 FROM payments pp
        WHERE pp.id = CONCAT('paymob-', orders.id)
           OR (orders.transaction_id IS NOT NULL AND orders.transaction_id <> ''
               AND pp.transaction_id = orders.transaction_id)
      )`;
      const oParams = [];
      if (dateFrom) { oWhere += ` AND DATE(created_at) >= ?`; oParams.push(dateFrom); }
      if (dateTo)   { oWhere += ` AND DATE(created_at) <= ?`; oParams.push(dateTo); }
      if (search)   { oWhere += ` AND (customer_name LIKE ? OR customer_email LIKE ?)`; oParams.push(`%${search}%`, `%${search}%`); }
      if (paymentType && paymentType !== 'all') {
        oWhere += ` AND type = ?`; oParams.push(paymentType.toLowerCase());
      }
      // Only include online orders on page 1 when no status/source filter that excludes them
      const includeOnline = (!status || status === 'all' || status === 'paid') && (!source || source === 'all' || source === 'paymob');
      if (includeOnline && pageNum === 1) {
        try {
          const [oRows] = await pool.query(
            `SELECT id, customer_name, customer_email, customer_phone, amount, currency, type AS payment_type,
                    item_title, transaction_id, payment_method, created_at AS date, 'paid' AS status, 'paymob' AS source
             FROM orders WHERE ${oWhere} ORDER BY created_at DESC LIMIT 200`,
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
        } catch (_) {}
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
        courseTitleAr: p.course_title_ar || null, courseTitle: p.course_title || null,
      };
    });

    // Summary by type (for accounting breakdown)
    const [typeSummary] = await pool.query(
      `SELECT p.payment_type,
              SUM(CASE WHEN (p.status='paid' OR p.status IS NULL) AND p.currency='EGP' THEN p.amount ELSE 0 END) AS total_egp,
              COUNT(*) AS count,
              SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END) AS pending_count
       FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id
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
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
