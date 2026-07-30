'use strict';
// ── Central institute brand (single source for branded outputs) ───────────────
// Reads the SAME site_config 'content' blob that the admin's SiteIdentityPanel
// writes (keys: institute.name, institute.logo, footer.phone/whatsapp/address,
// brand.primary), so whatever the owner sets in Settings → الهوية appears on
// every branded output — emails, invoices/receipts, public pages. Cached 60s.
//
// Ported (adapted to 25's content-key scheme) from the 26 line's brandSettings.
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { pool } = require('./db');

const DEFAULT_BRAND = {
  instituteName: 'معهد مهاد للدراسات النفسية',
  websiteUrl: 'https://mahadnafsy.com',
  supportEmail: 'info@mahadnafsy.com',
  supportPhone: '',
  supportWhatsapp: '',
  supportAddress: '',
  logoUrl: 'https://mahadnafsy.com/logo.png',
  primaryColor: '#c0392b',
  secondaryColor: '#285e61',
  accentColor: '#f59e0b',
};

const _cache = new Map();
const TTL_MS = 60_000;

const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d);

// Map the admin content blob → a normalized brand object (with defaults).
function fromContent(c = {}) {
  return {
    instituteName:   str(c['institute.name'], DEFAULT_BRAND.instituteName),
    websiteUrl:      str(c['site.url'] || c['footer.website'], DEFAULT_BRAND.websiteUrl),
    supportEmail:    str(c['footer.email'] || c['institute.email'], DEFAULT_BRAND.supportEmail),
    supportPhone:    str(c['footer.phone'], DEFAULT_BRAND.supportPhone),
    supportWhatsapp: str(c['footer.whatsapp'], DEFAULT_BRAND.supportWhatsapp),
    supportAddress:  str(c['footer.address'], DEFAULT_BRAND.supportAddress),
    logoUrl:         str(c['institute.logo'], DEFAULT_BRAND.logoUrl),
    primaryColor:    hex(c['brand.primary'], DEFAULT_BRAND.primaryColor),
    secondaryColor:  hex(c['brand.secondary'], DEFAULT_BRAND.secondaryColor),
    accentColor:     hex(c['brand.accent'], DEFAULT_BRAND.accentColor),
  };
}

async function getBrandSettings(tenantId = DEFAULT_TENANT, db = undefined) {
  const cached = _cache.get(tenantId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value;
  try {
    const [content, sysGeneral] = await Promise.all([
      getTenantSetting('content', { tenantId, fallback: {}, ...(db ? { db } : {}) }),
      getTenantSetting('sys_general', { tenantId, fallback: {}, ...(db ? { db } : {}) }),
    ]);
    value = fromContent(content || {});
    // The SaaS setup wizard's logo uploader (routes/branding-assets.js) saves
    // into 'sys_general', a different settings section than this reads from —
    // a tenant onboarded only through the wizard never saw their own logo on
    // any branded output (ARC-07). Prefer it when present.
    if (sysGeneral?.brand_logo_url) value.logoUrl = sysGeneral.brand_logo_url;
    if (sysGeneral?.website_url) value.websiteUrl = str(sysGeneral.website_url, value.websiteUrl);
    if (!content?.['site.url'] && !content?.['footer.website'] && !sysGeneral?.website_url) {
      const queryDb = db || pool;
      const [[domain]] = await queryDb.query(
        "SELECT domain FROM tenant_domains WHERE tenant_id=? AND status='verified' LIMIT 1",
        [tenantId]
      ).catch(() => [[null]]);
      if (domain?.domain) value.websiteUrl = `https://${domain.domain}`;
    }
  } catch (_) {
    value = { ...DEFAULT_BRAND };
  }
  _cache.set(tenantId, { value, at: Date.now() });
  return value;
}

function invalidateBrandSettings(tenantId) {
  if (tenantId) _cache.delete(tenantId);
  else _cache.clear();
}

module.exports = { DEFAULT_BRAND, getBrandSettings, invalidateBrandSettings };
