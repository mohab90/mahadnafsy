'use strict';

const routeModules = [
  ['/', '../routes/auth'],
  ['/', '../routes/public'],
  ['/', '../routes/automation'],
  ['/', '../routes/abandoned-checkout'],
  ['/', '../routes/campaigns'],
  ['/', '../routes/support'],
  ['/', '../routes/admin-utils'],
  ['/', '../routes/privacy'],
  ['/', '../routes/finance'],
  ['/', '../routes/finance-operations'],
  ['/', '../routes/finance-documents'],
  ['/', '../routes/finance-planning'],
  ['/', '../routes/analytics'],
  ['/', '../routes/crm-advanced'],
  ['/', '../routes/crm-forecast'],
  ['/', '../routes/crm-sequences'],
  ['/', '../routes/crm-quotes'],
  ['/', '../routes/crm-coaching'],
  ['/', '../routes/misc'],
  ['/', '../routes/notifications'],
  ['/', '../routes/loyalty'],
  ['/', '../routes/orders'],
  ['/', '../routes/push'],
  ['/', '../routes/upload'],
  ['/', '../routes/config'],
  ['/', '../routes/community'],
  ['/', '../routes/inbox'],
  ['/', '../routes/daqqi-rounds'],
  ['/', '../routes/dokki-operations'],
  ['/', '../routes/public-orders'],
  ['/', '../routes/imageProxy'],
  ['/', '../routes/certificates'],
  ['/', '../routes/client-maintenance'],
  ['/', '../routes/accounting'],
  ['/', '../routes/server-monitor'],
  ['/', '../routes/promo-codes'],
  ['/', '../routes/crm-ops'],
  ['/', '../routes/communication-admin'],
  ['/', '../routes/admin-operations'],
  ['/', '../routes/lead-capture-crm'],
  ['/', '../routes/facebook-leads-webhook'],
  ['/', '../routes/whatsapp-webhook'],
  ['/', '../routes/profile'],
  ['/', '../routes/staff'],
  ['/', '../routes/core'],
  ['/', '../routes/subscriber-qr'],
  ['/', '../routes/admin'],
  ['/', '../routes/lms-admin'],
  ['/', '../routes/payments'],
  ['/', '../routes/installments'],
  ['/', '../routes/crm-tools'],
  ['/', '../routes/subscriber-payments'],
  ['/', '../routes/payment-intents'],
  ['/', '../routes/payment-proofs'],
  ['/', '../routes/accounting-erp'],
  ['/', '../routes/saas-admin'],
  ['/', '../routes/monitoring'],
  ['/', '../routes/funnel'],
  ['/', '../routes/lms'],
  ['/api/student-ai', '../routes/student-ai'],
  ['/', '../routes/gsheets'],
  ['/', '../routes/hr'],
  ['/', '../routes/docs'],
  ['/', '../routes/payments-admin'],
  ['/', '../routes/connector-diagnostics'],
  ['/', '../routes/branding-assets'],
  ['/', '../routes/tenant-domains'],
];

// Express 4 does not forward a rejected Promise from an async route to the
// application error middleware. Wrap every async endpoint once at registration
// time so connection failures and unexpected exceptions cannot become unhandled
// rejections. Nested routers are traversed as well.
function wrapAsyncRouteHandlers(router, visited = new WeakSet()) {
  if (!router || typeof router !== 'function' || visited.has(router)) return router;
  visited.add(router);
  for (const layer of router.stack || []) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack || []) {
        const original = routeLayer.handle;
        if (original?.constructor?.name !== 'AsyncFunction' || original.length === 4) continue;
        routeLayer.handle = function asyncRouteBoundary(req, res, next) {
          return Promise.resolve(original(req, res, next)).catch(next);
        };
      }
    } else if (layer.handle?.stack) {
      wrapAsyncRouteHandlers(layer.handle, visited);
    }
  }
  return router;
}

function registerRoutes(app) {
  for (const [mountPath, modulePath] of routeModules) {
    app.use(mountPath, wrapAsyncRouteHandlers(require(modulePath)));
  }
}

module.exports = { registerRoutes, routeModules, wrapAsyncRouteHandlers };
