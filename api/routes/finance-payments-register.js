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

      // The range and the scope define the population the facets describe;
      // the other filters narrow the rows within it.
      let base = ' AND p.deleted_at IS NULL';
      const baseParams = [];
      if (status !== 'all') { base += ' AND p.status = ?'; baseParams.push(status); }
      if (isDate(req.query.from)) { base += ' AND p.date >= ?'; baseParams.push(req.query.from); }
      if (isDate(req.query.to)) { base += ' AND p.date < ? + INTERVAL 1 DAY'; baseParams.push(req.query.to); }
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
        const clauses = ['s.name LIKE ?', 's.client_code LIKE ?', 'p.transaction_id LIKE ?', 'p.item_title LIKE ?', 'c.title LIKE ?', 'c.title_ar LIKE ?', 'b.title LIKE ?'];
        const values = [like, like, like, like, like, like, like];
        // «#1234» or a bare number is the operation number.
        if (/^#?\d+$/.test(q)) { clauses.push('p.payment_no = ?'); values.push(Number(digits)); }
        if (digits.length >= 8) { clauses.push('s.phone IN (?)'); values.push([...new Set([digits, ...identitySpellings(digits)])]); }
        where += ` AND (${clauses.join(' OR ')})`;
        params.push(...values);
      }

      const [[[totals]], [rows]] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(p.amount_egp), 0) AS egp ${from} WHERE p.tenant_id = ?${where}`, [req.tenantId, ...params])
          .then(([result]) => [result]),
        pool.query(
          `SELECT p.id, p.payment_no, p.date, p.created_at, p.amount, p.currency, p.amount_egp, p.payment_type, p.payment_method,
                  p.transaction_id, p.status, p.note, p.source, p.is_installment, p.branch,
                  ${SERVICE_SQL} AS service,
                  p.subscriber_id, s.name AS client_name, s.client_code, s.phone AS client_phone,
                  p.staff_id, COALESCE(st.name, NULLIF(p.staff_name, '')) AS staff_name
             ${from}
            WHERE p.tenant_id = ?${where}
            ORDER BY p.date DESC, p.payment_no DESC
            LIMIT ? OFFSET ?`,
          [req.tenantId, ...params, pageSize, page * pageSize]),
      ]);

      res.json({
        rows: rows.map(r => ({
          id: r.id,
          number: r.payment_no != null ? Number(r.payment_no) : null,
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

module.exports = router;
