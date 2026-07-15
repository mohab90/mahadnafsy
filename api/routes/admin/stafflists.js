'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, autoAssignStaff, cacheInvalidate } = require('../../lib/db');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { DATA_SCOPE, VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../../constants/permissions');
const { onlineMap } = require('../../lib/onlineUsers');
const { safeIsoString, safeDateOnly } = require('../../lib/dates');
const { keyset } = require('../../lib/pagination');

router.get('/api/admin/subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    // This was the admin dashboard's main subscriber-list load and had NO scoping at
    // all — every authenticated staff member (including reception_daqqi, who should
    // only ever see Dokki clients) got every branch's subscribers with full payment
    // history. /api/staff/subscribers already scopes correctly by DATA_SCOPE; apply
    // the same rule here since this is the endpoint the admin app actually calls.
    const role    = (req.staffRecord?.role || '').toLowerCase();
    const isSuper = !!req.isSuperAdmin;
    const scope   = isSuper ? 'all' : (DATA_SCOPE[role] || 'assigned_sales');
    if (scope === 'none') return res.json([]);

    const adminExclusions = ADMIN_EMAILS.length > 0
      ? `AND (s.email IS NULL OR LOWER(s.email) NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
      : '';
    let scopeClause = '1=1';
    const scopeParams = [];
    if (scope.startsWith('branch:')) {
      scopeClause = 's.branch = ?';
      scopeParams.push(scope.slice(7));
    } else if (scope === 'assigned_sales') {
      const staffId = req.staffRecord?.id;
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      scopeClause = `(s.assigned_sales_id = ? OR (s.assigned_sales_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedSalesId')) = ?) OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.assigned_sales_id = ?)))`;
      scopeParams.push(staffId, staffId, staffId);
    } else if (scope === 'assigned_cs') {
      const staffId = req.staffRecord?.id;
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      scopeClause = `(s.assigned_cs_id = ? OR (s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionId')) = ?))`;
      scopeParams.push(staffId, staffId);
    }
    // scope === 'all' falls through with scopeClause = '1=1' (no extra restriction)

    const [rows] = await pool.query(
      `SELECT s.*,
              COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
              COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id
       WHERE s.tenant_id = ? AND (${scopeClause}) AND NOT EXISTS (
         SELECT 1 FROM staff st WHERE LOWER(st.email) = LOWER(s.email) AND st.is_active = 1
       ) ${adminExclusions}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [req.tenantId, ...scopeParams, ...ADMIN_EMAILS.map(e => e.toLowerCase()), limit, offset]
    );
    if (rows.length === 0) return res.json([]);

    // Batch-load payments from the payments table (authoritative source, one query for all)
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title, cert_type
       FROM payments WHERE subscriber_id IN (${placeholders}) ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
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
      });
    });

    // Batch-load enrollments from the enrollments table (authoritative source)
    const [enrollRows] = await pool.query(
      `SELECT subscriber_id, course_id, bundle_id FROM enrollments WHERE subscriber_id IN (${placeholders})`,
      ids
    );
    const enrollBySub = {};
    enrollRows.forEach(e => {
      if (!enrollBySub[e.subscriber_id]) enrollBySub[e.subscriber_id] = [];
      const cid = e.course_id ? String(e.course_id) : (e.bundle_id ? `bundle:${e.bundle_id}` : null);
      if (cid) enrollBySub[e.subscriber_id].push(cid);
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      // client_code column is authoritative
      const clientCode = r.client_code || crm.clientCode || null;
      // payments table is authoritative; fall back to crm_json if no DB records found
      const paymentHistory = payBySubId[r.id] && payBySubId[r.id].length > 0
        ? payBySubId[r.id]
        : [];
      // enrollments table is authoritative; merge with crm_json for backwards compat
      const enrolledCourseIds = [...new Set([
        ...(enrollBySub[r.id] || []),
        ...(Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds.map(String) : []),
      ])];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at,
        ...crm,          // other CRM fields: courseAccess, installmentPlans, etc.
        enrolledCourseIds,  // merged from enrollments table + crm_json
        clientCode,      // authoritative
        paymentHistory,  // authoritative from payments table
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId: r.assigned_cs_id || crm.assignedCsId || null,
        assignedCsName: r.assigned_cs_name || crm.assignedCsName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/subscribers
// UNIFIED endpoint — server scopes data automatically based on role.
// All staff roles call this ONE endpoint. The server decides what they see.
// Scoping rules are defined in api/constants/permissions.js → DATA_SCOPE.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/staff/subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId  = req.staffRecord?.id;
    const role     = (req.staffRecord?.role || '').toLowerCase();
    const isSuper  = !!req.isSuperAdmin;
    const scope    = isSuper ? 'all' : (DATA_SCOPE[role] || 'assigned_sales');
    if (scope === 'none') return res.json([]);

    let whereClause = '1=1';
    const params    = [req.tenantId];

    if (scope === 'all') {
      // Full access — return everything (excluding staff/admin emails)
      const adminExclusions = ADMIN_EMAILS.length > 0
        ? ` AND (s.email IS NULL OR LOWER(s.email) NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
        : '';
      whereClause = `NOT EXISTS (
        SELECT 1 FROM staff st WHERE LOWER(st.email) = LOWER(s.email) AND st.is_active = 1
      )${adminExclusions}`;
      params.push(...ADMIN_EMAILS.map(e => e.toLowerCase()));
    } else if (scope === 'assigned_sales') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = `(s.assigned_sales_id = ? OR (s.assigned_sales_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedSalesId')) = ?) OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.assigned_sales_id = ?)))`;
      params.push(staffId, staffId, staffId);
    } else if (scope === 'assigned_cs') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = `(s.assigned_cs_id = ? OR (s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionId')) = ?))`;
      params.push(staffId, staffId);
    } else if (scope.startsWith('branch:')) {
      const branch = scope.slice(7); // e.g. 'DAQQI'
      whereClause = `s.branch = ?`;
      params.push(branch);
    }

    const limit  = parseLimit(req.query.limit, 5000, 10000);
    const offset = parseOffset(req.query.offset || 0);
    params.push(limit, offset);

    const [rows] = await pool.query(
      `SELECT s.*,
              COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
              COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id
       WHERE s.tenant_id = ? AND (${whereClause})
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments WHERE subscriber_id IN (${ids.map(() => '?').join(',')}) ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount)||0, currency: p.currency||'EGP',
        paymentType: (p.payment_type||'other').toLowerCase(), paymentMethod: p.payment_method||null,
        transactionId: p.transaction_id||null, isInstallment: !!p.is_installment,
        courseId: p.course_id||null, bundleId: p.bundle_id||null, note: p.note||null, at: dateStr,
        status: p.status||'paid', staffId: p.staff_id||null, staffName: p.staff_name||null,
        fromAccountNumber: p.from_account||null, source: p.source||null, itemTitle: p.item_title||null,
      });
    });

    // Batch-load enrollments from the enrollments table (authoritative source)
    const [staffEnrollRows] = await pool.query(
      `SELECT subscriber_id, course_id, bundle_id FROM enrollments WHERE subscriber_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const staffEnrollBySub = {};
    staffEnrollRows.forEach(e => {
      if (!staffEnrollBySub[e.subscriber_id]) staffEnrollBySub[e.subscriber_id] = [];
      const cid = e.course_id ? String(e.course_id) : (e.bundle_id ? `bundle:${e.bundle_id}` : null);
      if (cid) staffEnrollBySub[e.subscriber_id].push(cid);
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      const enrolledCourseIds = [...new Set([
        ...(staffEnrollBySub[r.id] || []),
        ...(Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds.map(String) : []),
      ])];
      const rb = r.branch || crm.branch || null;
      const nb = rb ? rb.toUpperCase().replace(/[-\s]/g,'_') : null;
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at,
        ...crm,
        enrolledCourseIds,
        clientCode: r.client_code || crm.clientCode || null,
        paymentHistory,
        branch: (nb && VALID_BRANCHES.has(nb)) ? nb : rb,
        clientType: r.client_type || null,
        assignedSalesId:   r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId:      r.assigned_cs_id || crm.assignedCsId || null,
        assignedCsName:    r.assigned_cs_name || crm.assignedCsName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[/api/staff/subscribers]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/leads
// UNIFIED endpoint — server scopes leads automatically based on role.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/staff/leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    const role    = (req.staffRecord?.role || '').toLowerCase();
    const isSuper = !!req.isSuperAdmin;
    const scope   = isSuper ? 'all' : (DATA_SCOPE[role] || 'assigned_sales');

    // Roles that should NOT see leads at all
    const noLeadsRoles = new Set(['collection', 'support', 'hr', 'accountant', 'trainer', 'instructor']);
    if (!isSuper && noLeadsRoles.has(role)) return res.json([]);
    if (scope === 'none') return res.json([]);

    let whereClause = 'hidden = 0';
    const params = [];

    if (scope === 'assigned_sales') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = 'hidden = 0 AND assigned_sales_id = ?';
      params.push(staffId);
    }
    // 'all' sees all leads; branch scopes see only their branch.
    else if (scope.startsWith('branch:')) {
      const branch = scope.slice(7);
      whereClause = 'hidden = 0 AND branch = ?';
      params.push(branch);
    }

    const limit  = parseLimit(req.query.limit, 5000, 20000);
    const offset = parseOffset(req.query.offset || 0);
    params.push(limit, offset);

    const [rows] = await pool.query(
      `SELECT * FROM leads WHERE tenant_id = ? AND (${whereClause}) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.tenantId, ...params]
    );
    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      return {
        ...crm,
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        status: r.status, source: r.source, notes: r.notes,
        leadType: r.lead_type || crm.leadType || 'course',
        enrolledCourseId: r.enrolled_course_id || crm.enrolledCourseId || '',
        interestLevel: r.interest_level || crm.interestLevel || 'medium',
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        interestedCourseIds: tryJson(r.interested_course_ids_json, crm.interestedCourseIds || []),
        createdAt: r.created_at, updatedAt: r.updated_at,
        communications: Array.isArray(crm.communications) ? crm.communications : [],
        nextFollowUpDate: r.next_follow_up_date || crm.nextFollowUpDate || null,
        paidAmount: r.paid_amount, clientCode: r.client_code,
        hidden: !!r.hidden, branch: r.branch, clientType: r.client_type || null,
      };
    }));
  } catch (e) { logger.error('[/api/staff/leads]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-subscribers — SALES staff fetch their own subscribers (assigned_sales_id = me)
router.get('/api/staff/my-subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });

    const [rows] = await pool.query(
      `SELECT DISTINCT s.* FROM subscribers s
       LEFT JOIN leads l ON l.id = s.lead_id
       WHERE s.tenant_id = ? AND (
             s.assigned_sales_id = ?
          OR (s.assigned_sales_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedSalesId')) = ?)
          OR (s.lead_id IS NOT NULL AND l.assigned_sales_id = ?))
       ORDER BY s.created_at DESC LIMIT 2000`,
      [req.tenantId, staffId, staffId, staffId]
    );
    if (rows.length === 0) return res.json([]);

    // Auto-backfill: fix any rows that came via crm_json fallback (missing assigned_sales_id column)
    const toBackfill = rows.filter(r => !r.assigned_sales_id);
    if (toBackfill.length > 0) {
      // Fire-and-forget background update — don't block the response
      Promise.all(toBackfill.map(r => {
        const crm = parseCrm(r.crm_json);
        const salesName = crm.assignedSalesName || null;
        const rawBranch = r.branch || crm.branch || null;

        const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
        const branchVal = (normB && VALID_BRANCHES.has(normB)) ? normB : null;
        return pool.query(
          'UPDATE subscribers SET assigned_sales_id=?, assigned_sales_name=COALESCE(assigned_sales_name,?), branch=COALESCE(branch,?) WHERE id=?',
          [staffId, salesName, branchVal, r.id]
        ).catch(() => {});
      })).catch(() => {});
    }

    const ids = rows.map(r => r.id);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments WHERE subscriber_id IN (${ids.map(() => '?').join(',')}) ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: p.staff_name || null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm,
        enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        clientCode, paymentHistory,
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        clientType: r.client_type || null,
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-collection-clients — collection staff fetch their own assigned subscribers
router.get('/api/staff/my-collection-clients', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });

    const [rows] = await pool.query(
      `SELECT DISTINCT s.* FROM subscribers s
       WHERE s.tenant_id = ? AND (
             s.assigned_cs_id = ?
          OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.assigned_cs_name = (SELECT name FROM staff WHERE id=? LIMIT 1))
          OR (s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionId')) = ?)
          OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionName')) = (SELECT name FROM staff WHERE id=? LIMIT 1)))
       ORDER BY s.created_at DESC LIMIT 5000`,
      [req.tenantId, staffId, staffId, staffId, staffId]
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    // Show ALL payments for assigned clients (not filtered by staff_id — client may have payments from multiple staff)
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE subscriber_id IN (${ids.map(() => '?').join(',')})
       ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: p.staff_name || null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm,
        enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        clientCode, paymentHistory,
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCollectionId: r.assigned_cs_id || crm.assignedCollectionId || null,
        assignedCollectionName: r.assigned_cs_name || crm.assignedCollectionName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-daqqi-clients — reception_daqqi staff fetch subscribers with branch=DAQQI
router.get('/api/staff/my-daqqi-clients', requireAuth, requireAdminOrStaff, async (req, res) => {
  // SECURITY: only RECEPTION_DAQQI staff (or super-admins) may access this endpoint
  if (!req.isSuperAdmin) {
    const allowedRoles = new Set(['RECEPTION_DAQQI', 'DAQQI_MANAGER', 'ADMIN', 'MANAGER']);
    const staffRole = (req.staffRecord?.role || '').toUpperCase();
    if (!allowedRoles.has(staffRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
  }
  try {
    const [rows] = await pool.query(
      `SELECT s.* FROM subscribers s
       WHERE s.branch = 'DAQQI'
       ORDER BY s.created_at DESC LIMIT 5000`
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE subscriber_id IN (${ids.map(() => '?').join(',')})
       ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null, staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null, source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm,
        enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        clientCode, paymentHistory,
        branch: 'DAQQI',
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId: r.assigned_cs_id || crm.assignedCollectionId || null,
        assignedCsName: r.assigned_cs_name || crm.assignedCollectionName || null,
        status: crm.status || (r.is_active ? 'active' : 'inactive'),
        installmentPlans: crm.installmentPlans || [],
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/subscribers/:id/assign-collection — assign a subscriber to a collection staff
router.put('/api/admin/subscribers/:id/assign-collection', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const subId = req.params.id;
    const { collectionId, collectionName } = req.body || {};
    if (!subId) return res.status(400).json({ error: 'Missing subscriber id' });
    await pool.query(
      'UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=? WHERE id=?',
      [collectionId || null, collectionName || null, subId]
    );
    // Also update crm_json to keep in sync
    const [[row]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subId]);
    if (row) {
      const crm = tryJson(row.crm_json, {});
      crm.assignedCollectionId   = collectionId   || null;
      crm.assignedCollectionName = collectionName || null;
      await pool.query('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(crm), subId]);
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/bulk-assign-collection — round-robin assign all unassigned subscribers to collection staff
router.post('/api/admin/bulk-assign-collection', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get all active collection staff
    const [csRows] = await pool.query(
      "SELECT id, name FROM staff WHERE role='COLLECTION' AND is_active=1 ORDER BY name"
    );
    if (csRows.length === 0) return res.status(400).json({ error: 'لا يوجد موظفو تحصيل نشطون' });

    // Get all subscribers with no assigned_cs_id (and not daqqi branch)
    const [unassigned] = await pool.query(
      "SELECT id FROM subscribers WHERE (assigned_cs_id IS NULL OR assigned_cs_id='') AND (branch IS NULL OR branch NOT LIKE '%DAQQI%') ORDER BY created_at ASC"
    );
    if (unassigned.length === 0) return res.json({ ok: true, assigned: 0, message: 'لا يوجد مشتركون غير معيّنون' });

    let idx = 0;
    let assigned = 0;
    // Batch in chunks of 100 for performance
    const CHUNK = 100;
    for (let i = 0; i < unassigned.length; i += CHUNK) {
      const chunk = unassigned.slice(i, i + CHUNK);
      await Promise.all(chunk.map(row => {
        const cs = csRows[idx % csRows.length];
        idx++;
        return pool.query(
          'UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=? WHERE id=?',
          [cs.id, cs.name, row.id]
        );
      }));
      assigned += chunk.length;
    }
    res.json({ ok: true, assigned, staffCount: csRows.length, staff: csRows.map(s => s.name) });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/client/:code — fetch ONE subscriber or lead by clientCode/id (staff-accessible)
// Sales staff can only see their own clients; admin sees any.
module.exports = router;
