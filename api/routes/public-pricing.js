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
const { optionalAuth } = require('../middleware/auth');
const { loadTierPrices, resolveAudience } = require('../lib/egyptianPricing');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { maskNationalId } = require('../lib/egyptianNationalId');
const { resolveClientContext } = require('../lib/clientContext');
const { DEFAULT_TENANT_ID } = require('../lib/tenantScope');
const { CURRENCIES, loadPricingContext, priceItem, resolveEffectivePrice } = require('../lib/effectivePrice');
const { expressPrice } = require('../lib/consultationRequests');

// The rules aim at the express doctor when one is set; the price is the express one.
const expressTarget = content => String(content['express.therapistId'] || 'express');

// Every published item's price in each currency, discounts and offers applied — answered by the route below and by /api/public/bootstrap.
// Short-lived: an offer's countdown or a rule's last day changes the answer.
function loadPublicPrices(tenantId) {
  return cached(`public-prices:${tenantId}`, 30 * 1000, async () => {
      const [courses] = await pool.query(
        'SELECT id, price_egp, price_sar, price_usd FROM courses WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
      const [bundles] = await pool.query(
        'SELECT id, price_egp, price_sar, price_usd FROM bundles WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
      const [therapists] = await pool.query(
        'SELECT id, price_egp, price_sar, price_usd FROM therapists WHERE tenant_id=? AND is_active=1 AND is_consultation_enabled=1', [tenantId]);
      const { discounts, content, rates, egyptianPricing } = await loadPricingContext(pool, tenantId);
      // The Egypt site shows the non-Egyptian price when the owner switched that on and the item has one (lib/egyptianPricing.js); off, nothing here changes.
      const tiers = {
        course: egyptianPricing.enabled ? await loadTierPrices(pool, { tenantId, type: 'course', ids: courses.map(row => row.id) }) : new Map(),
        bundle: egyptianPricing.enabled ? await loadTierPrices(pool, { tenantId, type: 'bundle', ids: bundles.map(row => row.id) }) : new Map(),
      };
      const now = Date.now();
      const items = {};
      const add = (type, row, key = `${type}:${row.id}`, itemId = row.id) => {
        const entry = {};
        for (const currency of CURRENCIES) {
          let base = Number(row[`price_${currency.toLowerCase()}`]) || 0;
          if (!(base > 0)) continue;
          const tier = currency === 'EGP' ? tiers[type]?.get(String(row.id)) : null;
          if (tier?.foreign) {
            base = tier.foreign;
            const { list, discount } = priceItem({ type, itemId, currency, base, discounts, content, now, tierOffer: egyptianPricing.offerActive ? tier.foreignOffer || 0 : 0 });
            entry[currency] = { base, price: list, discount, egyptianTier: true };
            continue;
          }
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
      return egyptianPricing.enabled ? { items, rates, egyptianPricing: { enabled: true } } : { items, rates };
  });
}

router.get('/api/public/prices', publicLimiter, async (req, res) => {
  const tenantId = req.tenantId || DEFAULT_TENANT_ID;
  try {
    const data = await loadPublicPrices(tenantId);
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch (e) {
    logger.error('[public/prices]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/public/price-quote', publicLimiter, optionalAuth, scalarFields('itemType', 'itemId', 'payMode', 'promoCode', 'currency', 'subtype', 'nationalId'), async (req, res) => {
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
    const context = await loadPricingContext(pool, tenantId);
    // Who the visitor is for the Egypt site's two prices: the national ID he typed, or what his record holds. Off, none of this is read.
    let audience = null;
    if (context.egyptianPricing.enabled && currency === 'EGP' && (type === 'course' || type === 'bundle')) {
      const subscriber = req.user ? await resolveSubscriberRow(req, ['id']).catch(() => null) : null;
      audience = await resolveAudience(pool, { tenantId, subscriberId: subscriber?.id || null, typedId: req.body?.nationalId, checkTyped: false });
    }
    const quote = await resolveEffectivePrice(pool, {
      type, itemId: String(itemId), currency, tenantId, payMode, promoCode: String(promoCode || '').slice(0, 50), base, context,
      egyptian: audience?.egyptian === true,
    });
    if (!quote) return res.status(409).json({ error: 'السعر غير متاح بالعملة دي', code: 'PRICE_UNAVAILABLE' });
    if (!audience || !quote.egyptian) return res.json({ ok: true, ...quote });
    // The ID is never sent back whole: its last three digits, so a signed-in client can see which one is on his record.
    res.json({
      ok: true, ...quote,
      ...(audience.nationalId ? { nationalIdMasked: maskNationalId(audience.nationalId) } : {}),
      ...(audience.error ? { nationalIdError: { code: audience.error.code, message: audience.error.message } } : {}),
    });
  } catch (e) {
    logger.error('[public/price-quote]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.loadPublicPrices = loadPublicPrices;
