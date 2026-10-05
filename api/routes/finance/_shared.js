'use strict';
// What every part of routes/finance/ requires, and the helpers more than one
// of them uses — one list, so the parts cannot drift onto different helpers
// for the same job.
const logger = require('../../lib/logger');
const crypto  = require('crypto');
const { uuidv4 } = require('../../lib/id');

const { pool } = require('../../lib/db');
const { tryJson, validate } = require('../../lib/helpers');
const { getBrandSettings } = require('../../lib/brandSettings');
const { getTenantSetting } = require('../../lib/tenantSettings');
const { applyRefundReversal, applyUnlinkedRefund } = require('../../lib/refunds');
const { itemTitle, parseItem } = require('../../lib/clientCourseActions');
const { logClientEvent } = require('../../lib/clientHistory');
const { createNotification } = require('../../lib/notification');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../../middleware/auth');
const { publicLimiter } = require('../../middleware/rateLimits');
const { branchIdForBranch, defaultDigitalBranch } = require('../../lib/branches');
const { financialRecordMatches, financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');
const { addDaysToDateOnly, dateOnlyInTimeZone, isValidDateOnly, monthRange, sqlCairoToday } = require('../../lib/dates');
const { EXPENSE_CATEGORY_LABEL } = require('../../lib/expenseCategories');
const { getVatPercent, logFinancialAudit } = require('../../lib/finance');

const validDateRange = (from, to) => isValidDateOnly(from) && isValidDateOnly(to) && from <= to;

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: HTML Invoice ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared data loader for invoice/receipt ────────────────────────────────
const { escapeHtml } = require('../../lib/html');

async function _loadPaymentForPrint(paymentId, tenantId) {
  const [[p]] = await pool.query(`
    SELECT p.*, fd.document_number, s.name AS client_name, s.email AS client_email, s.phone AS client_phone,
           s.national_id, s.client_code, s.assigned_cs_id, s.assigned_sales_id,
           c.title AS course_title, b.title AS bundle_title
    FROM payments p
    LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
    LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
    LEFT JOIN bundles b ON b.id = p.bundle_id AND b.tenant_id = p.tenant_id
    LEFT JOIN financial_documents fd ON fd.tenant_id=p.tenant_id
      AND fd.document_type='invoice' AND fd.source_type='payment' AND fd.source_id=p.id
    WHERE p.id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL
  `, [paymentId, tenantId]);
  if (!p) return null;
  // Identity comes from the central brand (what the owner set in Settings → الهوية),
  // so receipts/invoices carry the institute name, logo, colour and contacts.
  const brand = await getBrandSettings(tenantId);
  const vatSetting = await getVatPercent(tenantId);
  p._instituteName = escapeHtml(brand.instituteName);
  p._sitePhone = escapeHtml(brand.supportPhone || brand.supportWhatsapp || '');
  p._siteEmail = escapeHtml(brand.supportEmail);
  p._logoUrl = /^https?:\/\//i.test(brand.logoUrl || '') ? escapeHtml(brand.logoUrl) : '';
  p._primaryColor = brand.primaryColor;
  p._websiteUrl = escapeHtml(brand.websiteUrl);
  p._invoiceNum = p.document_number || `PAY-${p.id.slice(-8).toUpperCase()}`;
  p._dateStr = new Date(p.date || p.created_at).toLocaleDateString('ar-EG-u-nu-latn', { year:'numeric', month:'long', day:'numeric', timeZone: 'Africa/Cairo' });
  p._amount = parseFloat(p.amount) || 0;
  const cur = p.currency || 'EGP';
  p._currencyLabel = cur === 'SAR' ? 'ريال' : cur === 'USD' ? 'USD' : 'ج.م';
  p._itemName = escapeHtml(p.course_title || p.bundle_title || p.item_title || p.payment_type || 'خدمة تعليمية');
  for (const key of ['client_name', 'client_email', 'client_phone', 'national_id', 'client_code', 'payment_type', 'payment_method', 'transaction_id', 'note', 'status']) {
    if (p[key] != null) p[key] = escapeHtml(p[key]);
  }
  // VAT
  const vatPct = parseFloat(vatSetting || '0') || 0;
  p._vatPct     = vatPct;
  // Payment.amount is the gross amount actually collected. Derive the tax
  // component from that gross value; adding VAT again prints a total greater
  // than the cash received and makes the document irreconcilable.
  p._netAmount = vatPct > 0
    ? parseFloat((p._amount / (1 + vatPct / 100)).toFixed(2))
    : p._amount;
  p._vatAmount = parseFloat((p._amount - p._netAmount).toFixed(2));
  p._totalWithVat = p._amount;
  return p;
}



module.exports = {
  uuidv4,
  pool,
  tryJson,
  validate,
  getBrandSettings,
  getTenantSetting,
  applyRefundReversal,
  applyUnlinkedRefund,
  itemTitle,
  parseItem,
  logClientEvent,
  createNotification,
  requireAuth,
  requireAdmin,
  requireAdminOrStaff,
  requirePermission,
  requireAnyPermission,
  publicLimiter,
  branchIdForBranch,
  defaultDigitalBranch,
  financialRecordMatches,
  financialScopeClause,
  resolveFinancialScope,
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  isValidDateOnly,
  monthRange,
  sqlCairoToday,
  EXPENSE_CATEGORY_LABEL,
  getVatPercent,
  logFinancialAudit,
  escapeHtml,
  logger,
  crypto,
  validDateRange,
  _loadPaymentForPrint,
};
