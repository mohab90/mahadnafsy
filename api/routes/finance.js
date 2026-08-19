'use strict';
const logger = require('../lib/logger');
const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson, validate } = require('../lib/helpers');
const { getBrandSettings } = require('../lib/brandSettings');
const { getTenantSetting } = require('../lib/tenantSettings');
const { applyRefundReversal } = require('../lib/refunds');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { branchIdForBranch, defaultDigitalBranch } = require('../lib/branches');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { addDaysToDateOnly, dateOnlyInTimeZone, isValidDateOnly, monthRange } = require('../lib/dates');
const { logFinancialAudit } = require('../lib/finance');

const validDateRange = (from, to) => isValidDateOnly(from) && isValidDateOnly(to) && from <= to;

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: HTML Invoice ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared data loader for invoice/receipt ────────────────────────────────
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

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
  const vatSetting = await getTenantSetting('vat_pct', { tenantId, fallback: 0 });
  p._instituteName = escapeHtml(brand.instituteName);
  p._sitePhone = escapeHtml(brand.supportPhone || brand.supportWhatsapp || '');
  p._siteEmail = escapeHtml(brand.supportEmail);
  p._logoUrl = /^https?:\/\//i.test(brand.logoUrl || '') ? escapeHtml(brand.logoUrl) : '';
  p._primaryColor = brand.primaryColor;
  p._websiteUrl = escapeHtml(brand.websiteUrl);
  p._invoiceNum = p.document_number || `PAY-${p.id.slice(-8).toUpperCase()}`;
  p._dateStr = new Date(p.date || p.created_at).toLocaleDateString('ar-EG-u-nu-latn', { year:'numeric', month:'long', day:'numeric' });
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

// GET /api/admin/payments/:id/receipt — 70mm thermal receipt (printable)
router.get('/api/admin/payments/:id/receipt', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.query.branch || null,
      allowAssigned: true,
    });
    const p = await _loadPaymentForPrint(req.params.id, req.tenantId);
    if (!p || !financialRecordMatches(scope, p)) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const statusLabel = p.status === 'paid' ? 'مدفوع ✓' : p.status === 'pending' ? 'معلق' : p.status === 'refunded' ? 'مسترد' : p.status === 'failed' ? 'ملغى' : p.status || '—';
    const payMethod = p.payment_method || p.paymentMethod || '—';
    const transId   = p.transaction_id || p.transactionId || null;

    // Character-repeat helper for receipt divider
    const line = '─'.repeat(32);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>إيصال ${p._invoiceNum}</title>
<style>
  @page {
    size: 70mm auto;
    margin: 3mm 2mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 70mm;
    max-width: 70mm;
    font-family: 'Courier New', 'Lucida Console', monospace;
    font-size: 11px;
    color: #000;
    background: #fff;
    direction: rtl;
  }
  .receipt {
    width: 66mm;
    margin: 0 auto;
    padding: 2mm 0;
  }
  .center  { text-align: center; }
  .right   { text-align: right; }
  .left    { text-align: left; }
  .bold    { font-weight: bold; }
  .large   { font-size: 15px; }
  .xlarge  { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
  .small   { font-size: 9px; color: #444; }
  .divider { color: #000; display: block; margin: 3px 0; letter-spacing: 0px; word-break: break-all; }
  .row     { display: flex; justify-content: space-between; margin: 2px 0; }
  .row .k  { color: #333; }
  .row .v  { font-weight: bold; text-align: left; }
  .total-box {
    border: 2px solid #000;
    padding: 4px 6px;
    margin: 5px 0;
    text-align: center;
  }
  .total-box .lbl  { font-size: 10px; }
  .total-box .amt  { font-size: 22px; font-weight: bold; letter-spacing: 1px; }
  .barcode-sim {
    font-family: 'Courier New', monospace;
    font-size: 8px;
    letter-spacing: 3px;
    margin: 3px 0;
    color: #000;
  }
  .status-ok   { background: #000; color: #fff; padding: 2px 8px; font-weight: bold; font-size: 11px; display: inline-block; border-radius: 2px; }
  .status-fail { border: 2px solid #000; padding: 2px 8px; font-weight: bold; font-size: 11px; display: inline-block; border-radius: 2px; }
  /* ─── Print-only: hide browser UI, no margins ─── */
  @media print {
    html, body { width: 70mm; max-width: 70mm; }
    .no-print { display: none !important; }
  }
  /* ─── Screen preview: show card ─── */
  @media screen {
    html, body { background: #f0f0f0; display: flex; justify-content: center; padding: 20px; }
    .receipt { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.2); padding: 8mm 4mm; border-radius: 4px; }
  }
</style>
</head>
<body>
<div class="receipt">

  <!-- Logo / Header -->
  <div class="center">
    ${p._logoUrl ? `<img src="${p._logoUrl}" alt="${p._instituteName}" style="height:60px;object-fit:contain;margin-bottom:8px" onerror="this.style.display='none'" />` : ''}
    <div class="xlarge" style="color:${p._primaryColor || '#111'}">${p._instituteName}</div>
    ${p._sitePhone ? `<div class="small">${p._sitePhone}</div>` : ''}
    ${p._siteEmail ? `<div class="small">${p._siteEmail}</div>` : ''}
    ${p._websiteUrl ? `<div class="small">${p._websiteUrl.replace(/^https?:\/\//, '')}</div>` : ''}
  </div>

  <span class="divider center">${line}</span>

  <!-- Invoice meta -->
  <div class="center">
    <div class="bold">إيصال دفع</div>
    <div class="barcode-sim center">${p._invoiceNum}</div>
    <div class="small">${p._dateStr}</div>
  </div>

  <span class="divider">${line}</span>

  <!-- Client -->
  <div class="bold small" style="margin-bottom:3px">بيانات العميل</div>
  <div class="row"><span class="k">الاسم</span><span class="v">${p.client_name || '—'}</span></div>
  ${p.client_code ? `<div class="row"><span class="k">الكود</span><span class="v">${p.client_code}</span></div>` : ''}
  ${p.client_phone ? `<div class="row"><span class="k">الهاتف</span><span class="v" style="direction:ltr;unicode-bidi:embed">${p.client_phone}</span></div>` : ''}

  <span class="divider">${line}</span>

  <!-- Item -->
  <div class="bold small" style="margin-bottom:3px">تفاصيل العملية</div>
  <div class="row"><span class="k">البند</span><span class="v" style="max-width:38mm;text-align:left;word-break:break-word">${p._itemName}</span></div>
  <div class="row"><span class="k">النوع</span><span class="v">${p.payment_type || '—'}</span></div>
  <div class="row"><span class="k">طريقة الدفع</span><span class="v">${payMethod}</span></div>
  ${transId ? `<div class="row"><span class="k">رقم المعاملة</span><span class="v small" style="direction:ltr;unicode-bidi:embed;max-width:32mm;overflow:hidden;text-overflow:ellipsis">${transId}</span></div>` : ''}
  ${p.note ? `<div class="row"><span class="k">ملاحظة</span><span class="v">${p.note}</span></div>` : ''}

  <span class="divider">${line}</span>

  <!-- Total -->
  <div class="total-box">
    <div class="lbl">إجمالي المبلغ المسدد</div>
    ${p._vatPct > 0 ? `
    <div class="row" style="font-size:10px;margin-bottom:2px"><span class="k">قبل الضريبة</span><span class="v">${p._netAmount.toLocaleString('ar-EG-u-nu-latn')} ${p._currencyLabel}</span></div>
    <div class="row" style="font-size:10px;margin-bottom:2px"><span class="k">ضريبة (${p._vatPct}%)</span><span class="v">${p._vatAmount.toLocaleString('ar-EG-u-nu-latn')} ${p._currencyLabel}</span></div>
    ` : ''}
    <div class="amt">${p._totalWithVat.toLocaleString('ar-EG-u-nu-latn')} ${p._currencyLabel}</div>
    <div class="center" style="margin-top:4px">
      <span class="${p.status === 'paid' ? 'status-ok' : 'status-fail'}">${statusLabel}</span>
    </div>
  </div>

  <span class="divider">${line}</span>

  <!-- Footer -->
  <div class="center small" style="margin-top:3px">
    <div>إيصال سداد صادر من النظام</div>
    <div>شكراً لثقتكم 💚</div>
    <div style="margin-top:3px;font-size:8px">mahadnafsy.com</div>
    <div class="barcode-sim" style="margin-top:4px;font-size:7px;letter-spacing:2px">${p.id.toUpperCase()}</div>
  </div>

</div>

<!-- Screen-only print button -->
<div class="no-print" style="position:fixed;bottom:16px;right:16px">
  <button onclick="window.print()"
    style="background:#000;color:#fff;border:none;padding:10px 24px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:bold;font-family:Arial">
    🖨️ طباعة الإيصال
  </button>
</div>
<script>
  if (new URLSearchParams(location.search).get('print') === '1') {
    setTimeout(() => window.print(), 400);
  }
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (e) { logger.error('[receipt]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/invoice/:paymentId — returns printable HTML invoice (A4)
router.get('/api/admin/invoice/:paymentId', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.query.branch || null,
      allowAssigned: true,
    });
    const p = await _loadPaymentForPrint(req.params.paymentId, req.tenantId);
    if (!p || !financialRecordMatches(scope, p)) return res.status(404).json({ error: 'Payment not found' });

    const instituteName = p._instituteName;
    const invoiceNum    = p._invoiceNum;
    const dateStr       = p._dateStr;
    const itemName      = p._itemName;
    const amount        = p._netAmount;
    const currencyLabel = p._currencyLabel === 'ج.م' ? 'جنيه مصري' : p._currencyLabel === 'ريال' ? 'ريال سعودي' : 'دولار أمريكي';

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>بيان سداد ${invoiceNum}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; color: #333; direction: rtl; }
  .page { max-width: 800px; margin: 30px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #2c7a7b 0%, #285e61 100%); color: #fff; padding: 32px 40px; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .header p { opacity: 0.85; font-size: 14px; }
  .inv-meta { display: flex; justify-content: space-between; align-items: flex-start; padding: 28px 40px; border-bottom: 2px solid #e2e8f0; }
  .inv-meta .block { }
  .inv-meta .label { font-size: 11px; text-transform: uppercase; color: #718096; letter-spacing: 1px; margin-bottom: 4px; }
  .inv-meta .value { font-size: 16px; font-weight: 700; color: #2d3748; }
  .inv-meta .inv-badge { background: #ebf8ff; color: #2b6cb0; padding: 8px 16px; border-radius: 8px; font-size: 20px; font-weight: 800; letter-spacing: 1px; }
  .client-section { padding: 24px 40px; background: #f7fafc; border-bottom: 1px solid #e2e8f0; }
  .client-section h3 { font-size: 13px; color: #718096; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  .client-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .client-field { }
  .client-field .lbl { font-size: 12px; color: #a0aec0; }
  .client-field .val { font-size: 15px; color: #2d3748; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin: 0; }
  table.items thead tr { background: #edf2f7; }
  table.items th { padding: 12px 40px; text-align: right; font-size: 13px; color: #4a5568; font-weight: 600; }
  table.items td { padding: 16px 40px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #2d3748; }
  .total-row { background: #2c7a7b; color: #fff; }
  .total-row td { padding: 18px 40px; font-size: 18px; font-weight: 800; }
  .footer { padding: 24px 40px; text-align: center; color: #a0aec0; font-size: 13px; border-top: 2px solid #e2e8f0; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;
    background: ${p.status === 'paid' ? '#c6f6d5' : '#fed7d7'}; color: ${p.status === 'paid' ? '#22543d' : '#742a2a'}; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; border-radius: 0; margin: 0; max-width: 100%; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${instituteName}</h1>
    <p>بيان سداد — Payment Statement</p>
  </div>
  <div class="inv-meta">
    <div class="block">
      <div class="label">مرجع السداد</div>
      <div class="inv-badge">${invoiceNum}</div>
    </div>
    <div class="block">
      <div class="label">تاريخ الإصدار</div>
      <div class="value">${dateStr}</div>
    </div>
    <div class="block">
      <div class="label">الحالة</div>
      <div class="value"><span class="status-badge">${p.status === 'paid' ? '✓ مدفوعة' : p.status}</span></div>
    </div>
    ${p.transaction_id ? `<div class="block"><div class="label">رقم المعاملة</div><div class="value" style="font-size:13px;color:#718096">${p.transaction_id}</div></div>` : ''}
  </div>
  <div class="client-section">
    <h3>بيانات العميل</h3>
    <div class="client-grid">
      <div class="client-field"><div class="lbl">الاسم</div><div class="val">${p.client_name || '—'}</div></div>
      <div class="client-field"><div class="lbl">البريد الإلكتروني</div><div class="val">${p.client_email || '—'}</div></div>
      <div class="client-field"><div class="lbl">الهاتف</div><div class="val">${p.client_phone || '—'}</div></div>
      <div class="client-field"><div class="lbl">كود العميل</div><div class="val">${p.client_code || '—'}</div></div>
    </div>
  </div>
  <table class="items">
    <thead><tr>
      <th>البيان</th>
      <th>نوع الدفع</th>
      <th>طريقة الدفع</th>
      <th style="text-align:left">المبلغ</th>
    </tr></thead>
    <tbody>
      <tr>
        <td>${itemName}</td>
        <td>${p.payment_type || '—'}</td>
        <td>${p.payment_method || '—'}</td>
        <td style="text-align:left;font-weight:700">${amount.toLocaleString('ar-EG-u-nu-latn')} ${currencyLabel}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;color:#718096;font-size:13px">المبلغ قبل الضريبة</td>
        <td style="text-align:left">${amount.toLocaleString('ar-EG-u-nu-latn')} ${currencyLabel}</td>
      </tr>
      ${p._vatPct > 0 ? `<tr>
        <td colspan="3" style="text-align:right;color:#718096;font-size:13px">ضريبة القيمة المضافة (${p._vatPct}%)</td>
        <td style="text-align:left">${p._vatAmount.toLocaleString('ar-EG-u-nu-latn')} ${currencyLabel}</td>
      </tr>` : ''}
      <tr class="total-row">
        <td colspan="3" style="text-align:right">الإجمالي</td>
        <td style="text-align:left">${p._totalWithVat.toLocaleString('ar-EG-u-nu-latn')} ${currencyLabel}</td>
      </tr>
    </tfoot>
  </table>
  <div class="footer">
    <p>${instituteName} — info@mahadnafsy.com — mahadnafsy.com</p>
    <p style="margin-top:6px">بيان صادر من النظام يطابق عملية السداد المسجلة</p>
  </div>
</div>
<div class="no-print" style="text-align:center;padding:20px">
  <button onclick="window.print()" style="background:#2c7a7b;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;font-weight:700">🖨️ طباعة / حفظ PDF</button>
</div>
<script>
  // Auto-open print dialog if ?print=1
  if (new URLSearchParams(location.search).get('print') === '1') {
    setTimeout(() => window.print(), 500);
  }
</script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Monthly Financial Comparison ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/monthly-comparison — current vs previous month
router.get('/api/admin/financial/monthly-comparison', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const scopedParams = (...values) => scope.branchId ? [...values, scope.branchId] : values;
    const journalBranchSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const paymentBranchSql = scope.branchId ? ' AND p.branch_id=?' : '';
    const leadBranchSql = scope.branchId ? ' AND l.branch_id=?' : '';
    const subscriberBranchSql = scope.branchId ? ' AND s.branch_id=?' : '';
    const today = dateOnlyInTimeZone();
    const current = monthRange(today);
    const previous = monthRange(addDaysToDateOnly(current.startDate, -1));
    const [ledgerResult, paymentResult, leadResult, subscriberResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN je.entry_date>=? AND jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS current_revenue,
          COALESCE(SUM(CASE WHEN je.entry_date<? AND jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS previous_revenue,
          COALESCE(SUM(CASE WHEN je.entry_date>=? AND jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS current_expenses,
          COALESCE(SUM(CASE WHEN je.entry_date<? AND jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS previous_expenses
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id=? AND je.entry_date>=? AND je.entry_date<?${journalBranchSql}`,
      scopedParams(current.startDate, current.startDate, current.startDate, current.startDate,
        req.tenantId, previous.startDate, current.endDate)),
      pool.query(`
        SELECT
          COUNT(CASE WHEN p.date>=? AND p.status='paid' THEN 1 END) AS current_payment_count,
          COUNT(DISTINCT CASE WHEN p.date>=? AND p.status='paid' THEN p.subscriber_id END) AS current_active_clients,
          COUNT(CASE WHEN p.date<? AND p.status='paid' THEN 1 END) AS previous_payment_count,
          COUNT(DISTINCT CASE WHEN p.date<? AND p.status='paid' THEN p.subscriber_id END) AS previous_active_clients
        FROM payments p
        WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.date>=? AND p.date<?${paymentBranchSql}`,
      scopedParams(current.startDate, current.startDate, current.startDate, current.startDate,
        req.tenantId, previous.startDate, current.endDate)),
      pool.query(`
        SELECT
          COUNT(CASE WHEN l.created_at>=? THEN 1 END) AS current_count,
          COUNT(CASE WHEN l.created_at<? THEN 1 END) AS previous_count
        FROM leads l
        WHERE l.tenant_id=? AND l.created_at>=? AND l.created_at<?${leadBranchSql}`,
      scopedParams(current.startDate, current.startDate, req.tenantId, previous.startDate, current.endDate)),
      pool.query(`
        SELECT
          COUNT(CASE WHEN s.created_at>=? THEN 1 END) AS current_count,
          COUNT(CASE WHEN s.created_at<? THEN 1 END) AS previous_count
        FROM subscribers s
        WHERE s.tenant_id=? AND s.deleted_at IS NULL AND s.created_at>=? AND s.created_at<?${subscriberBranchSql}`,
      scopedParams(current.startDate, current.startDate, req.tenantId, previous.startDate, current.endDate)),
    ]);
    const ledger = ledgerResult[0][0];
    const payments = paymentResult[0][0];
    const leads = leadResult[0][0];
    const subscribers = subscriberResult[0][0];

    const diff = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0);
    const curRev = Number(ledger.current_revenue) || 0;
    const prevRev = Number(ledger.previous_revenue) || 0;
    const curExpAmt = Number(ledger.current_expenses) || 0;
    const prevExpAmt = Number(ledger.previous_expenses) || 0;
    const curPaymentCount = Number(payments.current_payment_count) || 0;
    const prevPaymentCount = Number(payments.previous_payment_count) || 0;
    const curActiveClients = Number(payments.current_active_clients) || 0;
    const prevActiveClients = Number(payments.previous_active_clients) || 0;
    const newLeads = Number(leads.current_count) || 0;
    const prevLeads = Number(leads.previous_count) || 0;
    const newSubs = Number(subscribers.current_count) || 0;
    const prevSubs = Number(subscribers.previous_count) || 0;

    res.json({
      current: {
        revenue: curRev,
        expenses: curExpAmt,
        net: curRev - curExpAmt,
        payment_count: curPaymentCount,
        active_clients: curActiveClients,
        new_leads: newLeads,
        new_subscribers: newSubs,
      },
      previous: {
        revenue: prevRev,
        expenses: prevExpAmt,
        net: prevRev - prevExpAmt,
        payment_count: prevPaymentCount,
        active_clients: prevActiveClients,
        new_leads: prevLeads,
        new_subscribers: prevSubs,
      },
      changes: {
        revenue: diff(curRev, prevRev),
        expenses: diff(curExpAmt, prevExpAmt),
        net: diff(curRev - curExpAmt, prevRev - prevExpAmt),
        payment_count: diff(curPaymentCount, prevPaymentCount),
        new_leads: diff(newLeads, prevLeads),
        new_subscribers: diff(newSubs, prevSubs),
      },
      branch: scope.branch,
      branchId: scope.branchId,
    });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Accounting Reports (P&L, Balance Sheet, Trial Balance) ───────
// ═══════════════════════════════════════════════════════════════════════════

/*
  Chart of accounts reference (from v22):
    1xxx = Assets     (Debit-normal)   e.g. 1100 Cash/Bank
    2xxx = Liabilities(Credit-normal)  e.g. 2100 Accrued Salaries
    3xxx = Equity     (Credit-normal)
    4xxx = Revenue    (Credit-normal)  e.g. 4100 Courses, 4200 Consult, 4300 Cert, 4900 Other
    5xxx = Expenses   (Debit-normal)   e.g. 5100 Staff Salaries
*/

// GET /api/admin/reports/pl?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns Profit & Loss: Revenue (4xxx) - Expenses (5xxx) grouped by account, monthly breakdown
router.get('/api/admin/reports/pl', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';

    // Revenue lines (credit-normal): credit - debit = net credit
    const [revRows] = await pool.query(`
      SELECT
        jel.account_code,
        jel.account_name,
        DATE_FORMAT(je.entry_date, '%Y-%m') AS month,
        SUM(jel.credit) - SUM(jel.debit) AS net_amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '4%'
        AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name, month
      ORDER BY jel.account_code, month
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    // Expense lines (debit-normal): debit - credit = net debit
    const [expRows] = await pool.query(`
      SELECT
        jel.account_code,
        jel.account_name,
        DATE_FORMAT(je.entry_date, '%Y-%m') AS month,
        SUM(jel.debit) - SUM(jel.credit) AS net_amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '5%'
        AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name, month
      ORDER BY jel.account_code, month
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    // Totals
    const totalRevenue  = revRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const totalExpenses = expRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const netIncome     = totalRevenue - totalExpenses;

    // Group revenue by account
    const revenueByAccount = {};
    for (const r of revRows) {
      const key = r.account_code;
      if (!revenueByAccount[key]) revenueByAccount[key] = { account_code: key, account_name: r.account_name, total: 0, monthly: {} };
      revenueByAccount[key].total += parseFloat(r.net_amount || 0);
      revenueByAccount[key].monthly[r.month] = parseFloat(r.net_amount || 0);
    }

    // Group expenses by account
    const expensesByAccount = {};
    for (const r of expRows) {
      const key = r.account_code;
      if (!expensesByAccount[key]) expensesByAccount[key] = { account_code: key, account_name: r.account_name, total: 0, monthly: {} };
      expensesByAccount[key].total += parseFloat(r.net_amount || 0);
      expensesByAccount[key].monthly[r.month] = parseFloat(r.net_amount || 0);
    }

    // Distinct months
    const monthSet = new Set([...revRows, ...expRows].map(r => r.month));
    const months = [...monthSet].sort();

    res.json({
      period: { from, to }, branch: scope.branch, branchId: scope.branchId,
      months,
      revenue:  { accounts: Object.values(revenueByAccount),  total: totalRevenue  },
      expenses: { accounts: Object.values(expensesByAccount), total: totalExpenses },
      net_income: netIncome
    });
  } catch (e) {
    logger.error('[reports/pl]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/reports/trial-balance?from=&to=
// Returns all accounts with running debit/credit totals
router.get('/api/admin/reports/trial-balance', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';

    const [rows] = await pool.query(`
      SELECT
        jel.account_code,
        jel.account_name,
        SUM(jel.debit)  AS total_debit,
        SUM(jel.credit) AS total_credit,
        SUM(jel.debit) - SUM(jel.credit) AS balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name
      ORDER BY jel.account_code
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const totalDebit  = rows.reduce((s, r) => s + parseFloat(r.total_debit  || 0), 0);
    const totalCredit = rows.reduce((s, r) => s + parseFloat(r.total_credit || 0), 0);

    const accounts = rows.map(r => ({
      account_code:  r.account_code,
      account_name:  r.account_name,
      total_debit:   parseFloat(r.total_debit  || 0),
      total_credit:  parseFloat(r.total_credit || 0),
      balance:       parseFloat(r.balance       || 0),
      type: r.account_code.startsWith('1') ? 'asset'
          : r.account_code.startsWith('2') ? 'liability'
          : r.account_code.startsWith('3') ? 'equity'
          : r.account_code.startsWith('4') ? 'revenue'
          : r.account_code.startsWith('5') ? 'expense'
          : 'other'
    }));

    res.json({
      period: { from, to },
      branch: scope.branch,
      branchId: scope.branchId,
      accounts,
      totals: { debit: totalDebit, credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 }
    });
  } catch (e) {
    logger.error('[reports/trial-balance]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/reports/journal?from=&to=&account_code=&ref_type=&page=&limit=
// Paginated journal entry ledger
router.get('/api/admin/reports/journal', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from    = req.query.from    || `${today.slice(0, 4)}-01-01`;
    const to      = req.query.to      || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const acct    = req.query.account_code || null;
    const refType = req.query.ref_type    || null;
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(200, parseInt(req.query.limit) || 50);
    const offset  = (page - 1) * limit;
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });

    let filters = '';
    const params = [req.tenantId, from, to];
    if (scope.branchId) { filters += ' AND je.branch_id = ?'; params.push(scope.branchId); }
    if (refType) { filters += ' AND je.ref_type = ?'; params.push(refType); }

    let entryFilter = '';
    if (acct) {
      entryFilter = `AND je.id IN (SELECT DISTINCT entry_id FROM journal_entry_lines WHERE account_code = ?)`;
      params.push(acct);
    }

    const countParams = [...params];
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM journal_entries je
       WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ? ${filters} ${entryFilter}`,
      countParams
    );

    const [entries] = await pool.query(`
      SELECT je.id, je.ref_type, je.ref_id, je.entry_date, je.description,
             je.total_debit, je.total_credit, je.posted_by, je.branch, je.branch_id, je.created_at
       FROM journal_entries je
       WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ? ${filters} ${entryFilter}
      ORDER BY je.entry_date DESC, je.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    if (!entries.length) return res.json({
      period: { from, to },
      branch: scope.branch,
      branchId: scope.branchId,
      entries: [],
      lines: {},
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });

    const entryIds = entries.map(e => e.id);
    const [lines] = await pool.query(
      `SELECT id, entry_id, account_code, account_name, debit, credit
       FROM journal_entry_lines WHERE entry_id IN (${entryIds.map(() => '?').join(',')}) ORDER BY entry_id, account_code`,
      entryIds
    );

    const linesByEntry = {};
    for (const l of lines) {
      if (!linesByEntry[l.entry_id]) linesByEntry[l.entry_id] = [];
      linesByEntry[l.entry_id].push(l);
    }

    res.json({
      period: { from, to },
      branch: scope.branch,
      branchId: scope.branchId,
      entries,
      lines: linesByEntry,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (e) {
    logger.error('[reports/journal]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/reports/pl/html?from=&to= — printable P&L HTML report
router.get('/api/admin/reports/pl/html', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';

    const [revRows] = await pool.query(`
      SELECT jel.account_code, jel.account_name, SUM(jel.credit) - SUM(jel.debit) AS net_amount
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '4%' AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name ORDER BY jel.account_code
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const [expRows] = await pool.query(`
      SELECT jel.account_code, jel.account_name, SUM(jel.debit) - SUM(jel.credit) AS net_amount
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '5%' AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name ORDER BY jel.account_code
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const instituteName = escapeHtml((await getBrandSettings(req.tenantId)).instituteName);

    const totalRevenue  = revRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const totalExpenses = expRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const netIncome     = totalRevenue - totalExpenses;
    const fmt = n => parseFloat(n || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2 });

    const revRows_html = revRows.map(r => `
      <tr><td>${escapeHtml(r.account_code)}</td><td>${escapeHtml(r.account_name)}</td>
          <td class="num">${fmt(r.net_amount)}</td></tr>`).join('') ||
      '<tr><td colspan="3" style="text-align:center;color:#999">لا يوجد بيانات</td></tr>';

    const expRows_html = expRows.map(r => `
      <tr><td>${escapeHtml(r.account_code)}</td><td>${escapeHtml(r.account_name)}</td>
          <td class="num">${fmt(r.net_amount)}</td></tr>`).join('') ||
      '<tr><td colspan="3" style="text-align:center;color:#999">لا يوجد بيانات</td></tr>';

    const dateRange = `${new Date(from).toLocaleDateString('ar-EG-u-nu-latn')} — ${new Date(to).toLocaleDateString('ar-EG-u-nu-latn')}`;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>قائمة الدخل — ${dateRange}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #222; direction: rtl; background: #fff; }
  .header { text-align: center; border-bottom: 3px solid #2c7a7b; padding-bottom: 12px; margin-bottom: 20px; }
  .header h1 { font-size: 22px; color: #2c7a7b; }
  .header p  { color: #666; font-size: 12px; margin-top: 4px; }
  h2 { font-size: 15px; background: #2c7a7b; color: #fff; padding: 6px 12px; margin: 16px 0 8px; border-radius: 4px; }
  h2.exp { background: #c53030; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #edf2f7; padding: 8px 10px; font-size: 12px; text-align: right; }
  td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
  td.num { text-align: left; font-family: 'Courier New', monospace; font-weight: 600; }
  .total-row td { background: #f7fafc; font-weight: 700; border-top: 2px solid #2c7a7b; font-size: 14px; }
  .net-box { margin-top: 24px; border: 2px solid ${netIncome >= 0 ? '#2c7a7b' : '#c53030'}; border-radius: 8px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }
  .net-box .lbl { font-size: 16px; font-weight: 700; }
  .net-box .amt { font-size: 24px; font-weight: 900; color: ${netIncome >= 0 ? '#2c7a7b' : '#c53030'}; }
  .footer { margin-top: 30px; text-align: center; color: #999; font-size: 11px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  @media print { .no-print { display: none !important; } }
  @media screen { .no-print { margin: 20px; text-align: center; } }
</style>
</head>
<body>
<div class="header">
  <h1>${instituteName}</h1>
  <p>قائمة الدخل (Profit & Loss Statement)</p>
  <p>${dateRange}</p>
</div>

<h2>الإيرادات</h2>
<table>
  <thead><tr><th>كود الحساب</th><th>اسم الحساب</th><th>المبلغ (ج.م)</th></tr></thead>
  <tbody>${revRows_html}</tbody>
  <tfoot><tr class="total-row"><td colspan="2">إجمالي الإيرادات</td><td class="num">${fmt(totalRevenue)}</td></tr></tfoot>
</table>

<h2 class="exp">المصروفات</h2>
<table>
  <thead><tr><th>كود الحساب</th><th>اسم الحساب</th><th>المبلغ (ج.م)</th></tr></thead>
  <tbody>${expRows_html}</tbody>
  <tfoot><tr class="total-row"><td colspan="2">إجمالي المصروفات</td><td class="num">${fmt(totalExpenses)}</td></tr></tfoot>
</table>

<div class="net-box">
  <span class="lbl">${netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</span>
  <span class="amt">${fmt(Math.abs(netIncome))} ج.م</span>
</div>

<div class="footer">
  <p>تقرير مُنشأ بتاريخ ${new Date().toLocaleDateString('ar-EG-u-nu-latn')} — ${instituteName}</p>
</div>

<div class="no-print">
  <button onclick="window.print()" style="background:#2c7a7b;color:#fff;border:none;padding:10px 28px;border-radius:6px;font-size:15px;cursor:pointer;font-weight:bold">🖨️ طباعة / PDF</button>
</div>
<script>
  if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 400);
</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (e) {
    logger.error('[reports/pl/html]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Payment Links ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


function checkoutUrlForPaymentLink(token) {
  if (process.env.PAYMENT_LINKS_ENABLED !== 'true') return null;
  const template = String(process.env.PAYMENT_LINK_CHECKOUT_URL_TEMPLATE || '').trim();
  if (!template.includes('{token}')) return null;
  try {
    const url = new URL(template.replace('{token}', encodeURIComponent(token)));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// POST /api/admin/payment-links — generate a payment link
router.post('/api/admin/payment-links', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const checkoutProbe = checkoutUrlForPaymentLink('probe');
    if (!checkoutProbe) {
      return res.status(409).json({
        error: 'Payment links are disabled until a verified HTTPS checkout contract is configured',
        code: 'PAYMENT_LINKS_DISABLED',
      });
    }
    const { item_type, item_id, amount, currency = 'EGP', subscriber_id, description, expires_days = 7, branch } = req.body;
    const scope = resolveFinancialScope(req, { requestedBranch: branch || null, allowAssigned: true });
    if (!item_type || !item_id || !amount) return res.status(400).json({ error: 'item_type, item_id, and amount are required' });
    if (!['course', 'bundle', 'consultation'].includes(item_type)) return res.status(400).json({ error: 'Invalid item type' });
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10000000) return res.status(400).json({ error: 'Invalid amount' });
    if (!['EGP', 'SAR', 'USD'].includes(String(currency).toUpperCase())) return res.status(400).json({ error: 'Invalid currency' });
    const itemTable = item_type === 'course' ? 'courses' : item_type === 'bundle' ? 'bundles' : 'consultations';
    const [[itemExists]] = await pool.query(`SELECT id FROM ${itemTable} WHERE id=? AND tenant_id=? LIMIT 1`, [item_id, req.tenantId]);
    if (!itemExists) return res.status(404).json({ error: 'Item not found' });
    let subscriber = null;
    if (subscriber_id) {
      [[subscriber]] = await pool.query(
        `SELECT id, branch, branch_id, assigned_cs_id, assigned_sales_id
         FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1`,
        [subscriber_id, req.tenantId]
      );
      if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
      if (!financialRecordMatches(scope, subscriber)) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }
    } else if (scope.kind === 'assigned_cs' || scope.kind === 'assigned_sales') {
      return res.status(400).json({ error: 'subscriber_id is required for assigned-record financial scope' });
    }
    const effectiveBranch = subscriber?.branch || scope.branch || defaultDigitalBranch(branch);
    const effectiveBranchId = subscriber?.branch_id || scope.branchId || branchIdForBranch(effectiveBranch);
    const id = uuidv4();
    const token = crypto.randomBytes(32).toString('hex');
    const safeExpiresDays = Math.min(90, Math.max(1, parseInt(expires_days, 10) || 7));
    const expiresAt = new Date(Date.now() + safeExpiresDays * 24 * 60 * 60 * 1000);
    const actor = req.staffRecord?.name || req.user?.email || 'admin';
    await pool.query(
      'INSERT INTO payment_links (id, tenant_id, branch, branch_id, token, item_type, item_id, amount, currency, subscriber_id, description, expires_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.tenantId, effectiveBranch, effectiveBranchId, token, item_type, item_id, numericAmount, String(currency).toUpperCase(), subscriber_id || null, description || null, expiresAt, actor]
    );
    const link = checkoutUrlForPaymentLink(token);
    res.json({ ok: true, id, link, token, expires_at: expiresAt });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/payment-links — list all payment links
router.get('/api/admin/payment-links', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.query.branch || null,
      allowAssigned: true,
    });
    let scopeSql = '';
    const scopeParams = [];
    if (scope.branchId) {
      scopeSql = ' AND pl.branch_id=?';
      scopeParams.push(scope.branchId);
    } else if (scope.kind === 'assigned_cs') {
      scopeSql = ' AND s.assigned_cs_id=?';
      scopeParams.push(scope.staffId);
    } else if (scope.kind === 'assigned_sales') {
      scopeSql = ' AND s.assigned_sales_id=?';
      scopeParams.push(scope.staffId);
    }
    const [rows] = await pool.query(`
      SELECT pl.*, s.name AS subscriber_name
      FROM payment_links pl
      LEFT JOIN subscribers s ON s.id = pl.subscriber_id AND s.tenant_id = pl.tenant_id
      WHERE pl.tenant_id=?${scopeSql}
      ORDER BY pl.created_at DESC LIMIT 200
    `, [req.tenantId, ...scopeParams]);
    const result = rows.map(r => ({ ...r, link: checkoutUrlForPaymentLink(r.token) }));
    res.json(result);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/payment-links/:token — public validate (used by client checkout)
router.get('/api/payment-links/:token', publicLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    const [[pl]] = await pool.query(
      'SELECT pl.*, s.name AS subscriber_name, s.email AS subscriber_email FROM payment_links pl LEFT JOIN subscribers s ON s.id=pl.subscriber_id AND s.tenant_id=pl.tenant_id WHERE pl.token=? AND pl.tenant_id=?',
      [token, req.tenantId]
    );
    if (!pl) return res.status(404).json({ error: 'Link not found' });
    if (new Date(pl.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired' });
    if (pl.used_at) return res.status(409).json({ error: 'Link already used' });
    // Get item details
    let item = null;
    if (pl.item_type === 'course') {
      const [[c]] = await pool.query('SELECT id, title, title_ar, price_egp, price_sar, price_usd FROM courses WHERE id=? AND tenant_id=?', [pl.item_id, pl.tenant_id]);
      item = c;
    } else if (pl.item_type === 'bundle') {
      const [[b]] = await pool.query('SELECT id, title, price_egp, price_sar, price_usd FROM bundles WHERE id=? AND tenant_id=?', [pl.item_id, pl.tenant_id]);
      item = b;
    } else if (pl.item_type === 'consultation') {
      const [[consultation]] = await pool.query(
        `SELECT c.id,CONCAT('Consultation - ',t.name) AS title,c.session_date,c.status
           FROM consultations c
           JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
          WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL LIMIT 1`,
        [pl.item_id, pl.tenant_id]
      );
      item = consultation;
    }
    res.json({ ok: true, pl: { ...pl, token: undefined }, item });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// IP-whitelist enforcement moved to a global, opt-in guard in server.js
// (adminIpWhitelistGuard) — it reads the ip_whitelist table the UI writes to,
// scopes to /api/admin/*, exempts the management route, and is env-gated. The old
// middleware here read a different store (site_config.admin_ip_whitelist) and only
// guarded the management route itself — a self-lockout footgun — so it was removed.


// ═══════════════════════════════════════════════════════════════════════════
// ── FINANCIAL COCKPIT — live dashboard data from DB (not SiteDataContext) ──
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/finance/cockpit', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const journalScopeSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const paymentScopeSql = scope.branchId ? ' AND branch_id=?' : '';
    const paymentAliasScopeSql = scope.branchId ? ' AND p.branch_id=?' : '';
    const expenseScopeSql = scope.branchId ? ' AND branch_id=?' : '';
    const now = new Date();
    const today = dateOnlyInTimeZone(now);
    const todayUtc = new Date(`${today}T00:00:00.000Z`);
    const weekStart = addDaysToDateOnly(today, -todayUtc.getUTCDay());
    const currentMonth = monthRange(today);
    const monthStart = currentMonth.startDate;
    const prevMonth = monthRange(addDaysToDateOnly(monthStart, -1));
    const prevMonthStart = prevMonth.startDate;
    const prevMonthEnd = prevMonth.endDate;

    // ── Revenue snapshots ──────────────────────────────────────────────
    const revenueForRange = async (start, end = null) => {
      const endSql = end ? ' AND je.entry_date < ?' : '';
      const params = end ? [req.tenantId, start, end] : [req.tenantId, start];
      if (scope.branchId) params.push(scope.branchId);
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(jel.credit-jel.debit),0) AS v
           FROM journal_entries je
           JOIN journal_entry_lines jel ON jel.entry_id=je.id
          WHERE je.tenant_id=? AND je.entry_date>=?${endSql}${journalScopeSql}
            AND jel.account_code LIKE '4%'`,
        params
      );
      return row;
    };
    const [todayRev, weekRev, monthRev, prevRev] = await Promise.all([
      revenueForRange(today, addDaysToDateOnly(today, 1)),
      revenueForRange(weekStart),
      revenueForRange(monthStart),
      revenueForRange(prevMonthStart, prevMonthEnd),
    ]);

    // ── Expense this month ─────────────────────────────────────────────
    const [[monthExp]] = await pool.query(
      `SELECT COALESCE(SUM(jel.debit-jel.credit),0) AS v
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id=? AND je.entry_date>=?${journalScopeSql} AND jel.account_code LIKE '5%'`,
      scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]
    );

    // ── Revenue forecast: project month based on days elapsed ──────────
    const dayOfMonth = Number(today.slice(8, 10));
    const daysInMonth = Number(addDaysToDateOnly(currentMonth.endDate, -1).slice(8, 10));
    const forecast = dayOfMonth > 0 ? Math.round((parseFloat(monthRev.v) / dayOfMonth) * daysInMonth) : 0;

    // ── 12-month trend ─────────────────────────────────────────────────
    const [trend12] = await pool.query(`
      SELECT DATE_FORMAT(je.entry_date,'%Y-%m') AS month,
             COALESCE(SUM(jel.credit-jel.debit),0) AS revenue,
             COUNT(DISTINCT je.id) AS txn_count
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.entry_date>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH)
        AND jel.account_code LIKE '4%'${journalScopeSql}
      GROUP BY month ORDER BY month ASC
    `, scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]);

    // ── Top 5 courses by revenue this month ───────────────────────────
    const [topCourses] = await pool.query(`
      SELECT COALESCE(c.title_ar, c.title, p.item_title, p.payment_type, 'غير محدد') AS name,
             SUM(p.amount_egp) AS revenue, COUNT(*) AS cnt
      FROM payments p
      LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid'${paymentAliasScopeSql}
      GROUP BY p.course_id ORDER BY revenue DESC LIMIT 5
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Top 5 staff by revenue collected this month ────────────────────
    const [topStaff] = await pool.query(`
      SELECT COALESCE(s.name, p.staff_name, 'غير محدد') AS name,
             SUM(p.amount_egp) AS collected, COUNT(*) AS deals
      FROM payments p
      LEFT JOIN staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid' AND p.staff_id IS NOT NULL${paymentAliasScopeSql}
      GROUP BY p.staff_id ORDER BY collected DESC LIMIT 5
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Revenue by payment method this month ───────────────────────────
    const [byMethod] = await pool.query(`
      SELECT COALESCE(payment_method,'غير محدد') AS method,
             SUM(amount_egp) AS revenue
      FROM payments
      WHERE tenant_id=? AND date >= ? AND status='paid'${paymentScopeSql}
      GROUP BY payment_method ORDER BY revenue DESC
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Expense by category this month ────────────────────────────────
    const [byCategory] = await pool.query(`
      SELECT category, SUM(amount_egp) AS total
      FROM expenses
      WHERE tenant_id=? AND deleted_at IS NULL AND date >= ?${expenseScopeSql}
      GROUP BY category ORDER BY total DESC
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Budget utilization ─────────────────────────────────────────────
    const curMonthLabel = today.slice(0, 7);
    const budgetBranchId = scope.branchId || 'branch-all';
    const [budgets] = await pool.query(`
      SELECT category, budgeted_amount AS limit_amount
      FROM budgets WHERE tenant_id=? AND branch_id=? AND month = ?
    `, [req.tenantId, budgetBranchId, curMonthLabel]);

    // ── Cross-section: Leads ───────────────────────────────────────────
    const [[leadsConverted]] = await pool.query(`
      SELECT COUNT(*) AS n FROM leads
      WHERE tenant_id=? AND status='converted' AND created_at>=? AND created_at<?
        ${scope.branchId ? 'AND branch_id=?' : ''}
    `, scope.branchId
      ? [req.tenantId, monthStart, currentMonth.endDate, scope.branchId]
      : [req.tenantId, monthStart, currentMonth.endDate]);
    const [[leadsTotal]] = await pool.query(`
      SELECT COUNT(*) AS n FROM leads
      WHERE tenant_id=? AND created_at>=? AND created_at<?
        ${scope.branchId ? 'AND branch_id=?' : ''}
    `, scope.branchId
      ? [req.tenantId, monthStart, currentMonth.endDate, scope.branchId]
      : [req.tenantId, monthStart, currentMonth.endDate]);

    // ── Cross-section: posted payroll expense this month ───────────────
    // The ledger is authoritative here. Summing payroll_items.net_salary
    // included unapproved/cancelled runs and omitted employer/statutory cost.
    const [[payrollCost]] = await pool.query(`
      SELECT COALESCE(SUM(jel.debit-jel.credit), 0) AS v
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.ref_type='payroll'
        AND je.entry_date>=? AND je.entry_date<?
        AND jel.account_code='5100'
        ${scope.branchId ? 'AND je.branch_id=?' : ''}
    `, scope.branchId
      ? [req.tenantId, monthStart, currentMonth.endDate, scope.branchId]
      : [req.tenantId, monthStart, currentMonth.endDate]);

    // ── Cross-section: Daqqi revenue this month ────────────────────────
    const [[daqqiRev]] = await pool.query(`
      SELECT COALESCE(SUM(p.amount_egp),0) AS v
      FROM payments p
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid' AND p.source='daqqi'${paymentAliasScopeSql}
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Alerts ─────────────────────────────────────────────────────────
    const [[pendingProofs]] = await pool.query(
      `SELECT COUNT(*) AS n FROM payment_proofs WHERE tenant_id=? AND status='pending'${paymentScopeSql}`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );
    const [[pendingReviews]] = await pool.query(
      `SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND status='pending'${paymentScopeSql}`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );
    const [[overdueInst]] = await pool.query(`
      SELECT COUNT(*) AS n
        FROM installment_plans ip
        JOIN subscribers s ON s.id=ip.subscriber_id AND s.tenant_id=ip.tenant_id
       WHERE ip.tenant_id=? AND ip.status IN ('active','overdue')
         AND CAST(JSON_UNQUOTE(JSON_EXTRACT(
               ip.due_dates,CONCAT('$[',COALESCE(ip.paid_count,0),']')
             )) AS DATE)<CURDATE()
         ${scope.branchId ? 'AND s.branch_id=?' : ''}
    `, scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]);
    const [[openTickets]] = await pool.query(
      `SELECT COUNT(*) AS n FROM support_tickets WHERE tenant_id=? AND status='open'${paymentScopeSql}`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );

    // ── Financial health score (0-100) ─────────────────────────────────
    const mRev = parseFloat(monthRev.v) || 0;
    const mExp = parseFloat(monthExp.v) || 0;
    const profitMargin = mRev > 0 ? (mRev - mExp) / mRev : 0;
    const revenueGrowth = parseFloat(prevRev.v) > 0 ? (mRev - parseFloat(prevRev.v)) / parseFloat(prevRev.v) : 0;
    const alertPenalty = (pendingProofs.n + pendingReviews.n + overdueInst.n) * 2;
    const healthScore = Math.max(0, Math.min(100, Math.round(
      40 * Math.min(1, Math.max(0, profitMargin)) +   // profit margin contributes up to 40
      30 * Math.min(1, Math.max(0, 0.5 + revenueGrowth)) + // growth contributes up to 30
      20 * (mRev > 0 ? 1 : 0) +                          // has revenue → 20
      10 - alertPenalty                                    // penalty for alerts
    )));

    res.json({
      revenue: {
        today: parseFloat(todayRev.v) || 0,
        week:  parseFloat(weekRev.v)  || 0,
        month: mRev,
        prevMonth: parseFloat(prevRev.v) || 0,
        monthChangePercent: parseFloat(prevRev.v) > 0 ? Math.round(((mRev - parseFloat(prevRev.v)) / parseFloat(prevRev.v)) * 100) : null,
        forecast,
        dayOfMonth,
        daysInMonth,
      },
      expenses: {
        month: mExp,
        byCategory: byCategory.map(r => ({ category: r.category, total: parseFloat(r.total) || 0 })),
      },
      netProfit: { month: mRev - mExp, margin: mRev > 0 ? Math.round(((mRev - mExp) / mRev) * 100) : 0 },
      trend12: trend12.map(r => ({ month: r.month, revenue: parseFloat(r.revenue) || 0, txnCount: r.txn_count })),
      topCourses: topCourses.map(r => ({ name: r.name, revenue: parseFloat(r.revenue) || 0, cnt: r.cnt })),
      topStaff: topStaff.map(r => ({ name: r.name, collected: parseFloat(r.collected) || 0, deals: r.deals })),
      byMethod: byMethod.map(r => ({ method: r.method, revenue: parseFloat(r.revenue) || 0 })),
      budgets: budgets.map(r => ({ category: r.category, limit: parseFloat(r.limit_amount) || 0 })),
      crossSection: {
        leadsConverted: leadsConverted.n,
        leadsTotal: leadsTotal.n,
        conversionRate: leadsTotal.n > 0 ? Math.round((leadsConverted.n / leadsTotal.n) * 100) : 0,
        payrollCost: parseFloat(payrollCost.v) || 0,
        daqqiRevenue: parseFloat(daqqiRev.v) || 0,
      },
      alerts: {
        pendingProofs: pendingProofs.n,
        pendingReviews: pendingReviews.n,
        overdueInstallments: overdueInst.n,
        openTickets: openTickets.n,
        total: pendingProofs.n + pendingReviews.n + overdueInst.n,
      },
      healthScore,
      scope: { branch: scope.branch, branchId: scope.branchId },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[finance/cockpit]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── BUDGET MANAGEMENT ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/finance/budgets', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const budgetBranchId = scope.branchId || 'branch-all';
    const month = req.query.month || dateOnlyInTimeZone().slice(0, 7);
    const range = monthRange(month);
    if (!range) return res.status(400).json({ error: 'Valid month is required' });
    const [rows] = await pool.query(
      `SELECT id, branch, branch_id, category, budgeted_amount AS limit_amount, month AS period_label, notes
       FROM budgets WHERE tenant_id=? AND branch_id=? AND month=? ORDER BY category`,
      [req.tenantId, budgetBranchId, month]
    );

    // Also get current month spending per category
    const monthStart = range.startDate;
    const monthEnd = range.endDate;
    const [spending] = await pool.query(
      `SELECT e.category,COALESCE(SUM(jel.debit-jel.credit),0) AS spent
         FROM expenses e
         JOIN journal_entries je ON je.tenant_id=e.tenant_id
          AND je.ref_type='expense' AND je.ref_id=e.id
         JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code LIKE '5%'
        WHERE e.tenant_id=? AND e.deleted_at IS NULL AND je.entry_date >= ? AND je.entry_date < ?
          ${scope.branchId ? 'AND je.branch_id=?' : ''}
        GROUP BY e.category`,
      scope.branchId
        ? [req.tenantId, monthStart, monthEnd, scope.branchId]
        : [req.tenantId, monthStart, monthEnd]
    );
    const spendMap = {};
    for (const s of spending) spendMap[s.category] = parseFloat(s.spent) || 0;

    res.json(rows.map(r => ({
      id: r.id,
      category: r.category,
      limit: parseFloat(r.limit_amount) || 0,
      spent: spendMap[r.category] || 0,
      remaining: Math.max(0, (parseFloat(r.limit_amount) || 0) - (spendMap[r.category] || 0)),
      utilizationPct: parseFloat(r.limit_amount) > 0 ? Math.round(((spendMap[r.category] || 0) / parseFloat(r.limit_amount)) * 100) : 0,
      notes: r.notes || '',
    })));
  } catch (e) {
    logger.error('[finance/budgets GET]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.put('/api/admin/finance/budgets', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { month, budgets, branch } = req.body;
    const scope = resolveFinancialScope(req, { requestedBranch: branch || null });
    const budgetBranch = scope.branch || null;
    const budgetBranchId = scope.branchId || 'branch-all';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) || !Array.isArray(budgets)) return res.status(400).json({ error: 'Valid month and budgets[] required' });
    const { uuidv4: uid } = require('../lib/id');
    const normalized = [];
    const categories = new Set();
    for (const b of budgets) {
      const limitAmount = b.limit ?? b.limit_amount ?? b.budgeted_amount;
      const numericLimit = Number(limitAmount);
      const category = String(b.category || '').trim().slice(0, 255);
      const currency = String(b.currency || 'EGP').toUpperCase();
      if (!category || categories.has(category) || currency !== 'EGP'
        || !Number.isFinite(numericLimit) || numericLimit < 0 || numericLimit > 100000000) {
        return res.status(400).json({ error: 'Invalid budget row' });
      }
      categories.add(category);
      normalized.push({ ...b, category, numericLimit, currency });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const [oldRows] = await conn.query(
      `SELECT category,budgeted_amount,currency,notes FROM budgets
        WHERE tenant_id=? AND branch_id=? AND month=? FOR UPDATE`,
      [req.tenantId, budgetBranchId, month],
    );
    for (const b of normalized) {
      await conn.query(
        `INSERT INTO budgets (id, tenant_id, branch, branch_id, month, category, budgeted_amount, currency, notes)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE budgeted_amount=VALUES(budgeted_amount), currency=VALUES(currency), notes=VALUES(notes)`,
        [uid(), req.tenantId, budgetBranch, budgetBranchId, month, b.category, b.numericLimit, b.currency, b.notes || null]
      );
    }
    await logFinancialAudit({
      entityType: 'budget',
      entityId: `${budgetBranchId}:${month}`,
      action: 'upsert',
      oldData: oldRows,
      newData: normalized.map(({ category, numericLimit, currency, notes }) => ({
        category, budgeted_amount: numericLimit, currency, notes: notes || null,
      })),
      actor: req.user?.email || req.user?.uid || 'system',
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) try { await conn.rollback(); } catch (_) {}
    logger.error('[finance/budgets PUT]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});

// ── Refund requests list & status update ──────────────────────────────────
router.get('/api/admin/finance/refunds', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.query.branch || null,
      allowAssigned: true,
    });
    let scopeSql = '';
    const scopeParams = [];
    if (scope.branchId) {
      scopeSql = ' AND rr.branch_id=?';
      scopeParams.push(scope.branchId);
    } else if (scope.kind === 'assigned_cs') {
      scopeSql = ' AND s.assigned_cs_id=?';
      scopeParams.push(scope.staffId);
    } else if (scope.kind === 'assigned_sales') {
      scopeSql = ' AND s.assigned_sales_id=?';
      scopeParams.push(scope.staffId);
    }
    const [rows] = await pool.query(`
      SELECT rr.*, rr.admin_note AS admin_notes, rr.resolved_by AS handled_by,
             rr.resolved_at AS handled_at, s.name AS subscriber_name, s.email AS subscriber_email,
             st.name AS handler_name
      FROM refund_requests rr
      LEFT JOIN subscribers s ON s.id = rr.subscriber_id AND s.tenant_id=rr.tenant_id
      LEFT JOIN staff st ON st.id = rr.resolved_by AND st.tenant_id=rr.tenant_id
      WHERE rr.tenant_id=?${scopeSql}
      ORDER BY rr.created_at DESC LIMIT 200
    `, [req.tenantId, ...scopeParams]);
    res.json(rows);
  } catch (e) {
    logger.error('[finance/refunds]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.put('/api/admin/finance/refunds/:id', requireAuth, requireAdminOrStaff, requirePermission('approve_refunds'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.body?.branch || null,
      allowAssigned: true,
    });
    const { status, notes } = req.body;
    const normalizedStatus = String(status || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(normalizedStatus))
      return res.status(400).json({ error: 'invalid status' });
    const actor = req.staffRecord?.name || req.user?.email || 'admin';
    const tenantId = req.tenantId;
    await conn.beginTransaction();

    const [[rr]] = await conn.query(
      `SELECT rr.*, s.name AS subscriber_name, s.email AS subscriber_email,
              s.assigned_cs_id, s.assigned_sales_id
       FROM refund_requests rr
       LEFT JOIN subscribers s ON s.id = rr.subscriber_id AND s.tenant_id=rr.tenant_id
       WHERE rr.id = ? AND rr.tenant_id=? FOR UPDATE`,
      [req.params.id, tenantId]
    );
    if (!rr) {
      await conn.rollback();
      return res.status(404).json({ error: 'Refund request not found' });
    }
    if (!financialRecordMatches(scope, rr)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Refund request not found' });
    }
    if (String(rr.status || '').toUpperCase() !== 'PENDING') {
      await conn.rollback();
      return res.status(409).json({ error: 'Refund request has already been resolved' });
    }
    if (normalizedStatus === 'APPROVED' && !rr.payment_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'A refund cannot be approved without a linked payment' });
    }

    await conn.query(
      `UPDATE refund_requests SET status=?, admin_note=?, resolved_by=?, resolved_at=NOW() WHERE id=? AND tenant_id=?`,
      [normalizedStatus, notes || null, req.staffRecord?.id || req.user?.email || null, req.params.id, tenantId]
    );

    if (normalizedStatus === 'APPROVED' && rr.payment_id) {
      await applyRefundReversal({
        paymentId: rr.payment_id,
        subscriberId: rr.subscriber_id,
        refundAmount: rr.amount,
        refundCurrency: rr.currency,
        tenantId,
        actor,
      }, conn);
    }

    await logFinancialAudit({
      entityType: 'refund_request',
      entityId: req.params.id,
      action: normalizedStatus === 'APPROVED' ? 'approved' : 'rejected',
      oldData: { status: rr.status, payment_id: rr.payment_id || null },
      newData: { status: normalizedStatus, notes: notes || null },
      amount: rr.amount,
      actor,
      tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('[finance/refunds PUT]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
