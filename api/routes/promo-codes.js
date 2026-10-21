'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'promo-codes-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { toNumbers } = require('../lib/mappers');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { findPromoRow } = require('../lib/effectivePrice');

function routeError(res, error, message = 'promo codes route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

// Every code is one tenant's (HIGH-09; migration 255): each query names it.
router.post('/api/promo/validate', publicLimiter, async (req, res) => {
  const { code, amount } = req.body || {};
  if (!code) return res.status(400).json({ error: 'الكود مطلوب' });
  try {
    // Usable by the same rule checkout applies it with (lib/effectivePrice.js).
    const promo = await findPromoRow(pool, { tenantId: req.tenantId, code });
    if (!promo) return res.status(404).json({ error: 'الكود غير صالح أو منتهي الصلاحية' });
    if (promo.min_order_amount > 0 && (amount || 0) < promo.min_order_amount) {
      return res.status(400).json({ error: `الحد الأدنى للطلب ${promo.min_order_amount} ج.م` });
    }
    const orderAmount = Number(amount) || 0;
    const discount = promo.discount_type === 'percent'
      ? Math.round(orderAmount * promo.discount_value / 100)
      : Number(promo.discount_value);
    res.json({ ok: true, discount, discountType: promo.discount_type, discountValue: Number(promo.discount_value), description: promo.description || '' });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/promo-codes', requireAuth, requireAdminOrStaff, requirePermission('manage_discounts'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      // A use is a paid order carrying the code; nothing incremented used_count, so it read 0 forever.
      `SELECT pc.id, pc.code, pc.description, pc.discount_type, pc.discount_value, pc.min_order_amount, pc.max_uses,
       GREATEST(pc.used_count, (SELECT COUNT(*) FROM orders o WHERE o.tenant_id=pc.tenant_id AND o.coupon_code=pc.code
                                  AND o.status='paid' AND o.deleted_at IS NULL)) AS used_count,
       pc.expires_at, pc.active, pc.created_by, pc.created_at
       FROM promo_codes pc WHERE pc.tenant_id=? ORDER BY pc.created_at DESC`, [req.tenantId]);
    res.json(rows.map(row => toNumbers(row, ["discount_value","min_order_amount"])));
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/promo-codes', requireAuth, requireAdminOrStaff, requirePermission('manage_discounts'), async (req, res) => {
  const { code, description, discount_type, discount_value, min_order_amount, max_uses, expires_at } = req.body || {};
  if (!code || !discount_value) return res.status(400).json({ error: 'الكود والخصم مطلوبان' });
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO promo_codes (id, tenant_id, code, description, discount_type, discount_value, min_order_amount, max_uses, expires_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, String(code).toUpperCase().trim(), description || null, discount_type || 'percent',
       Number(discount_value), Number(min_order_amount || 0), max_uses ? Number(max_uses) : null,
       expires_at || null, req.user.email]
    );
    res.json({ ok: true, id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'الكود مستخدم بالفعل' });
    routeError(res, e);
  }
});

router.patch('/api/admin/promo-codes/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_discounts'), async (req, res) => {
  const { active, description, max_uses, expires_at } = req.body || {};
  try {
    const updates = []; const vals = [];
    if (active !== undefined) { updates.push('active=?'); vals.push(active ? 1 : 0); }
    if (description !== undefined) { updates.push('description=?'); vals.push(description); }
    if (max_uses !== undefined) { updates.push('max_uses=?'); vals.push(max_uses ? Number(max_uses) : null); }
    if (expires_at !== undefined) { updates.push('expires_at=?'); vals.push(expires_at || null); }
    if (!updates.length) return res.json({ ok: true });
    vals.push(req.params.id, req.tenantId);
    await pool.query(`UPDATE promo_codes SET ${updates.join(',')} WHERE id=? AND tenant_id=?`, vals);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/promo-codes/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_discounts'), async (req, res) => {
  try {
    await pool.query('DELETE FROM promo_codes WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

module.exports = router;
