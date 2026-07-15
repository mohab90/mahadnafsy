'use strict';

require('dotenv').config();

const { pool } = require('../lib/db');
const { getEmailConfig, mailer } = require('../lib/email');
const { getWaCfg, resolveProvider } = require('../lib/whatsapp');
const { getPaymentGatewaySettings, isPaymobActive } = require('../lib/saasSettings');

const liveExternal = process.argv.includes('--live-external');

function isPlaceholder(value) {
  const v = String(value || '').trim().toLowerCase();
  return !v
    || v.includes('your_')
    || v.includes('changeme')
    || v.includes('placeholder')
    || v === 'secret'
    || v === 'password'
    || v === 'test';
}

function hasReal(value) {
  return !isPlaceholder(value);
}

const checks = [];

function check(id, ok, message, detail) {
  checks.push({ id, ok: Boolean(ok), message, detail: detail || '' });
}

async function main() {
  check(
    'schema-policy',
    process.env.ALLOW_RUNTIME_SCHEMA_DDL !== '1' && process.env.ENABLE_LEGACY_STARTUP_TASKS !== '1',
    'Runtime DDL must stay disabled outside migrations',
    'ALLOW_RUNTIME_SCHEMA_DDL and ENABLE_LEGACY_STARTUP_TASKS must not be enabled in production.'
  );

  check(
    'jwt-secret',
    hasReal(process.env.JWT_SECRET) && String(process.env.JWT_SECRET).length >= 48,
    'JWT_SECRET must be a real secret with at least 48 characters'
  );

  check(
    'admin-emails',
    String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean).length > 0,
    'ADMIN_EMAILS must contain at least one production admin email'
  );

  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    check('database', true, `Database reachable (${Date.now() - t0}ms)`);
  } catch (e) {
    check('database', false, 'Database is not reachable', e.message);
  }

  try {
    const email = await getEmailConfig();
    const emailReady = hasReal(email.smtpHost) && Number(email.smtpPort) > 0
      && hasReal(email.smtpUser) && hasReal(email.smtpPass) && hasReal(email.senderAddress || email.smtpUser);
    check('smtp-config', emailReady, 'SMTP production credentials must be configured', JSON.stringify({
      host: email.smtpHost,
      port: email.smtpPort,
      user: email.smtpUser,
      hasPassword: hasReal(email.smtpPass),
      sender: email.senderAddress || email.smtpUser,
    }));
    if (emailReady && liveExternal) {
      try {
        await mailer.verify();
        check('smtp-live-verify', true, 'SMTP live verify succeeded');
      } catch (e) {
        check('smtp-live-verify', false, 'SMTP live verify failed', e.message);
      }
    }
  } catch (e) {
    check('smtp-config', false, 'SMTP config could not be read', e.message);
  }

  try {
    const cfg = await getWaCfg();
    const provider = resolveProvider(cfg);
    const metaReady = hasReal(cfg.metaToken || process.env.WHATSAPP_TOKEN)
      && hasReal(cfg.metaPhoneId || process.env.WHATSAPP_PHONE_ID);
    const greenReady = hasReal(cfg.instanceId || process.env.WA_INSTANCE_ID)
      && hasReal(cfg.apiToken || process.env.WA_API_TOKEN);
    check(
      'whatsapp-config',
      provider === 'meta' ? metaReady : greenReady,
      'WhatsApp provider credentials must be configured',
      JSON.stringify({ provider, metaReady, greenReady })
    );
  } catch (e) {
    check('whatsapp-config', false, 'WhatsApp config could not be read', e.message);
  }

  try {
    const payment = await getPaymentGatewaySettings();
    const paymob = payment.paymob || {};
    const paymobReady = isPaymobActive(payment)
      && hasReal(paymob.api_key || process.env.PAYMOB_API_KEY)
      && hasReal(paymob.hmac_secret || process.env.PAYMOB_HMAC_SECRET)
      && hasReal(paymob.integration_id_card || process.env.PAYMOB_INTEGRATION_ID)
      && hasReal(paymob.iframe_id || process.env.PAYMOB_IFRAME_ID);
    check('paymob-config', paymobReady, 'Paymob sandbox/live credentials must be configured and active', JSON.stringify({
      activeProvider: payment.active_provider,
      mode: payment.mode,
      enabled: !!paymob.enabled,
      hasApiKey: hasReal(paymob.api_key || process.env.PAYMOB_API_KEY),
      hasHmac: hasReal(paymob.hmac_secret || process.env.PAYMOB_HMAC_SECRET),
      hasIntegration: hasReal(paymob.integration_id_card || process.env.PAYMOB_INTEGRATION_ID),
      hasIframe: hasReal(paymob.iframe_id || process.env.PAYMOB_IFRAME_ID),
    }));
  } catch (e) {
    check('paymob-config', false, 'Paymob config could not be read', e.message);
  }

  check(
    'sentry-config',
    hasReal(process.env.SENTRY_DSN),
    'SENTRY_DSN must be configured for real observability'
  );

  check(
    'queue-redis',
    hasReal(process.env.REDIS_URL || process.env.QUEUE_REDIS_URL),
    'REDIS_URL or QUEUE_REDIS_URL must be configured for staging/production queue workers'
  );

  const failed = checks.filter(c => !c.ok);
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`${mark} ${c.id}: ${c.message}${c.detail ? ` | ${c.detail}` : ''}`);
  }
  console.log(`SUMMARY total=${checks.length} pass=${checks.length - failed.length} fail=${failed.length}`);
  await pool.end().catch(() => {});
  if (failed.length) process.exit(1);
}

main().catch(async (e) => {
  console.error('FAIL readiness-script:', e.stack || e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
