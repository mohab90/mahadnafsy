'use strict';
// ── Email helpers (config-driven) ─────────────────────────────────────────────
// Sender address, SMTP credentials, AND the message template are all editable
// from Admin → Settings → البريد (stored in site_config key 'email_config'),
// falling back to env vars then to sane defaults. So the owner can swap the
// sending mailbox or restyle customer emails without touching code.
const nodemailer = require('nodemailer');
const { pool, cached, cacheInvalidate } = require('./db');
const logger = require('./logger');
const { getBrandSettings } = require('./brandSettings');

const DEFAULTS = {
  smtpHost: process.env.SMTP_HOST || 'smtp.hostinger.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '465'),
  smtpUser: process.env.SMTP_USER || 'otp@mahadnafsy.com',
  smtpPass: process.env.SMTP_PASS || '',
  senderName: 'معهد الدراسات النفسية',
  senderAddress: '', // '' → use smtpUser
  brandColor: '#c0392b',
  headerTitle: 'معهد الدراسات النفسية',
  headerSubtitle: 'mahadnafsy.com',
  logoUrl: 'https://mahadnafsy.com/logo.png',
  footerText: 'هذا البريد أُرسل تلقائياً — يُرجى عدم الرد عليه',
};

// Loads + caches the email config from site_config (60s), merged over defaults.
async function getEmailConfig() {
  return cached('email_config', 60 * 1000, async () => {
    let saved = {};
    try {
      const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='email_config' LIMIT 1");
      if (rows[0]?.value) saved = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    } catch (e) { logger.warn('[email] config read failed', { err: e.message }); }
    // Pull the institute identity the owner set in Settings → الهوية so emails are
    // branded automatically. Precedence: explicit email_config > brand settings > defaults.
    let brandDefaults = {};
    try {
      const b = await getBrandSettings();
      brandDefaults = {
        senderName: b.instituteName,
        brandColor: b.primaryColor,
        headerTitle: b.instituteName,
        logoUrl: b.logoUrl,
        headerSubtitle: (b.websiteUrl || '').replace(/^https?:\/\//, ''),
      };
    } catch (e) { logger.warn('[email] brand read failed', { err: e.message }); }
    const cfg = { ...DEFAULTS, ...brandDefaults, ...saved };
    cfg.smtpPass = saved.smtpPass || DEFAULTS.smtpPass; // password may live in env only
    if (!cfg.senderAddress) cfg.senderAddress = cfg.smtpUser;
    return cfg;
  });
}

function invalidateEmailConfig() { cacheInvalidate('email_config'); }

async function getTransport() {
  const c = await getEmailConfig();
  return nodemailer.createTransport({
    host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465,
    auth: { user: c.smtpUser, pass: c.smtpPass },
  });
}

// Wraps body content in the branded template. `cfg` optional (defaults applied).
function htmlEmail(title, bodyHtml, cfg) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#f5f5f5; font-family:'Segoe UI',Tahoma,Arial,sans-serif; direction:rtl; }
  .wrap { max-width:600px; margin:30px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.10); }
  .header { background:${c.brandColor}; padding:36px 40px 28px; text-align:center; }
  .logo-circle { width:80px; height:80px; margin:0 auto 16px; background:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,.15); overflow:hidden; }
  .logo-circle img { width:68px; height:68px; object-fit:contain; }
  .header h1 { color:#fff; font-size:20px; font-weight:800; letter-spacing:-.3px; margin-bottom:4px; }
  .header p { color:rgba(255,255,255,.80); font-size:13px; }
  .divider { height:4px; background:${c.brandColor}; }
  .body { padding:36px 40px; color:#333; line-height:1.8; font-size:15px; }
  .footer { background:#fafafa; padding:20px 40px; text-align:center; color:#aaa; font-size:12px; border-top:1px solid #eee; }
  .footer a { color:${c.brandColor}; text-decoration:none; }
  .btn { display:inline-block; background:${c.brandColor}; color:#fff !important; padding:13px 32px; border-radius:10px; text-decoration:none; font-weight:700; margin:18px 0; font-size:15px; }
  .otp-box { font-size:40px; font-weight:900; letter-spacing:12px; color:${c.brandColor}; text-align:center; padding:24px 20px; background:#fdf2f2; border:2px solid #f5b7b1; border-radius:12px; margin:24px 0; font-family:monospace; }
  table.details { width:100%; border-collapse:collapse; margin:16px 0; }
  table.details td { padding:10px 14px; border-bottom:1px solid #f0f0f0; }
  table.details td:first-child { color:#999; width:40%; font-size:13px; }
  table.details td:last-child { font-weight:600; color:#222; }
</style></head>
<body><div class="wrap">
  <div class="header">
    <div class="logo-circle">
      <img src="${c.logoUrl}" alt="${c.headerTitle}" onerror="this.style.display='none';this.parentNode.innerHTML='<span style=&quot;font-size:28px&quot;>🌿</span>'" />
    </div>
    <h1>${c.headerTitle}</h1>
    <p>${c.headerSubtitle}</p>
  </div>
  <div class="divider"></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">
    ${c.footerText}<br>
    © ${new Date().getFullYear()} <a href="https://mahadnafsy.com">${c.headerTitle}</a> — جميع الحقوق محفوظة
  </div>
</div></body></html>`;
}

// Sends a templated email using the configured sender/transport. Throws on failure.
async function sendEmail(to, subject, bodyHtml) {
  const c = await getEmailConfig();
  const transport = await getTransport();
  await transport.sendMail({
    from: `"${c.senderName}" <${c.senderAddress}>`,
    to, subject,
    html: htmlEmail(subject, bodyHtml, c),
  });
}

// Backward-compatible `mailer` facade: existing `mailer.sendMail(opts)` calls
// now go through the configured transport, with the configured sender as the
// default `from`. If a caller passes raw `html`, it is sent as-is.
const mailer = {
  async sendMail(opts) {
    const c = await getEmailConfig();
    const transport = await getTransport();
    return transport.sendMail({ from: `"${c.senderName}" <${c.senderAddress}>`, ...opts });
  },
  async verify() { return (await getTransport()).verify(); },
};

module.exports = { mailer, sendEmail, htmlEmail, getEmailConfig, invalidateEmailConfig };
