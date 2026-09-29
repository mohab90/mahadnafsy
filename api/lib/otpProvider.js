'use strict';

const { toDialable } = require('./phoneNumber');
const { getOtpProviderSettings } = require('./saasSettings');

async function sendGreenApiWhatsApp({ phone, message, instanceId, apiToken }) {
  if (!phone || !instanceId || !apiToken) return { ok: false, reason: 'not_configured' };
  const dialable = toDialable(phone);
  if (!dialable) return { ok: false, reason: 'undialable_phone' };
  const chatId = `${dialable}@c.us`;
  const response = await fetch(`https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.idMessage ? { ok: true, idMessage: data.idMessage } : { ok: false, reason: data };
}

async function sendSmsOtp({ phone, message, settings }) {
  const cfg = settings?.sms || {};
  const provider = String(cfg.provider || '').toLowerCase().trim();
  if (!cfg.enabled) return { ok: false, reason: 'sms_disabled' };
  if (!phone) return { ok: false, reason: 'missing_phone' };
  const dialable = toDialable(phone);
  if (!dialable) return { ok: false, reason: 'undialable_phone' };

  if (provider === 'vonage' || provider === 'nexmo') {
    if (!cfg.api_key || !cfg.api_secret) return { ok: false, reason: 'missing_vonage_credentials' };
    const body = new URLSearchParams({
      api_key: String(cfg.api_key),
      api_secret: String(cfg.api_secret),
      to: dialable,
      from: String(cfg.sender_id || 'MAHAD').slice(0, 11),
      text: message,
    });
    const response = await fetch('https://rest.nexmo.com/sms/json', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    const first = Array.isArray(data.messages) ? data.messages[0] : null;
    return response.ok && first?.status === '0' ? { ok: true, provider } : { ok: false, provider, reason: data };
  }

  if (provider === 'twilio') {
    if (!cfg.account_sid || !cfg.auth_token || !cfg.from_number) return { ok: false, reason: 'missing_twilio_credentials' };
    const body = new URLSearchParams({ To: `+${dialable}`, From: String(cfg.from_number), Body: message });
    const auth = Buffer.from(`${cfg.account_sid}:${cfg.auth_token}`).toString('base64');
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.account_sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body,
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.sid ? { ok: true, provider, sid: data.sid } : { ok: false, provider, reason: data };
  }

  if (provider === 'webhook' || cfg.webhook_url) {
    if (!cfg.webhook_url) return { ok: false, reason: 'missing_webhook_url' };
    const response = await fetch(String(cfg.webhook_url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {}),
      },
      body: JSON.stringify({ to: `+${dialable}`, from: cfg.sender_id || 'MAHAD', text: message }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, provider: 'webhook', response: data } : { ok: false, provider: 'webhook', reason: data };
  }

  return { ok: false, reason: 'unsupported_sms_provider', provider };
}

async function sendSms({ phone, message, tenantId = 'tenant-default' }) {
  const settings = await getOtpProviderSettings(tenantId);
  const result = await sendSmsOtp({ phone, message, settings });
  if (!result.ok) throw new Error(`SMS delivery failed: ${typeof result.reason === 'string' ? result.reason : 'provider_error'}`);
  return result;
}

module.exports = { sendGreenApiWhatsApp, sendSms, sendSmsOtp };
