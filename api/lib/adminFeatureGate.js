'use strict';

const { requireTenantFeature } = require('./tenantScope');

const publicAdminPaths = [
  '/api/admin/sys-config/public',
  '/api/admin/payments/:id/invoice-html',
];

const featureRules = [
  { feature: 'payments', prefixes: ['/api/admin/payments', '/api/admin/payment-audit', '/api/admin/commissions', '/api/admin/orders', '/api/admin/reconcile-payments', '/api/admin/backfill-payments', '/api/admin/enrollments', '/api/admin/export/orders'] },
  { feature: 'finance', prefixes: ['/api/admin/finance', '/api/admin/financial', '/api/admin/reports', '/api/admin/expenses', '/api/admin/budgets', '/api/admin/recurring-expenses', '/api/admin/revenue', '/api/admin/balance', '/api/admin/cash', '/api/admin/refund-requests'] },
  { feature: 'leads', prefixes: ['/api/admin/leads', '/api/admin/import/daqqi'] },
  { feature: 'client_portal', prefixes: ['/api/admin/subscribers', '/api/admin/courses', '/api/admin/lectures', '/api/admin/chapters', '/api/admin/bundles', '/api/admin/quizzes', '/api/admin/live-streams', '/api/admin/completions', '/api/admin/progress', '/api/admin/certificate-requests', '/api/admin/payment-proofs'] },
  { feature: 'hr', prefixes: ['/api/admin/hr', '/api/admin/staff', '/api/admin/instructors'] },
  { feature: 'marketing', prefixes: ['/api/admin/email-campaigns', '/api/admin/sms-campaigns', '/api/admin/drip-sequences', '/api/admin/drip-enrollments', '/api/admin/webhooks', '/api/admin/nps', '/api/admin/notifications', '/api/admin/inbox'] },
  { feature: 'support', prefixes: ['/api/admin/tasks', '/api/admin/tickets'] },
  { feature: 'daqqi', prefixes: ['/api/admin/daqqi', '/api/admin/waitlist'] },
  { feature: 'settings', prefixes: ['/api/admin/settings', '/api/admin/sys-config', '/api/admin/content', '/api/admin/kv', '/api/admin/ip-whitelist', '/api/admin/payment-gateway', '/api/admin/lead-sources', '/api/admin/otp-provider'] },
  { feature: 'security', prefixes: ['/api/admin/security', '/api/admin/backup', '/api/admin/backups'] },
  { feature: 'analytics', prefixes: ['/api/admin/analytics', '/api/admin/kpi', '/api/admin/dashboard/kpi', '/api/admin/forecast'] },
];

function isPublicAdminPath(pathname) {
  if (publicAdminPaths.includes(pathname)) return true;
  return /^\/api\/admin\/payments\/[^/]+\/invoice-html$/.test(pathname);
}

function featureForPath(pathname) {
  const match = featureRules.find((rule) => rule.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
  return match?.feature || null;
}

function adminFeatureGate(req, res, next) {
  const pathname = req.originalUrl?.split('?')[0] || req.path || '';
  if (isPublicAdminPath(pathname)) return next();
  const feature = featureForPath(pathname);
  if (!feature) return next();
  return requireTenantFeature(feature)(req, res, next);
}

module.exports = {
  adminFeatureGate,
  featureForPath,
};
