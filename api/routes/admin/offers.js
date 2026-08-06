'use strict';

/**
 * Sales offers — management publishes, the whole sales team sees.
 *
 * Reads are open to anyone who can work leads (`view_leads`), because the point
 * of an offer is that every rep sees it. Writes need `view_reports`, the same
 * manager-level gate used for sales targets: an offer changes what a course can
 * be sold for, so a rep must not be able to mint one for themselves.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { uuidv4 } = require('../../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { createNotification } = require('../../lib/notification');

const KINDS = ['discount', 'bonus'];
const VALUE_TYPES = ['percent', 'amount'];
const SCOPES = ['course', 'all_courses', 'bundle', 'all_bundles', 'branch'];
const SCOPED_TO_ID = new Set(['course', 'bundle', 'branch']);

const shape = row => ({
  id: row.id,
  title: row.title,
  description: row.description,
  kind: row.kind,
  valueType: row.value_type,
  value: Number(row.value),
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  startsOn: row.starts_on ? String(row.starts_on).slice(0, 10) : null,
  endsOn: row.ends_on ? String(row.ends_on).slice(0, 10) : null,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
});

// GET /api/admin/sales-offers?activeOnly=1
router.get('/api/admin/sales-offers', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly || '') === '1';
    // Half-open date comparisons against CURDATE() on a DATE column stay
    // sargable — no function wrapping the indexed column.
    const sql = `SELECT * FROM sales_offers WHERE tenant_id=?${activeOnly
      ? ` AND is_active=1
          AND (starts_on IS NULL OR starts_on <= CURDATE())
          AND (ends_on   IS NULL OR ends_on   >= CURDATE())`
      : ''} ORDER BY is_active DESC, created_at DESC LIMIT 200`;
    const [rows] = await pool.query(sql, [req.tenantId]);
    res.json(rows.map(shape));
  } catch (e) {
    logger.error('[sales-offers/list]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/sales-offers — create or update
router.post('/api/admin/sales-offers', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 255);
    if (!title) return res.status(400).json({ error: 'عنوان العرض مطلوب' });
    const kind = KINDS.includes(b.kind) ? b.kind : 'discount';
    const valueType = VALUE_TYPES.includes(b.valueType) ? b.valueType : 'percent';
    const value = Number(b.value);
    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'قيمة العرض غير صحيحة' });
    if (valueType === 'percent' && value > 100) return res.status(400).json({ error: 'النسبة لا يمكن أن تتجاوز 100%' });
    const scopeType = SCOPES.includes(b.scopeType) ? b.scopeType : 'all_courses';
    const scopeId = SCOPED_TO_ID.has(scopeType) ? String(b.scopeId || '').trim() : null;
    if (SCOPED_TO_ID.has(scopeType) && !scopeId) {
      return res.status(400).json({ error: 'اختر العنصر الذي ينطبق عليه العرض' });
    }
    const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    const startsOn = day(b.startsOn);
    const endsOn = day(b.endsOn);
    if (startsOn && endsOn && endsOn < startsOn) {
      return res.status(400).json({ error: 'تاريخ الانتهاء قبل تاريخ البداية' });
    }

    const id = String(b.id || '').trim() || uuidv4();
    const isNew = !b.id;
    await pool.query(
      `INSERT INTO sales_offers
         (id, tenant_id, title, description, kind, value_type, value,
          scope_type, scope_id, starts_on, ends_on, is_active, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), description=VALUES(description), kind=VALUES(kind),
         value_type=VALUES(value_type), value=VALUES(value),
         scope_type=VALUES(scope_type), scope_id=VALUES(scope_id),
         starts_on=VALUES(starts_on), ends_on=VALUES(ends_on), is_active=VALUES(is_active)`,
      [id, req.tenantId, title, String(b.description || '').slice(0, 2000) || null,
        kind, valueType, value, scopeType, scopeId, startsOn, endsOn,
        b.isActive === false ? 0 : 1, req.staffRecord?.id || req.user?.uid || null]
    );

    // Announce it once, on creation, so the team learns about a new offer
    // without having to go looking for it.
    if (isNew) {
      const label = kind === 'discount' ? 'خصم' : 'مكافأة';
      const amount = valueType === 'percent' ? `${value}%` : `${value} ج.م`;
      await createNotification(
        'sales', `🎁 عرض جديد: ${title}`, `${label} ${amount} — متاح لفريق المبيعات`,
        { offerId: id }, req.tenantId
      ).catch(() => {});
    }
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[sales-offers/save]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/sales-offers/:id', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM sales_offers WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'العرض غير موجود' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[sales-offers/delete]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
