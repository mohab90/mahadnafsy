'use strict';
// ── Central institute brand (single source for branded outputs) ───────────────
// Reads the SAME site_config 'content' blob that the admin's SiteIdentityPanel
// writes (keys: institute.name, institute.logo, footer.phone/whatsapp/address,
// brand.primary), so whatever the owner sets in Settings → الهوية appears on
// every branded output — emails, invoices/receipts, public pages. Cached 60s.
//
// Ported (adapted to 25's content-key scheme) from the 26 line's brandSettings.
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

let _cache = null;
let _cachedAt = 0;
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

async function getBrandSettings() {
  if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache;
  try {
    const [[row]] = await pool.query("SELECT `value` FROM site_config WHERE `key`='content' LIMIT 1");
    const content = row?.value ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {};
    _cache = fromContent(content);
  } catch (_) {
    _cache = { ...DEFAULT_BRAND };
  }
  _cachedAt = Date.now();
  return _cache;
}

function invalidateBrandSettings() { _cache = null; _cachedAt = 0; }

module.exports = { DEFAULT_BRAND, getBrandSettings, invalidateBrandSettings };
