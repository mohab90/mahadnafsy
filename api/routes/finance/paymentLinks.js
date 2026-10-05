'use strict';
// Payment links: creating, listing and opening one.
// One part of routes/finance.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  uuidv4,
  pool,
  validate,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  publicLimiter,
  branchIdForBranch,
  defaultDigitalBranch,
  financialRecordMatches,
  financialScopeClause,
  resolveFinancialScope,
  logger,
  crypto,
} = require('./_shared');

const router = Router();

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
    const { sql: scopeSql, params: scopeParams } =
      financialScopeClause(scope, { branchColumn: 'pl.branch_id' });
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

module.exports = router;
