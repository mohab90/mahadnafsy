'use strict';
// ── Email helpers (config-driven) ─────────────────────────────────────────────
// Sender address, SMTP credentials, AND the message template are all editable
// from Admin → Settings → البريد (stored in site_config key 'email_config'),
// falling back to env vars then to sane defaults. So the owner can swap the
// sending mailbox or restyle customer emails without touching code.
const nodemailer = require('nodemailer');
const logger = require('./logger');
const { getBrandSettings } = require('./brandSettings');
const { getTenantSetting } = require('./tenantSettings');
const { resolveSecret } = require('./secretResolver');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

const DEFAULTS = {
  smtpHost: process.env.SMTP_HOST || 'smtp.hostinger.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '465'),
  smtpUser: process.env.SMTP_USER || 'otp@mahadnafsy.com',
  smtpPass: resolveSecret('SMTP_PASS'),
  senderName: 'معهد الدراسات النفسية',
  senderAddress: process.env.EMAIL_FROM || '', // '' → use smtpUser
  brandColor: '#c0392b',
  headerTitle: 'معهد الدراسات النفسية',
  headerSubtitle: 'mahadnafsy.com',
  logoUrl: 'https://mahadnafsy.com/logo.png',
  footerText: 'هذا البريد أُرسل تلقائياً — يُرجى عدم الرد عليه',
  websiteUrl: 'https://mahadnafsy.com',
};

const configCache = new Map();
const CONFIG_TTL_MS = 60 * 1000;

// Loads + caches the tenant email config (60s), merged over defaults.
async function getEmailConfig(tenantId = DEFAULT_TENANT) {
  const scopedTenant = String(tenantId || DEFAULT_TENANT);
  const hit = configCache.get(scopedTenant);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value;
  const value = await (async () => {
    let saved = {};
    try {
      saved = await getTenantSetting('email_config', { tenantId: scopedTenant, fallback: {} }) || {};
    } catch (e) { logger.warn('[email] config read failed', { err: e.message }); }
    // Pull the institute identity the owner set in Settings → الهوية so emails are
    // branded automatically. Precedence: explicit email_config > brand settings > defaults.
    let brandDefaults = {};
    try {
      const b = await getBrandSettings(scopedTenant);
      brandDefaults = {
        senderName: b.instituteName,
        brandColor: b.primaryColor,
        headerTitle: b.instituteName,
        logoUrl: b.logoUrl,
        headerSubtitle: (b.websiteUrl || '').replace(/^https?:\/\//, ''),
        websiteUrl: b.websiteUrl,
      };
    } catch (e) { logger.warn('[email] brand read failed', { err: e.message }); }
    const environmentOnly = String(process.env.SMTP_CONFIG_SOURCE || '').toLowerCase() === 'environment';
    const cfg = { ...DEFAULTS, ...brandDefaults, ...(environmentOnly ? {} : saved) };
    cfg.smtpPass = environmentOnly ? DEFAULTS.smtpPass : (saved.smtpPass || DEFAULTS.smtpPass);
    if (!cfg.senderAddress) cfg.senderAddress = cfg.smtpUser;
    return cfg;
  })();
  configCache.set(scopedTenant, { value, at: Date.now() });
  return value;
}

function invalidateEmailConfig(tenantId) {
  if (tenantId) configCache.delete(String(tenantId));
  else configCache.clear();
}

async function getTransport(tenantId = DEFAULT_TENANT) {
  const c = await getEmailConfig(tenantId);
  return nodemailer.createTransport({
    host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465,
    auth: { user: c.smtpUser, pass: c.smtpPass },
  });
}

// Wraps body content in the branded template. `cfg` optional (defaults applied).
//
// Table layout with inline styles, because Gmail and Outlook drop flexbox,
// onerror handlers and much of <style>. The <style> block stays only for the
// classes callers put in bodyHtml (.otp-box, .btn, table.details).
// The logo is stored as a site-relative path (/uploads/...), which an email
// client cannot resolve, so it is made absolute against the website URL.
function absoluteUrl(url, base) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return String(base || DEFAULTS.websiteUrl).replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
}

function htmlEmail(title, bodyHtml, cfg) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  const color = c.brandColor;
  const logo = absoluteUrl(c.logoUrl, c.websiteUrl);
  const site = String(c.websiteUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  .otp-box { font-size:38px; font-weight:800; letter-spacing:10px; color:${color}; text-align:center; padding:22px 16px; background:#fff5f5; border:2px dashed ${color}; border-radius:14px; margin:26px 0; font-family:'Courier New',monospace; direction:ltr; }
  .btn { display:inline-block; background:${color}; color:#ffffff !important; padding:14px 34px; border-radius:10px; text-decoration:none; font-weight:700; margin:18px 0; font-size:15px; }
  table.details { width:100%; border-collapse:collapse; margin:16px 0; }
  table.details td { padding:10px 14px; border-bottom:1px solid #f0f0f0; }
  table.details td:first-child { color:#888; width:40%; font-size:13px; }
  table.details td:last-child { font-weight:600; color:#222; }
  @media (max-width:620px) { .px { padding-left:22px !important; padding-right:22px !important; } }
</style></head>
<body style="margin:0;padding:0;background:#f3f1ef;direction:rtl;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${title} — ${c.headerTitle}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ef;padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 28px rgba(0,0,0,.08);font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
    <tr><td style="height:6px;background:${color};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td align="center" style="padding:30px 32px 18px;">
      ${logo
        ? `<a href="${c.websiteUrl}" style="text-decoration:none;"><img src="${logo}" alt="${c.headerTitle}" width="220" style="display:block;width:220px;max-width:70%;height:auto;border:0;"></a>`
        : `<div style="font-size:22px;font-weight:800;color:${color};">${c.headerTitle}</div>`}
    </td></tr>
    <tr><td class="px" style="padding:0 40px;"><div style="height:1px;background:#eee;"></div></td></tr>
    <tr><td class="px" style="padding:26px 40px 8px;text-align:right;">
      <h1 style="margin:0;font-size:21px;font-weight:800;color:#1f1f1f;">${title}</h1>
    </td></tr>
    <tr><td class="px" style="padding:6px 40px 32px;color:#3a3a3a;line-height:1.9;font-size:15px;text-align:right;">${bodyHtml}</td></tr>
    <tr><td style="background:#faf8f7;padding:22px 32px;text-align:center;border-top:1px solid #f0ecea;">
      <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:6px;">${c.headerTitle}</div>
      <div style="font-size:12px;color:#9a9a9a;line-height:1.8;">
        ${c.footerText}<br>
        <a href="${c.websiteUrl}" style="color:${color};text-decoration:none;">${site}</a> · © ${new Date().getFullYear()} جميع الحقوق محفوظة
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

// Sends a templated email using the configured sender/transport. Throws on failure.
/**
 * May an email of this category leave?
 *
 * Mirrors WHATSAPP_OUTBOUND_CATEGORIES, which production already sets to
 * `otp,inbox_reply,channel_test` — so WhatsApp has had a way to stop a
 * broadcast at the transport, before a number is resolved or a provider is
 * touched, and email has had none.
 *
 *   EMAIL_OUTBOUND_CATEGORIES=all       everything (the default when unset)
 *   EMAIL_OUTBOUND_CATEGORIES=otp,...   only those categories
 *   EMAIL_OUTBOUND_CATEGORIES=          nothing at all
 *
 * Read per call, so a restart applies it without a deploy. Unset means 'all'
 * because this control is being added to a system that was already sending;
 * defaulting to silence would cut a live institute off the moment it shipped.
 */
function isEmailCategoryAllowed(category) {
  const raw = process.env.EMAIL_OUTBOUND_CATEGORIES;
  if (raw === undefined || String(raw).trim().toLowerCase() === 'all') return true;
  const allowed = new Set(
    String(raw).split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
  );
  if (!allowed.size) return false;
  const name = String(category || '').trim().toLowerCase();
  return name ? allowed.has(name) : false;
}

async function sendEmail(to, subject, bodyHtml, options = {}) {
  if (to && typeof to === 'object') {
    options = { ...to };
    subject = to.subject;
    bodyHtml = to.html || to.body || '';
    to = to.to;
  }
  const tenantId = options.tenantId || DEFAULT_TENANT;

  // The same gate WhatsApp already has, on the channel that had none.
  //
  // EMAIL_OUTBOUND_CATEGORIES lists what may leave: 'all' for everything, a
  // comma-separated list to allow only those, empty to send nothing. It is read
  // per call rather than at import, so turning it off takes a restart of the
  // service and not a deploy.
  //
  // Unset means 'all', because this is a control being added to a system that
  // was already sending — a default of "nothing" would silence a live
  // institute the moment this shipped.
  if (!isEmailCategoryAllowed(options.category)) {
    logger.info('[email] suppressed by EMAIL_OUTBOUND_CATEGORIES', {
      category: options.category || '(none)', to: '[EMAIL]',
    });
    return { suppressed: true, category: options.category || null };
  }

  try {
    const c = await getEmailConfig(tenantId);
    const transport = await getTransport(tenantId);
    const info = await transport.sendMail({
      from: `"${c.senderName}" <${c.senderAddress}>`,
      to, subject,
      html: htmlEmail(subject, bodyHtml, c),
    });
    assertRecipientAccepted(to, info);
    recordDelivery(tenantId, null);
    return info;
  } catch (error) {
    recordDelivery(tenantId, error);
    throw error;
  }
}

// ── Delivery health ──────────────────────────────────────────────────────────
// SMTP auth failing (535) is silent from the panel's side: every caller catches
// its own send error and moves on, so receipts simply stop arriving and nobody
// finds out until a customer complains. Every send now records its outcome here
// and GET /api/admin/settings/email/health reports it.
const deliveryHealth = new Map();

function recordDelivery(tenantId, error) {
  const key = String(tenantId || DEFAULT_TENANT);
  const state = deliveryHealth.get(key) || {
    lastSuccessAt: null, lastFailureAt: null, lastError: null, failuresSinceSuccess: 0,
  };
  if (error) {
    state.lastFailureAt = new Date().toISOString();
    state.lastError = String(error.message || error).slice(0, 300);
    state.failuresSinceSuccess += 1;
    // One line per failure would flood; the first after a healthy run is the
    // one worth seeing in the log.
    if (state.failuresSinceSuccess === 1) {
      logger.error('[email] delivery started failing', { tenantId: key, err: state.lastError });
    }
  } else {
    state.lastSuccessAt = new Date().toISOString();
    state.failuresSinceSuccess = 0;
    state.lastError = null;
  }
  deliveryHealth.set(key, state);
}

function getDeliveryHealth(tenantId = DEFAULT_TENANT) {
  const key = String(tenantId || DEFAULT_TENANT);
  return deliveryHealth.get(key) || {
    lastSuccessAt: null, lastFailureAt: null, lastError: null, failuresSinceSuccess: 0,
  };
}

function mailbox(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  return String(value?.address || '').trim().toLowerCase();
}

function assertRecipientAccepted(to, info) {
  const intended = mailbox(to);
  const accepted = Array.isArray(info?.accepted) ? info.accepted.map(mailbox) : [];
  const rejected = Array.isArray(info?.rejected) ? info.rejected.map(mailbox) : [];
  if (!intended || rejected.includes(intended) || !accepted.includes(intended)) {
    const error = new Error('SMTP provider did not accept the intended recipient');
    error.code = 'EMAIL_RECIPIENT_NOT_ACCEPTED';
    throw error;
  }
  return info;
}

// Backward-compatible `mailer` facade: existing `mailer.sendMail(opts)` calls
// now go through the configured transport, with the configured sender as the
// default `from`. If a caller passes raw `html`, it is sent as-is.
const mailer = {
  async sendMail(opts) {
    const tenantId = opts?.tenantId || DEFAULT_TENANT;
    try {
      const c = await getEmailConfig(tenantId);
      const transport = await getTransport(tenantId);
      const { tenantId: _tenantId, ...mailOptions } = opts || {};
      const info = await transport.sendMail({ from: `"${c.senderName}" <${c.senderAddress}>`, ...mailOptions });
      assertRecipientAccepted(mailOptions.to, info);
      recordDelivery(tenantId, null);
      return info;
    } catch (error) {
      recordDelivery(tenantId, error);
      throw error;
    }
  },
  async verify(tenantId = DEFAULT_TENANT) { return (await getTransport(tenantId)).verify(); },
};

module.exports = {
  mailer, sendEmail, htmlEmail, getEmailConfig, invalidateEmailConfig, assertRecipientAccepted,
  getDeliveryHealth,
};
