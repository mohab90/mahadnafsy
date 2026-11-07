'use strict';
// The rule tests used to run the browser's copy of «what a client owes» (admin/lib/agreedPrice.ts), bundled with esbuild. That copy is gone: the rule is
// api/lib/clientItems.js and the browser draws the server's `moneyItems`. This gives those tests the same calls — a client, the catalogue as arrays, a currency —
// on the one rule that is left.
const rule = require('../lib/clientItems');

const catalogueOf = (courses = [], bundles = []) => ({
  courses: new Map(courses.map(course => [course.id, { price: course.price, title: course.titleAr || course.title || course.id }])),
  bundles: new Map(bundles.map(bundle => [bundle.id, { price: bundle.price, title: bundle.title || bundle.id, courseIds: (bundle.courses || []).map(course => course.id) }])),
});

const clientItems = (subscriber, courses, bundles, currency = 'EGP') => rule.clientItems(subscriber, catalogueOf(courses, bundles), currency);

/** The client with the `moneyItems` a list row carries (lib/clientMoneyItems.js). */
const withMoney = (client, courses, bundles, currency = require('../lib/clientMarket').clientCurrency(client)) => ({ ...client, moneyItems: clientItems(client, courses, bundles, currency) });

/** What GET /api/admin/clients/:id/money answers for the client — the dialog's `money`. */
const moneyOf = (client, courses, bundles, currency = 'EGP') => ({
  subscriberId: client.id || 's', nationality: null, certificates: [], extras: [], totals: {},
  items: clientItems(client, courses, bundles, currency).map(line => ({
    item: line.item, kind: line.isTrack ? 'track' : 'course', title: line.title, currency: line.currency, catalogue: line.catalogue, agreed: line.expected,
    source: line.source, paid: line.paid - line.priorPaid, priorPaid: line.priorPaid, remaining: line.remaining,
  })),
});

module.exports = {
  clientItems, withMoney, moneyOf,
  agreedPriceFor: (subscriber, item, catalogue = 0, currency) => rule.agreedPriceDetail(subscriber, item, catalogue, currency).price || 0,
  paidFor: rule.paidFor,
  pendingFor: rule.pendingFor,
  isCoursePayment: rule.isCoursePayment,
  itemKeyOf: rule.itemKeyOf,
  courseMoneyFor(subscriber, courseId, courses, bundles, currency = 'EGP') {
    const items = clientItems(subscriber, courses, bundles, currency);
    return items.find(item => item.item === courseId)
      || items.find(item => item.isTrack && (bundles.find(bundle => `bundle:${bundle.id}` === item.item)?.courses || []).some(course => course.id === courseId))
      || null;
  },
};
