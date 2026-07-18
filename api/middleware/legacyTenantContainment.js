'use strict';

const { DEFAULT_TENANT } = require('./tenantContext');

// Route families backed by legacy SQL without explicit tenant_id predicates.
// Keep this list centralized and shrink it as each module is migrated.
const LEGACY_UNSCOPED_PATHS = [
  /^\/api\/admin\/(?:automation|automation-workflows|drip-|reports|sales-|analytics|dashboard\/kpi|kpi\/|sms|subscription|notifications|security|consultations|nps|search)(?:\/|$)/,
  /^\/api\/admin\/(?:ip-whitelist|kv|sys-config|community|inbox|daqqi|accounting|waitlist|ai|server-|promo-codes|crm|upload|content|discounts|fx-rates|lifecycle|notification-settings|settings)(?:\/|$)/,
  /^\/api\/admin\/(?:chapters|lectures|testimonials|therapists|courses|online-users|commissions\/monthly|export\/orders)(?:\/|$)/,
  /^\/api\/admin\/leads\/(?:[^/]+\/utm|scoring|due-today|reminders|gsheet)(?:\/|$)/,
  /^\/api\/admin\/payments\/(?:[^/]+\/invoice-html|due-upcoming|reminders)(?:\/|$)/,
  /^\/api\/admin\/staff\/[^/]+\/(?:set-password|toggle-active)(?:\/|$)/,
  /^\/api\/admin\/subscribers\/[^/]+\/(?:loyalty|qr)(?:\/|$)/,
  /^\/api\/(?:community|waitlist|promo)(?:\/|$)/,
  /^\/api\/me\/(?:loyalty|is-staff|register-interest)(?:\/|$)/,
  /^\/chat(?:\/|$)/,
  /^\/api\/content(?:\/|$)/,
  /^\/api\/me\/certificate-request(?:\/|$)/,
  /^\/api\/completions\/[^/]+\/certificate(?:\/|$)/,
];

/**
 * Fail-closed guard for legacy SQL that has not yet been migrated to explicit
 * tenant_id predicates. It prevents cross-tenant reads/writes while keeping
 * the original single-institute deployment available.
 */
function legacyTenantContainment(req, res, next) {
  if (!req.tenantId) {
    return res.status(503).json({
      error: 'Tenant context unavailable',
      code: 'TENANT_CONTEXT_REQUIRED',
    });
  }

  const requestPath = String(req.path || req.originalUrl || '').split('?')[0];
  const isLegacyUnscopedPath = LEGACY_UNSCOPED_PATHS.some((pattern) => pattern.test(requestPath));
  if (String(req.tenantId) !== String(DEFAULT_TENANT) && isLegacyUnscopedPath) {
    return res.status(503).json({
      error: 'This module is temporarily unavailable for this tenant',
      code: 'TENANT_SCOPE_NOT_AVAILABLE',
    });
  }

  return next();
}

module.exports = { legacyTenantContainment, LEGACY_UNSCOPED_PATHS };
