'use strict';

const crypto = require('node:crypto');

const CURRENCIES = new Set(['EGP', 'SAR', 'USD']);
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const money = (value, { allowZero = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0) || number > 100000000) {
    throw Object.assign(new Error('Invalid monetary amount'), { statusCode: 400 });
  }
  return Number(number.toFixed(2));
};
const signedMoney = value => {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 100000000) {
    throw Object.assign(new Error('Invalid signed monetary amount'), { statusCode: 400 });
  }
  return Number(number.toFixed(2));
};
const currency = value => {
  const normalized = String(value || '').toUpperCase();
  if (!CURRENCIES.has(normalized)) {
    throw Object.assign(new Error('Unsupported currency'), { statusCode: 400 });
  }
  return normalized;
};
const actor = req => String(req.staffRecord?.id || req.user?.email || req.user?.uid || 'system');
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function buildCloseChecklist(db, tenantId, period) {
  const year = Number(String(period.period_label).slice(0, 4));
  const month = Number(String(period.period_label).slice(5, 7));
  const startDate = `${period.period_label}-01`;
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const [[counts]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM payments p
         WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
           AND p.date>=? AND p.date<?
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
             WHERE je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id)) AS paid_without_journal,
       (SELECT COUNT(*) FROM payments p
         WHERE p.tenant_id=? AND p.status='pending' AND p.deleted_at IS NULL
           AND p.date>=? AND p.date<?) AS pending_payments,
       (SELECT COUNT(*) FROM finance_outbox fo
         WHERE fo.tenant_id=? AND fo.status IN ('failed','dead')) AS failed_finance_events,
       (SELECT COUNT(*) FROM accounts_payable_invoices api
         WHERE api.tenant_id=? AND api.status='draft' AND api.invoice_date>=? AND api.invoice_date<?) AS draft_payables,
       (SELECT COUNT(*) FROM bank_reconciliations br
         WHERE br.tenant_id=? AND br.period_end>=? AND br.period_end<?
           AND br.status<>'approved') AS unapproved_bank_reconciliations,
       (SELECT COUNT(*) FROM (
          SELECT je.id FROM journal_entries je
          JOIN journal_entry_lines jel ON jel.entry_id=je.id
          WHERE je.tenant_id=? AND je.entry_date>=? AND je.entry_date<?
          GROUP BY je.id,je.total_debit,je.total_credit
          HAVING ABS(SUM(jel.debit)-SUM(jel.credit))>=0.01
             OR ABS(je.total_debit-je.total_credit)>=0.01
        ) broken) AS unbalanced_journals`,
    [
      tenantId, startDate, endDate,
      tenantId, startDate, endDate,
      tenantId,
      tenantId, startDate, endDate,
      tenantId, startDate, endDate,
      tenantId, startDate, endDate,
    ]
  );
  const items = Object.entries(counts).map(([key, value]) => ({
    key,
    count: Number(value) || 0,
    blocking: Number(value) > 0,
  }));
  return { period: period.period_label, startDate, endDate, items, ready: items.every(item => !item.blocking) };
}

module.exports = { actor, buildCloseChecklist, currency, dateOnly, money, sha256, signedMoney };
