'use strict';
// Printable receipts and invoices for a payment.
// One part of routes/finance.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  financialRecordMatches,
  resolveFinancialScope,
  logger,
  _loadPaymentForPrint,
} = require('./_shared');

const router = Router();

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

module.exports = router;
