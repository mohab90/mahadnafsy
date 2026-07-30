'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'finance-documents-route' });
const { pool } = require('../lib/db');
const { isValidDateOnly, dateOnlyInTimeZone } = require('../lib/dates');
const { resolveFinancialScope } = require('../lib/financialScope');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_financial')];
const dateRange = query => {
  const to = String(query.to || dateOnlyInTimeZone());
  const from = String(query.from || `${to.slice(0, 4)}-01-01`);
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) return null;
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  return days <= 366 ? { from, to } : null;
};
const jsonArray = value => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
};

router.get('/api/admin/finance/documents', ...view, async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const range = dateRange(req.query);
    if (!range) return res.status(400).json({ error: 'A valid date range up to 366 days is required' });
    const type = String(req.query.type || '').toLowerCase();
    if (type && !['invoice', 'credit_note'].includes(type)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }
    const params = [req.tenantId, range.from, range.to];
    let where = 'fd.tenant_id=? AND DATE(fd.issued_at) BETWEEN ? AND ?';
    if (scope.branchId) { where += ' AND fd.branch_id=?'; params.push(scope.branchId); }
    if (type) { where += ' AND fd.document_type=?'; params.push(type); }
    const [rows] = await pool.query(
      `SELECT fd.id,fd.document_type,fd.document_number,fd.source_type,fd.source_id,
              fd.related_document_id,fd.amount,fd.currency,fd.issued_at,fd.issued_by,fd.branch_id,
              p.subscriber_id,s.name AS subscriber_name
         FROM financial_documents fd
         LEFT JOIN payments p ON fd.source_type IN ('payment','payment_refund')
          AND p.id=fd.source_id AND p.tenant_id=fd.tenant_id
         LEFT JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
        WHERE ${where}
        ORDER BY fd.issued_at DESC,fd.document_number DESC LIMIT 2000`,
      params
    );
    res.json(rows);
  } catch (error) {
    logger.error(error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not load financial documents' });
  }
});

router.get('/api/admin/finance/ar-aging', ...view, async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const params = [req.tenantId];
    const branchSql = scope.branchId ? ' AND s.branch_id=?' : '';
    if (scope.branchId) params.push(scope.branchId);
    const [plans] = await pool.query(
      `SELECT ip.id,ip.subscriber_id,ip.title,ip.total_amount,ip.currency,ip.installments_count,
              ip.installment_amounts,ip.due_dates,ip.paid_dates,ip.payment_ids,ip.paid_amounts,
              ip.status,s.name AS subscriber_name,s.phone AS subscriber_phone,s.branch_id
         FROM installment_plans ip
         JOIN subscribers s ON s.id=ip.subscriber_id AND s.tenant_id=ip.tenant_id
        WHERE ip.tenant_id=? AND ip.status IN ('active','overdue') AND s.deleted_at IS NULL${branchSql}
        ORDER BY ip.created_at DESC LIMIT 5000`,
      params
    );
    const today = new Date(`${dateOnlyInTimeZone()}T00:00:00Z`);
    const rows = plans.flatMap(plan => {
      const dueDates = jsonArray(plan.due_dates);
      const amounts = jsonArray(plan.installment_amounts);
      const paidDates = jsonArray(plan.paid_dates);
      const paymentIds = jsonArray(plan.payment_ids);
      const paidAmounts = jsonArray(plan.paid_amounts);
      const fallback = Number(plan.total_amount) / Math.max(1, Number(plan.installments_count) || dueDates.length || 1);
      return dueDates.flatMap((dueDate, index) => {
        if (!dueDate || paidDates[index] || paymentIds[index]) return [];
        const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00Z`);
        if (Number.isNaN(due.getTime())) return [];
        const scheduled = Number(amounts[index]) || fallback;
        const paid = Number(paidAmounts[index]) || 0;
        const outstanding = Math.max(0, scheduled - paid);
        if (!outstanding) return [];
        return [{
          planId: plan.id,
          installmentNumber: index + 1,
          subscriberId: plan.subscriber_id,
          subscriberName: plan.subscriber_name,
          subscriberPhone: plan.subscriber_phone,
          title: plan.title,
          currency: String(plan.currency || 'EGP').toUpperCase(),
          dueDate: String(dueDate).slice(0, 10),
          daysOverdue: Math.max(0, Math.floor((today - due) / 86400000)),
          outstanding,
          branchId: plan.branch_id,
        }];
      });
    }).sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
    const bucketFor = days => days > 90 ? '91_plus' : days > 60 ? '61_90' : days > 30 ? '31_60' : days > 0 ? '1_30' : 'current';
    const buckets = {};
    for (const row of rows) {
      const key = bucketFor(row.daysOverdue);
      buckets[key] ||= { count: 0, totalsByCurrency: {} };
      buckets[key].count += 1;
      buckets[key].totalsByCurrency[row.currency] = Number((
        (buckets[key].totalsByCurrency[row.currency] || 0) + row.outstanding
      ).toFixed(2));
    }
    res.json({ asOf: dateOnlyInTimeZone(), branch: scope.branch, branchId: scope.branchId, buckets, rows });
  } catch (error) {
    logger.error(error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not load accounts receivable aging' });
  }
});

router.get('/api/admin/finance/audit-package', ...view, bulkOperationLimiter, async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const range = dateRange(req.query);
    if (!range) return res.status(400).json({ error: 'A valid date range up to 366 days is required' });
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    const params = scope.branchId
      ? [req.tenantId, range.from, range.to, scope.branchId]
      : [req.tenantId, range.from, range.to];
    const [documents, journals, audit] = await Promise.all([
      pool.query(
        `SELECT id,document_type,document_number,source_type,source_id,related_document_id,
                amount,currency,issued_at,issued_by,branch_id
           FROM financial_documents
          WHERE tenant_id=? AND DATE(issued_at) BETWEEN ? AND ?${branchSql}
          ORDER BY issued_at,id LIMIT 10000`,
        params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT je.id,je.ref_type,je.ref_id,je.entry_date,je.description,je.total_debit,
                je.total_credit,je.posted_by,je.branch_id,je.created_at,
                JSON_ARRAYAGG(JSON_OBJECT(
                  'account_code',jel.account_code,'account_name',jel.account_name,
                  'debit',jel.debit,'credit',jel.credit
                )) AS journal_lines
           FROM journal_entries je
           JOIN journal_entry_lines jel ON jel.entry_id=je.id
          WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${scope.branchId ? ' AND je.branch_id=?' : ''}
          GROUP BY je.id ORDER BY je.entry_date,je.id LIMIT 10000`,
        params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT id,entity_type,entity_id,action,old_json,new_json,amount,actor,created_at
           FROM financial_audit_log
          WHERE tenant_id=? AND DATE(created_at) BETWEEN ? AND ?
          ORDER BY created_at,id LIMIT 10000`,
        params.slice(0, 3)
      ).then(([rows]) => rows),
    ]);
    const packageData = {
      schemaVersion: 1,
      tenantId: req.tenantId,
      scope: { branch: scope.branch, branchId: scope.branchId },
      range,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user?.email || req.user?.uid,
      documents,
      journals,
      financialAudit: audit,
    };
    const canonical = JSON.stringify(packageData);
    const payload = { ...packageData, sha256: crypto.createHash('sha256').update(canonical).digest('hex') };
    res.set('Content-Disposition', `attachment; filename="finance-audit-${range.from}-${range.to}.json"`);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(payload));
  } catch (error) {
    logger.error(error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not build financial audit package' });
  }
});

module.exports = router;
