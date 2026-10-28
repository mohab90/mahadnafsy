'use strict';
// The price the site shows, from the rule checkout charges (lib/effectivePrice.js).
//
//   GET  /api/public/prices       every published course and path, per currency:
//                                 { base, price, discount } — the list price before the pay mode
//                                 and every doctor taking sessions (consultation:<id>), and the
//                                 express session (consultation:express)
//   POST /api/public/price-quote  { itemType, itemId, payMode, promoCode, currency?, subtype? }
//                                 one item for this visitor: the code applied (or why not),
//                                 what is due now and an instalment plan's total
const express = require('express');
const { scalarFields } = require('../lib/inputFields');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'public-pricing-route' });
const { pool, cached } = require('../lib/db');
const { publicLimiter } = require('../middleware/rateLimits');
const { resolveClientContext } = require('../lib/clientContext');
const { DEFAULT_TENANT_ID } = require('../lib/tenantScope');
const { CURRENCIES, loadPricingContext, priceItem, resolveEffectivePrice } = require('../lib/effectivePrice');
const { expressPrice } = require('../lib/consultationRequests');

// The rules aim at the express doctor when one is set; the price is the express one.
const expressTarget = content => String(content['express.therapistId'] || 'express');

router.get('/api/public/prices', publicLimiter, async (req, res) => {
  const tenantId = req.tenantId || DEFAULT_TENANT_ID;
  try {
    // Short: an offer's countdown or a rule's last day changes the answer.
    const data = await cached(`public-prices:${tenantId}`, 30 * 1000, async () => {
      const [courses] = await pool.query(
        'SELECT id, price_egp, price_sar, price_usd FROM courses WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
      const [bundles] = await pool.query(
        'SELECT id, price_egp, price_sar, price_usd FROM bundles WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
      const [therapists] = await pool.query(
        'SELECT id, price_egp, price_sar, price_usd FROM therapists WHERE tenant_id=? AND is_active=1 AND is_consultation_enabled=1', [tenantId]);
      const { discounts, content, rates } = await loadPricingContext(pool, tenantId);
      const now = Date.now();
      const items = {};
      const add = (type, row, key = `${type}:${row.id}`, itemId = row.id) => {
        const entry = {};
        for (const currency of CURRENCIES) {
          const base = Number(row[`price_${currency.toLowerCase()}`]) || 0;
          if (!(base > 0)) continue;
          const { list, discount } = priceItem({ type, itemId, currency, base, discounts, content, now });
          entry[currency] = { base, price: list, discount };
        }
        items[key] = entry;
      };
      courses.forEach(row => add('course', row));
      bundles.forEach(row => add('bundle', row));
      therapists.forEach(row => add('consultation', row));
      add('consultation', Object.fromEntries(CURRENCIES.map(c => [`price_${c.toLowerCase()}`, expressPrice(content, c)])),
        'consultation:express', expressTarget(content));
      return { items, rates };
    });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch (e) {
    logger.error('[public/prices]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/public/price-quote', publicLimiter, scalarFields('itemType', 'itemId', 'payMode', 'promoCode', 'currency', 'subtype'), async (req, res) => {
  const tenantId = req.tenantId || DEFAULT_TENANT_ID;
  try {
    const { payMode, promoCode } = req.body || {};
    let { itemId } = req.body || {};
    const type = String(req.body?.itemType || '').toLowerCase();
    const express = type === 'consultation' && String(req.body?.subtype || '').toLowerCase() === 'express';
    if (!['course', 'bundle', 'consultation'].includes(type) || (!itemId && !express)) return res.status(400).json({ error: 'itemType and itemId required' });
    // The currency checkout will charge in: the visitor's verified location.
    const clientContext = await resolveClientContext(req);
    const asked = String(req.body?.currency || '').toUpperCase();
    const currency = clientContext.locationResolved ? clientContext.currency : (CURRENCIES.includes(asked) ? asked : 'EGP');
    // The express session: its own price, the rules aimed at its doctor or at all consultations.
    let base = null;
    if (express) {
      const { content } = await loadPricingContext(pool, tenantId);
      base = expressPrice(content, currency);
      itemId = expressTarget(content);
      if (!(base > 0)) return res.status(409).json({ error: 'السعر غير متاح بالعملة دي', code: 'PRICE_UNAVAILABLE' });
    }
    const quote = await resolveEffectivePrice(pool, {
      type, itemId: String(itemId), currency, tenantId, payMode, promoCode: String(promoCode || '').slice(0, 50), base,
    });
    if (!quote) return res.status(409).json({ error: 'السعر غير متاح بالعملة دي', code: 'PRICE_UNAVAILABLE' });
    res.json({ ok: true, ...quote });
  } catch (e) {
    logger.error('[public/price-quote]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
