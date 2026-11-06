'use strict';

// GET /api/admin/finance/payments-register — the payments, one page at a time,
// filtered and counted in the database.
//
// «الصفحه نفسها محتاجه تطوير … فلتر كتير، وفي الخدمه والنوع لازم يظهر اسم الخدمه
// صح، رقم لكل عمليه، اسم القائم بالعمليه في عمود لوحده وله فلتر، وفلتر تاريخ،
// ولما اضغط علي اسم العميل يظهر بروفايله».
//
// The accounts screen built this list in the browser from every client's
// payment history and named a payment by its type («كورس») when the history
// had no title. Here every row carries its running number (payments.
// payment_no), the course / track / certificate it paid for by name, who
// recorded it, its channel with the duplicate spellings merged
// (lib/paymentChannels.js), and the client it belongs to.

const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { requireAuth, requireAdminOrStaff, requireAnyPermission } = require('../middleware/auth');
const { financialScopeClause, resolveFinancialScope } = require('../lib/financialScope');
const { canonicalChannel } = require('../lib/paymentChannels');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday, isValidDateOnly } = require('../lib/dates');
const { identitySpellings } = require('../lib/phoneNumber');

const router = express.Router();

const TYPE_LABELS = {
  COURSE: 'كورس', BUNDLE: 'مسار', CERTIFICATE: 'شهادة', CONSULTATION: 'استشارة', BOOK: 'كتاب', CARNEH: 'كارنيه', OTHER: 'أخرى',
};
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const escapeLike = value => String(value).replace(/[\\%_]/g, match => `\\${match}`);

// What the payment was for, by name.
const SERVICE_SQL = `COALESCE(
  CASE p.payment_type
    WHEN 'BUNDLE' THEN b.title
    WHEN 'CERTIFICATE' THEN COALESCE(NULLIF(p.item_title, ''), CONCAT('شهادة ', NULLIF(p.cert_type, '')))
    ELSE NULL END,
  NULLIF(c.title_ar, ''), NULLIF(c.title, ''), NULLIF(b.title, ''), NULLIF(p.item_title, ''))`;

router.get('/api/admin/finance/payments-register', requireAuth, requireAdminOrStaff,
  requireAnyPermission('view_financial', 'view_orders'), async (req, res) => {
    try {
      const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null, allowAssigned: true });
      const scopeClause = financialScopeClause(scope, { branchColumn: 'p.branch_id', subscriberAlias: 's' });
      if (scopeClause.sql === ' AND 1=0') return res.json({ rows: [], total: 0, totalEgp: 0, facets: { channels: [], staff: [], types: [] } });
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);
      const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
      const status = ['paid', 'pending', 'refunded', 'failed', 'all'].includes(req.query.status) ? req.query.status : 'paid';
      // «ترتيب أرقام العمليات»: each branch's receipts in their own order (1, 2, 3…), then the rest by their running number, instead of by date.
      const byNumber = req.query.sort === 'number';

      // The range and the scope define the population the facets describe;
      // the other filters narrow the rows within it.
      let base = ' AND p.deleted_at IS NULL';
      const baseParams = [];
      if (status !== 'all') { base += ' AND p.status = ?'; baseParams.push(status); }
      // Cairo days: the instants Cairo's midnights fall on, not UTC midnights (see lib/financeStatement.js).
      if (isDate(req.query.from) && isValidDateOnly(req.query.from)) { base += ' AND p.date >= ?'; baseParams.push(cairoDayStartUtc(req.query.from)); }
      if (isDate(req.query.to) && isValidDateOnly(req.query.to)) { base += ' AND p.date < ?'; baseParams.push(cairoDayStartUtc(addDaysToDateOnly(req.query.to, 1))); }
      base += scopeClause.sql; baseParams.push(...scopeClause.params);

      const from = `FROM payments p
        LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
        LEFT JOIN bundles b ON b.id = p.bundle_id AND b.tenant_id = p.tenant_id
        LEFT JOIN staff st ON st.id = p.staff_id AND st.tenant_id = p.tenant_id`;

      // Facets: every raw method in range, merged to its channel here.
      const [[methodRows], [staffRows], [typeRows]] = await Promise.all([
        pool.query(`SELECT p.payment_method AS method, COUNT(*) AS cnt, COALESCE(SUM(p.amount_egp), 0) AS egp
                      ${from} WHERE p.tenant_id = ?${base} GROUP BY p.payment_method`, [req.tenantId, ...baseParams]),
        pool.query(`SELECT COALESCE(p.staff_id, '') AS id, COALESCE(MAX(st.name), MAX(p.staff_name), '') AS name, COUNT(*) AS cnt
                      ${from} WHERE p.tenant_id = ?${base} GROUP BY COALESCE(p.staff_id, '')`, [req.tenantId, ...baseParams]),
        pool.query(`SELECT COALESCE(p.payment_type, 'OTHER') AS type, COUNT(*) AS cnt
                      ${from} WHERE p.tenant_id = ?${base} GROUP BY COALESCE(p.payment_type, 'OTHER')`, [req.tenantId, ...baseParams]),
      ]);
      const channels = new Map();
      for (const row of methodRows) {
        const name = canonicalChannel(row.method);
        const entry = channels.get(name) || { channel: name, count: 0, amountEgp: 0, methods: [] };
        entry.count += Number(row.cnt); entry.amountEgp += Number(row.egp); entry.methods.push(row.method);
        channels.set(name, entry);
      }

      let where = base;
      const params = [...baseParams];
      // A box opened from elsewhere arrives by its raw name; it is the channel it belongs to.
      const channel = String(req.query.channel || '').trim() || (req.query.method ? canonicalChannel(req.query.method) : '');
      if (channel) {
        const methods = channels.get(channel)?.methods || [];
        const named = methods.filter(method => method !== null);
        const parts = [];
        if (named.length) { parts.push('p.payment_method IN (?)'); params.push(named); }
        if (methods.includes(null)) parts.push('p.payment_method IS NULL');
        where += parts.length ? ` AND (${parts.join(' OR ')})` : ' AND 1=0';
      }
      if (req.query.type && TYPE_LABELS[String(req.query.type).toUpperCase()]) {
        where += String(req.query.type).toUpperCase() === 'OTHER' ? " AND (p.payment_type = 'OTHER' OR p.payment_type IS NULL)" : ' AND p.payment_type = ?';
        if (String(req.query.type).toUpperCase() !== 'OTHER') params.push(String(req.query.type).toUpperCase());
      }
      if (req.query.staff === '__none__') where += ' AND p.staff_id IS NULL';
      else if (req.query.staff) { where += ' AND p.staff_id = ?'; params.push(String(req.query.staff)); }
      const q = String(req.query.q || '').trim();
      if (q) {
        const digits = q.replace(/\D/g, '');
        const like = `%${escapeLike(q)}%`;
        const clauses = ['s.name LIKE ?', 's.client_code LIKE ?', 'p.transaction_id LIKE ?', 'p.sender_name LIKE ?', 'p.from_account LIKE ?', 'p.item_title LIKE ?', 'c.title LIKE ?', 'c.title_ar LIKE ?', 'b.title LIKE ?'];
        const values = [like, like, like, like, like, like, like, like, like];
        // «#1234» or a bare number is the operation number.
        if (/^#?\d+$/.test(q)) { clauses.push('(p.payment_no = ? OR p.receipt_no = ?)'); values.push(Number(digits), Number(digits)); }
        if (digits.length >= 8) { clauses.push('s.phone IN (?)'); values.push([...new Set([digits, ...identitySpellings(digits)])]); }
        where += ` AND (${clauses.join(' OR ')})`;
        params.push(...values);
      }

      const [[[totals]], [rows]] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(p.amount_egp), 0) AS egp ${from} WHERE p.tenant_id = ?${where}`, [req.tenantId, ...params])
          .then(([result]) => [result]),
        pool.query(
          `SELECT p.id, p.payment_no, p.receipt_no, p.date, p.created_at, p.amount, p.currency, p.amount_egp, p.payment_type, p.payment_method,
                  p.transaction_id, p.from_account, p.sender_name, p.proof_url, p.status, p.note, p.source, p.is_installment, p.branch,
                  ${SERVICE_SQL} AS service,
                  p.subscriber_id, s.name AS client_name, s.client_code, s.phone AS client_phone,
                  p.staff_id, COALESCE(st.name, NULLIF(p.staff_name, '')) AS staff_name
             ${from}
            WHERE p.tenant_id = ?${where}
            ORDER BY ${byNumber ? 'CASE WHEN p.receipt_no IS NULL THEN 1 ELSE 0 END, p.branch ASC, COALESCE(p.receipt_no, p.payment_no) ASC' : 'p.date DESC, p.payment_no DESC'}
            LIMIT ? OFFSET ?`,
          [req.tenantId, ...params, pageSize, page * pageSize]),
      ]);

      res.json({
        rows: rows.map(r => ({
          id: r.id,
          // Dokki and Tagamoa receipts carry their branch's own running number (lib/receiptNumbers.js);
          // every other payment keeps the institute-wide one.
          number: r.receipt_no != null ? Number(r.receipt_no) : (r.payment_no != null ? Number(r.payment_no) : null),
          receiptBranch: r.receipt_no != null ? (r.branch === 'TAGAMOA' ? 'التجمع' : 'الدقي') : null,
          branch: r.branch || null,
          operationNo: r.payment_no != null ? Number(r.payment_no) : null,
          date: r.date,
          amount: Number(r.amount),
          currency: r.currency,
          amountEgp: r.amount_egp != null ? Number(r.amount_egp) : null,
          type: r.payment_type || 'OTHER',
          typeLabel: TYPE_LABELS[r.payment_type] || 'أخرى',
          service: r.service || TYPE_LABELS[r.payment_type] || 'دفعة',
          channel: canonicalChannel(r.payment_method),
          rawMethod: r.payment_method,
          transactionId: r.transaction_id,
          // The transfer as the desk typed it: who sent it and from which number/account.
          senderName: r.sender_name || null,
          fromAccount: r.from_account || null,
          // The client's transfer screenshot on Google Drive, when they uploaded one.
          proofUrl: r.proof_url || null,
          status: r.status,
          installment: Boolean(r.is_installment),
          note: r.note,
          online: r.source === 'paymob' || /paymob/i.test(String(r.payment_method || '')),
          client: { id: r.subscriber_id, name: r.client_name, code: r.client_code, phone: r.client_phone },
          recordedBy: r.staff_name || (r.source === 'paymob' ? 'دفع أونلاين (Paymob)' : null),
          staffId: r.staff_id,
        })),
        total: Number(totals?.total || 0),
        totalEgp: Number(totals?.egp || 0),
        page,
        pageSize,
        facets: {
          channels: [...channels.values()].map(({ methods, ...entry }) => entry).sort((a, b) => b.count - a.count),
          staff: staffRows.map(r => ({ id: r.id || '__none__', name: r.id ? (r.name || 'غير معروف') : 'بدون موظف', count: Number(r.cnt) }))
            .sort((a, b) => b.count - a.count),
          types: typeRows.map(r => ({ type: r.type, label: TYPE_LABELS[r.type] || 'أخرى', count: Number(r.cnt) })),
        },
      });
    } catch (e) {
      logger.error('[payments-register]', e.message);
      res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
    }
  });

// GET /api/admin/finance/revenue-breakdown?month=YYYY-MM[&branch=] — what the accounts overview draws, summed by the database (6 Nov 2026).
//
// «الحسابات › نظرة عامة» added up the revenue by type, by course, by month and by box in the browser out of the 500 newest orders plus every client's loaded payment
// history — and, to split a box by channel, downloaded up to 50,000 payments — converting at the settings' rates, which read 0 for any foreign currency once the
// rates were more than two days old. This sums the paid payments' own amount_egp (the books: the same rows and the same figure as /api/admin/overview/revenue),
// for whatever the caller may see, in Cairo's days:
//   byType     EGP per payment type, all time
//   byCourse   the 30 courses that took the most, with how much of it came online (Paymob) and how much at the desk
//   monthly    the last twelve months, online and desk
//   month      the asked month: what came online, and the desk's money by channel (boxes merged as the register merges them)
const BREAKDOWN_TYPES = ['COURSE', 'BUNDLE', 'CERTIFICATE', 'CONSULTATION', 'BOOK', 'CARNEH'];
const ONLINE_SQL = "(COALESCE(p.source, '') = 'paymob' OR LOWER(COALESCE(p.payment_method, '')) LIKE '%paymob%')";
const round2 = value => Math.round((Number(value) || 0) * 100) / 100;
const monthAfter = month => { const [year, number] = month.split('-').map(Number); return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`; };

router.get('/api/admin/finance/revenue-breakdown', requireAuth, requireAdminOrStaff,
  requireAnyPermission('view_financial', 'view_orders'), async (req, res) => {
    try {
      const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null, allowAssigned: true });
      const scopeClause = financialScopeClause(scope, { branchColumn: 'p.branch_id', subscriberAlias: 's' });
      const today = cairoToday();
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || '')) ? String(req.query.month) : today.slice(0, 7);
      if (scopeClause.sql === ' AND 1=0') {
        return res.json({ month, byType: {}, byCourse: [], monthly: [], online: 0, channels: {} });
      }
      const from = `FROM payments p
        LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id`;
      const where = ` WHERE p.tenant_id = ? AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL${scopeClause.sql}`;
      const base = [req.tenantId, ...scopeClause.params];

      // twelve Cairo months ending with this one: [start, next start) as instants
      const months = [];
      for (let back = 11; back >= 0; back--) {
        const [year, number] = today.slice(0, 7).split('-').map(Number);
        const date = new Date(Date.UTC(year, number - 1 - back, 1));
        months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
      }
      const monthSelects = months.flatMap(() => [
        `COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? AND ${ONLINE_SQL} THEN p.amount_egp END), 0)`,
        `COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? AND NOT ${ONLINE_SQL} THEN p.amount_egp END), 0)`,
      ]);
      const monthParams = months.flatMap(m => {
        const start = cairoDayStartUtc(`${m}-01`); const end = cairoDayStartUtc(`${monthAfter(m)}-01`);
        return [start, end, start, end];
      });
      const askedStart = cairoDayStartUtc(`${month}-01`);
      const askedEnd = cairoDayStartUtc(`${monthAfter(month)}-01`);

      const [[typeRows], [courseRows], [[monthlyRow]], [methodRows]] = await Promise.all([
        pool.query(`SELECT COALESCE(p.payment_type, 'OTHER') AS type, COALESCE(SUM(p.amount_egp), 0) AS egp ${from}${where} GROUP BY COALESCE(p.payment_type, 'OTHER')`, base),
        pool.query(
          `SELECT p.course_id AS id, COALESCE(NULLIF(MAX(c.title_ar), ''), MAX(c.title), '') AS title, COALESCE(SUM(p.amount_egp), 0) AS total,
                  COALESCE(SUM(CASE WHEN ${ONLINE_SQL} THEN p.amount_egp END), 0) AS online
             ${from}${where} AND p.payment_type = 'COURSE' AND p.course_id IS NOT NULL
            GROUP BY p.course_id HAVING total > 0 ORDER BY total DESC LIMIT 30`, base),
        pool.query(`SELECT ${monthSelects.join(', ')} ${from}${where} AND p.date >= ? AND p.date < ?`, [...monthParams, ...base, cairoDayStartUtc(`${months[0]}-01`), cairoDayStartUtc(`${monthAfter(months[11])}-01`)]),
        pool.query(
          `SELECT p.payment_method AS method, ${ONLINE_SQL} AS online, COALESCE(SUM(p.amount_egp), 0) AS egp
             ${from}${where} AND p.date >= ? AND p.date < ? GROUP BY p.payment_method, ${ONLINE_SQL}`, [...base, askedStart, askedEnd]),
      ]);

      const byType = Object.fromEntries([...BREAKDOWN_TYPES, 'OTHER'].map(type => [type.toLowerCase(), 0]));
      for (const row of typeRows) {
        const key = BREAKDOWN_TYPES.includes(row.type) ? row.type.toLowerCase() : 'other';
        byType[key] = round2(byType[key] + Number(row.egp));
      }
      const values = Object.values(monthlyRow);
      let online = 0;
      const channels = {};
      for (const row of methodRows) {
        if (Number(row.online)) { online += Number(row.egp); continue; }
        const channel = canonicalChannel(row.method);
        channels[channel] = round2((channels[channel] || 0) + Number(row.egp));
      }
      res.json({
        month,
        byType,
        byCourse: courseRows.map(row => ({ id: row.id, title: row.title, total: round2(row.total), online: round2(row.online), manual: round2(Number(row.total) - Number(row.online)) })),
        monthly: months.map((m, i) => ({ month: m, online: round2(values[i * 2]), manual: round2(values[i * 2 + 1]) })),
        online: round2(online),
        channels,
      });
    } catch (e) {
      if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
      logger.error('[revenue-breakdown]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

module.exports = router;
