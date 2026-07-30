#!/usr/bin/env node
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../lib/db');

const API = String(process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const accounts = {
  creator: 'uat.accountant@mahad.test',
  approver: 'uat.manager@mahad.test',
  payer: 'uat.admin@mahad.test',
  student: 'uat.student@mahad.test',
};

async function request(path, { token, method = 'GET', body, expected = [200] } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} expected ${expected.join('/')} got ${response.status}: ${text.slice(0, 500)}`);
  }
  return { status: response.status, data };
}

async function login(email) {
  const { data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  if (!data?.token) throw new Error(`No token returned for ${email}`);
  return data.token;
}

(async () => {
  try {
    const tokens = {};
    for (const [role, email] of Object.entries(accounts)) tokens[role] = await login(email);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const riskOrderId = crypto.randomUUID();
    const riskProofId = `pp-risk-${crypto.randomUUID()}`;
    await pool.query(
      `INSERT INTO orders
         (id,subscriber_id,item_id,item_title,type,status,amount,currency,payment_method,
          customer_name,customer_email,customer_phone,tenant_id,branch_id,created_at)
       VALUES (?,'uat-student-client','risk-review','Sensitive manual review','OTHER','pending',
               50000,'EGP','TRANSFER','UAT Student','uat.student@mahad.test','01000000000',
               'tenant-default','branch-online-egypt',NOW())`,
      [riskOrderId]
    );
    await pool.query(
      `INSERT INTO payment_proofs
         (id,order_id,subscriber_id,item_type,amount,currency,payment_method,status,tenant_id,branch_id,
          review_due_at,risk_level,second_review_required)
       VALUES (?,?,'uat-student-client','other',50000,'EGP','bank_transfer','PENDING',
               'tenant-default','branch-online-egypt',DATE_ADD(NOW(),INTERVAL 4 HOUR),'high',1)`,
      [riskProofId, riskOrderId]
    );
    const firstProofReview = await request(`/api/admin/payment-proofs/${riskProofId}`, {
      token: tokens.creator,
      method: 'PATCH',
      body: { action: 'approve', reviewer_note: 'Independent approval 1/2' },
    });
    if (!firstProofReview.data.pendingSecondApproval || firstProofReview.data.status !== 'PENDING') {
      throw new Error('Sensitive proof did not stop after the first approval');
    }
    await request(`/api/admin/payment-proofs/${riskProofId}`, {
      token: tokens.creator,
      method: 'PATCH',
      body: { action: 'approve' },
      expected: [409],
    });
    await request(`/api/admin/payment-proofs/${riskProofId}`, {
      token: tokens.approver,
      method: 'PATCH',
      body: { action: 'reject', reviewer_note: 'UAT cleanup after SOD evidence' },
    });
    const [[linkCourse]] = await pool.query(
      `SELECT id,title,price_egp FROM courses
        WHERE tenant_id='tenant-default' AND deleted_at IS NULL AND price_egp>0
        ORDER BY created_at DESC LIMIT 1`
    );
    if (!linkCourse) throw new Error('No EGP course available for payment-link smoke');
    const paymentLink = await request('/api/admin/payment-links', {
      token: tokens.creator,
      method: 'POST',
      body: {
        item_type: 'course',
        item_id: linkCourse.id,
        amount: Number(linkCourse.price_egp),
        currency: 'EGP',
        subscriber_id: 'uat-student-client',
        description: 'UAT single-use payment link',
        expires_days: 1,
        branch: 'ONLINE_EGYPT',
      },
    });
    const publicLink = await request(`/api/payment-links/${paymentLink.data.token}`);
    if (publicLink.data?.pl?.token || publicLink.data?.pl?.used_at || publicLink.data?.item?.id !== linkCourse.id) {
      throw new Error('Public payment link validation leaked token or returned a wrong item');
    }
    const redemption = await request('/api/public/checkout-intent', {
      token: tokens.student,
      method: 'POST',
      body: {
        itemId: linkCourse.id,
        itemType: 'course',
        itemTitle: linkCourse.title,
        customerName: 'UAT Student',
        customerEmail: accounts.student,
        customerPhone: '01000000000',
        paymentLinkToken: paymentLink.data.token,
      },
    });
    await request('/api/public/checkout-intent', {
      token: tokens.student,
      method: 'POST',
      body: {
        itemId: linkCourse.id,
        itemType: 'course',
        itemTitle: linkCourse.title,
        customerName: 'UAT Student',
        customerEmail: accounts.student,
        customerPhone: '01000000000',
        paymentLinkToken: paymentLink.data.token,
      },
      expected: [409],
    });
    const [[consumedLink]] = await pool.query(
      `SELECT used_at,used_by_order_id FROM payment_links
        WHERE id=? AND tenant_id='tenant-default'`,
      [paymentLink.data.id]
    );
    if (!consumedLink?.used_at || consumedLink.used_by_order_id !== redemption.data.orderId) {
      throw new Error('Payment link was not atomically bound to its order');
    }
    const expiredLinkId = crypto.randomUUID();
    const expiredToken = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO payment_links
         (id,tenant_id,branch,branch_id,token,item_type,item_id,amount,currency,subscriber_id,
          description,expires_at,created_by)
       VALUES (?,'tenant-default','ONLINE_EGYPT','branch-online-egypt',?,'course',?,?, 'EGP',
               'uat-student-client','UAT expired link',DATE_SUB(NOW(),INTERVAL 1 MINUTE),'uat-smoke')`,
      [expiredLinkId, expiredToken, linkCourse.id, Number(linkCourse.price_egp)]
    );
    await request(`/api/payment-links/${expiredToken}`, { expected: [410] });
    const assumption = await request('/api/admin/finance/forecast-assumptions', {
      token: tokens.creator,
      method: 'POST',
      body: {
        direction: 'inflow',
        category: 'uat',
        label: `UAT forecast ${suffix}`,
        amount: 1000,
        currency: 'EGP',
        cadence: 'one_time',
        start_date: today,
        confidence_pct: 80,
        branch: 'ONLINE_EGYPT',
      },
      expected: [201],
    });
    const forecast = await request(`/api/admin/finance/cash-flow-forecast?start=${today}&branch=ONLINE_EGYPT`, {
      token: tokens.creator,
    });
    if (forecast.data?.weeks?.length !== 13
      || !forecast.data.weeks.some(week => week.sources?.some(source => source.id === assumption.data.id && source.amount === 800))) {
      throw new Error('13-week cash-flow forecast did not include the confidence-weighted assumption');
    }

    const vendor = await request('/api/admin/finance/vendors', {
      token: tokens.creator,
      method: 'POST',
      body: { name: `UAT Vendor ${suffix}`, currency: 'EGP', payment_terms_days: 10 },
      expected: [201],
    });
    const payable = await request('/api/admin/finance/payables', {
      token: tokens.creator,
      method: 'POST',
      body: {
        vendor_id: vendor.data.id,
        branch: 'ONLINE_EGYPT',
        invoice_number: `UAT-AP-${suffix}`,
        invoice_date: today,
        due_date: due,
        currency: 'EGP',
        subtotal: 250,
        tax_amount: 35,
        expense_account_code: '5900',
      },
      expected: [201],
    });
    await request(`/api/admin/finance/payables/${payable.data.id}/approve`, {
      token: tokens.creator,
      method: 'POST',
      expected: [409],
    });
    const approval = await request(`/api/admin/finance/payables/${payable.data.id}/approve`, {
      token: tokens.approver,
      method: 'POST',
    });
    if (!approval.data.journal_entry_id) throw new Error('AP approval did not post an accrual journal');
    await request(`/api/admin/finance/payables/${payable.data.id}/payments`, {
      token: tokens.approver,
      method: 'POST',
      body: { payment_date: today, amount: 285, reference: `SOD-${suffix}` },
      expected: [409],
    });
    const payment = await request(`/api/admin/finance/payables/${payable.data.id}/payments`, {
      token: tokens.payer,
      method: 'POST',
      body: { payment_date: today, amount: 285, reference: `UAT-PAY-${suffix}`, bank_account_code: '1100' },
      expected: [201],
    });
    if (payment.data.status !== 'paid' || Number(payment.data.remaining) !== 0) {
      throw new Error(`AP payment did not settle invoice: ${JSON.stringify(payment.data)}`);
    }

    const accountCode = `1${String(Date.now()).slice(-8)}`;
    await pool.query(
      `INSERT INTO tenant_chart_of_accounts (tenant_id,code,name,type,is_active)
       VALUES ('tenant-default',?,?,'asset',1)`,
      [accountCode, `UAT reconciliation ${suffix}`]
    );
    const reconciliation = await request('/api/admin/finance/bank-reconciliations', {
      token: tokens.creator,
      method: 'POST',
      body: {
        account_code: accountCode,
        period_start: today,
        period_end: today,
        opening_balance: -100,
        statement_closing_balance: -100,
      },
      expected: [201],
    });
    if (Number(reconciliation.data.difference_amount) !== 0) {
      throw new Error('Zero-movement bank reconciliation should have zero difference');
    }
    await request(`/api/admin/finance/bank-reconciliations/${reconciliation.data.id}/approve`, {
      token: tokens.creator,
      method: 'POST',
      expected: [409],
    });
    const bankApproval = await request(`/api/admin/finance/bank-reconciliations/${reconciliation.data.id}/approve`, {
      token: tokens.approver,
      method: 'POST',
    });
    if (bankApproval.data.status !== 'approved') throw new Error('Bank reconciliation was not approved');

    const [usedPeriods] = await pool.query(
      "SELECT period_label FROM accounting_periods WHERE tenant_id='tenant-default'"
    );
    const usedLabels = new Set(usedPeriods.map(row => row.period_label));
    let periodLabel;
    for (let year = 1990; year <= 2090 && !periodLabel; year++) {
      for (let month = 1; month <= 12; month++) {
        const candidate = `${year}-${String(month).padStart(2, '0')}`;
        if (!usedLabels.has(candidate)) { periodLabel = candidate; break; }
      }
    }
    if (!periodLabel) throw new Error('No unused accounting period label is available for smoke');
    const period = await request('/api/admin/accounting-periods', {
      token: tokens.creator,
      method: 'POST',
      body: { label: periodLabel },
    });
    const closeRequest = await request(`/api/admin/accounting-periods/${period.data.id}/close-request`, {
      token: tokens.creator,
      method: 'POST',
      body: { note: `UAT close ${suffix}` },
      expected: [201],
    });
    await request(`/api/admin/accounting-periods/${period.data.id}/close-request/${closeRequest.data.id}/review`, {
      token: tokens.creator,
      method: 'POST',
      body: { decision: 'approve' },
      expected: [409],
    });
    await request(`/api/admin/accounting-periods/${period.data.id}/close-request/${closeRequest.data.id}/review`, {
      token: tokens.approver,
      method: 'POST',
      body: { decision: 'approve', note: 'Independent UAT review' },
    });
    await request(`/api/admin/accounting-periods/${period.data.id}/close`, {
      token: tokens.approver,
      method: 'POST',
      expected: [409],
    });
    await request(`/api/admin/accounting-periods/${period.data.id}/close`, {
      token: tokens.payer,
      method: 'POST',
    });
    const [[closedPeriod]] = await pool.query(
      `SELECT p.status,r.status AS request_status
         FROM accounting_periods p JOIN accounting_close_requests r ON r.period_id=p.id AND r.tenant_id=p.tenant_id
        WHERE p.id=? AND p.tenant_id='tenant-default'`,
      [period.data.id]
    );
    if (closedPeriod?.status !== 'closed' || closedPeriod?.request_status !== 'consumed') {
      throw new Error(`Period close evidence mismatch: ${JSON.stringify(closedPeriod)}`);
    }

    const [[journalEvidence]] = await pool.query(
      `SELECT COUNT(DISTINCT je.id) AS journals,ROUND(SUM(jel.debit),2) AS debit,ROUND(SUM(jel.credit),2) AS credit
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id='tenant-default'
          AND je.ref_type IN ('accounts_payable_accrual','accounts_payable_payment')
          AND (je.ref_id=? OR je.ref_id=?)`,
      [payable.data.id, payment.data.id]
    );
    if (Number(journalEvidence.journals) !== 2 || Number(journalEvidence.debit) !== Number(journalEvidence.credit)) {
      throw new Error(`AP journal evidence mismatch: ${JSON.stringify(journalEvidence)}`);
    }
    const currentYear = new Date().getUTCFullYear();
    const liveRange = `from=${currentYear}-01-01&to=${currentYear}-12-31`;
    const documents = await request(`/api/admin/finance/documents?${liveRange}`, {
      token: tokens.creator,
    });
    if (!Array.isArray(documents.data) || documents.data.length === 0) {
      throw new Error('Financial documents endpoint did not return live documents');
    }
    const auditPackage = await request(`/api/admin/finance/audit-package?${liveRange}`, {
      token: tokens.creator,
    });
    const arAging = await request('/api/admin/finance/ar-aging', { token: tokens.creator });
    if (!Array.isArray(arAging.data?.rows) || !arAging.data?.buckets) {
      throw new Error('Accounts receivable aging did not return its canonical contract');
    }
    const { sha256, ...auditPayload } = auditPackage.data || {};
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(auditPayload)).digest('hex');
    if (!sha256 || sha256 !== expectedHash || !auditPayload.journals?.length) {
      throw new Error('Financial audit package integrity check failed');
    }
    console.log(JSON.stringify({
      ok: true,
      payable: { id: payable.data.id, status: payment.data.status, journals: journalEvidence.journals },
      sod: { creatorCannotApprove: true, approverCannotPay: true },
      bank: { id: reconciliation.data.id, signedBalance: true, independentApproval: true },
      close: { period: periodLabel, request: closeRequest.data.id, threeWaySod: true, status: closedPeriod.status },
      auditPackage: { sha256, documents: auditPayload.documents.length, journals: auditPayload.journals.length },
      arAging: { rows: arAging.data.rows.length, serverAuthoritative: true },
      proofReview: { firstApprovalStops: true, sameReviewerBlocked: true, secondReviewerCompletes: true },
      paymentLink: { expires: true, singleUse: true, orderId: redemption.data.orderId },
      forecast: { weeks: forecast.data.weeks.length, assumptionWeighted: true },
    }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
