'use strict';

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { sendGreenApiWhatsApp, sendSmsOtp } = require('./otpProvider');

const PROVIDERS = new Set(['facebook', 'google_sheets']);
const OTP_CHANNELS = new Set(['email', 'whatsapp', 'sms']);

function result(ok, provider, mode, message, checks = []) {
  return { ok, provider, mode, message, checks, checked_at: new Date().toISOString() };
}

function complete(value) { return String(value || '').trim().length > 0; }

function check(name, ok, required = true) { return { name, ok: !!ok, required }; }

function withTimeout(fetchImpl, timeoutMs = 8000) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
}

async function readResponsePrefix(response, limit = 16384) {
  if (!response.body?.getReader) return String(await response.text()).slice(0, limit);
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  try {
    while (size < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      const slice = value.slice(0, limit - size);
      parts.push(slice);
      size += slice.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts.map(part => Buffer.from(part))).toString('utf8');
}

function diagnosePayment(config) {
  const manual = config?.manual || {};
  const methods = manual.supported_methods || manual.methods || [];
  const checks = [
    check('manual_enabled', manual.enabled === true),
    check('payment_methods_configured', Array.isArray(methods) && methods.length > 0),
    check('proof_review_enabled', manual.require_proof_review !== false, false),
    check('paymob_external_probe_suspended', true, false),
  ];
  const ready = checks.filter(item => item.required).every(item => item.ok);
  return result(
    ready,
    'payment_gateway',
    'local',
    ready ? 'الدفع اليدوي جاهز محلياً، واختبار Paymob الخارجي موقوف مؤقتاً.' : 'إعدادات الدفع اليدوي غير مكتملة.',
    checks
  );
}

async function diagnoseFacebook(config, fetchImpl = global.fetch) {
  const fb = config?.facebook || {};
  const checks = [
    check('enabled', fb.enabled === true),
    check('page_id', complete(fb.page_id)),
    check('page_access_token', complete(fb.page_access_token)),
    check('webhook_verify_token', complete(fb.verify_token || fb.webhook_verify_token)),
    check('app_secret', complete(fb.app_secret)),
  ];
  if (!checks.every(item => item.ok)) {
    return result(false, 'facebook', 'configuration', 'إعدادات Facebook Lead Ads غير مكتملة.', checks);
  }
  const fetchTimed = withTimeout(fetchImpl);
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${encodeURIComponent(fb.page_id)}`);
    url.searchParams.set('fields', 'id,name');
    url.searchParams.set('access_token', fb.page_access_token);
    const response = await fetchTimed(url, { headers: { Accept: 'application/json' } });
    checks.push(check('graph_api_accessible', response.ok));
    return result(response.ok, 'facebook', 'live', response.ok ? 'اتصال Facebook ناجح.' : `Facebook رفض الاتصال (${response.status}).`, checks);
  } catch (error) {
    checks.push(check('graph_api_accessible', false));
    const timedOut = error?.name === 'AbortError';
    return result(false, 'facebook', 'live', timedOut ? 'انتهت مهلة اتصال Facebook.' : 'تعذر الاتصال بـFacebook.', checks);
  }
}

function normalizeSheets(config, legacyCrm = {}) {
  const direct = config?.google_sheets?.sheets;
  if (Array.isArray(direct) && direct.length) return direct;
  return Array.isArray(legacyCrm?.sheets) ? legacyCrm.sheets : [];
}

async function diagnoseGoogleSheets(config, legacyCrm = {}, fetchImpl = global.fetch) {
  const gs = config?.google_sheets || {};
  const sheets = normalizeSheets(config, legacyCrm).filter(sheet => complete(sheet.sheetId || sheet.sheet_id));
  const checks = [check('enabled', gs.enabled === true), check('sheets_configured', sheets.length > 0)];
  if (!checks.every(item => item.ok)) {
    return result(false, 'google_sheets', 'configuration', 'إعدادات Google Sheets غير مكتملة.', checks);
  }
  const first = sheets[0];
  const sheetId = first.sheetId || first.sheet_id;
  const gid = first.gid || (Array.isArray(first.gids) ? first.gids[0] : '');
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`;
  try {
    const response = await withTimeout(fetchImpl)(url, { headers: { Accept: 'text/csv', Range: 'bytes=0-16383' }, redirect: 'follow' });
    const prefix = response.ok ? await readResponsePrefix(response) : '';
    const html = /^\s*(<!doctype|<html|<\?xml)/i.test(prefix);
    const accessible = response.ok && !!prefix.trim() && !html;
    checks.push(check('sheet_accessible', accessible));
    return result(accessible, 'google_sheets', 'live', accessible ? 'Google Sheets متاحة للقراءة.' : 'الشيت غير متاح أو غير منشور للقراءة.', checks);
  } catch (error) {
    checks.push(check('sheet_accessible', false));
    return result(false, 'google_sheets', 'live', error?.name === 'AbortError' ? 'انتهت مهلة اتصال Google Sheets.' : 'تعذر الاتصال بـGoogle Sheets.', checks);
  }
}

function validateOtpTarget(channel, to) {
  if (!to) return true;
  if (channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) && to.length <= 254;
  const digits = to.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function otpConfigChecks(channel, config) {
  const cfg = config?.[channel] || {};
  if (channel === 'email') return [
    check('enabled', cfg.enabled === true), check('smtp_host', complete(cfg.smtp_host)),
    check('smtp_user', complete(cfg.smtp_user)), check('smtp_password', complete(cfg.smtp_password)),
  ];
  if (channel === 'whatsapp') return [
    check('enabled', cfg.enabled === true), check('instance_id', complete(cfg.instance_id)),
    check('api_token', complete(cfg.api_token)),
  ];
  const provider = String(cfg.provider || '').toLowerCase();
  const credentialsReady = provider === 'twilio'
    ? complete(cfg.account_sid) && complete(cfg.auth_token) && complete(cfg.from_number)
    : provider === 'webhook'
      ? complete(cfg.webhook_url)
      : complete(cfg.api_key) && complete(cfg.api_secret);
  return [check('enabled', cfg.enabled === true), check('provider', complete(provider)), check('credentials', credentialsReady)];
}

async function sendEmailDiagnostic(to, config) {
  const cfg = config.email || {};
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port || 587),
    secure: cfg.secure === true || Number(cfg.smtp_port) === 465,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
  });
  await transport.sendMail({
    from: `"${String(cfg.from_name || 'Mahad Nafsy').slice(0, 100)}" <${cfg.from_email || cfg.smtp_user}>`,
    to,
    subject: 'Mahad OTP diagnostic',
    text: `Diagnostic code: ${crypto.randomInt(100000, 1000000)}`,
  });
  return { ok: true };
}

async function diagnoseOtp(channel, to, config, senders = {}) {
  if (!OTP_CHANNELS.has(channel)) throw new Error('Unsupported OTP channel');
  const target = String(to || '').trim();
  if (!validateOtpTarget(channel, target)) throw new Error('Invalid OTP test recipient');
  const checks = otpConfigChecks(channel, config);
  if (!checks.every(item => item.ok)) return result(false, channel, 'configuration', `إعدادات OTP لقناة ${channel} غير مكتملة.`, checks);
  if (!target) return result(true, channel, 'dry-run', `إعدادات OTP لقناة ${channel} مكتملة ولم يتم إرسال رسالة.`, checks);

  const code = String(crypto.randomInt(100000, 1000000));
  const message = `Mahad diagnostic OTP: ${code}`;
  try {
    let sendResult;
    if (channel === 'email') sendResult = await (senders.email || sendEmailDiagnostic)(target, config);
    if (channel === 'whatsapp') {
      const cfg = config.whatsapp || {};
      sendResult = await (senders.whatsapp || sendGreenApiWhatsApp)({ phone: target, message, instanceId: cfg.instance_id, apiToken: cfg.api_token });
    }
    if (channel === 'sms') sendResult = await (senders.sms || sendSmsOtp)({ phone: target, message, settings: config });
    const ok = sendResult?.ok === true;
    checks.push(check('message_accepted', ok));
    return result(ok, channel, 'live', ok ? `تم إرسال رسالة اختبار عبر ${channel}.` : `رفض مزود ${channel} رسالة الاختبار.`, checks);
  } catch (_) {
    checks.push(check('message_accepted', false));
    return result(false, channel, 'live', `تعذر إرسال رسالة الاختبار عبر ${channel}.`, checks);
  }
}

module.exports = {
  PROVIDERS,
  diagnoseFacebook,
  diagnoseGoogleSheets,
  diagnoseOtp,
  diagnosePayment,
  normalizeSheets,
  otpConfigChecks,
  readResponsePrefix,
  validateOtpTarget,
};
