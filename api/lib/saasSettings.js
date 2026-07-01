'use strict';

const { pool } = require('./db');

const DEFAULT_PAYMENT_GATEWAY = {
  active_provider: 'manual',
  mode: 'sandbox',
  manual: { enabled: true, instructions: '', methods: ['bank_transfer', 'vodafone_cash', 'instapay'] },
  paymob: {
    enabled: false,
    merchant_id: '',
    api_key: '',
    secret_key: '',
    hmac_secret: '',
    integration_id_card: '',
    integration_id_wallet: '',
    iframe_id: '',
    webhook_url: '/api/webhooks/paymob',
    callback_url: '/success',
  },
};

const DEFAULT_LEAD_SOURCE_CONNECTORS = {
  facebook: {
    enabled: false,
    verify_token: '',
    page_access_token: '',
    app_secret: '',
    default_status: 'new',
    default_branch: '',
    default_lead_type: 'general',
    default_interested_course_id: '',
    default_assigned_sales_id: '',
  },
  google_sheets: { enabled: false, auto_sync_minutes: 15, sheets: [] },
  api_sources: [],
};

const DEFAULT_OTP_PROVIDER = {
  active_channel: 'email',
  code_ttl_minutes: 15,
  max_attempts: 5,
  email: { enabled: true, from_name: '', smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', secure: false },
  whatsapp: { enabled: false, provider: 'green_api', instance_id: '', api_token: '', template: 'رمز التحقق الخاص بك: {{code}}' },
  sms: { enabled: false, provider: '', sender_id: '', api_key: '', api_secret: '', template: 'رمز التحقق الخاص بك: {{code}}' },
};

const DEFAULT_BRANCH_WORKSPACES = [
  { key: 'online_egypt', slug: 'online-egypt', label: 'Online Egypt', type: 'online', is_active: true, timezone: 'Africa/Cairo', currency: 'EGP', modules: ['clients', 'leads', 'payments'], tabs: ['online_clients', 'leads', 'orders'] },
  { key: 'daqqi', slug: 'daqqi', label: 'Daqqi Branch', type: 'physical', is_active: true, timezone: 'Africa/Cairo', currency: 'EGP', modules: ['clients', 'schedule', 'payments'], tabs: ['daqqi_schedule', 'online_clients', 'orders'] },
];

function tryParseJson(value, fallback) {
  try {
    if (!value) return fallback;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    return fallback;
  }
}

function mergeObject(defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults;
  if (!defaults || typeof defaults !== 'object') return value ?? defaults;
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = { ...defaults, ...src };
  for (const key of Object.keys(defaults)) {
    if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      out[key] = mergeObject(defaults[key], src[key]);
    }
  }
  return out;
}

function normalizeLeadSourceConnectors(config) {
  const fb = config.facebook || {};
  config.facebook = {
    ...fb,
    verify_token: fb.verify_token || fb.webhook_verify_token || '',
    webhook_verify_token: fb.webhook_verify_token || fb.verify_token || '',
    default_assigned_sales_id: fb.default_assigned_sales_id || fb.default_sales_id || '',
    default_sales_id: fb.default_sales_id || fb.default_assigned_sales_id || '',
    default_interested_course_id: fb.default_interested_course_id || fb.default_course_id || '',
  };
  const sheets = config.google_sheets || {};
  config.google_sheets = {
    ...sheets,
    auto_sync_minutes: sheets.auto_sync_minutes || sheets.auto_sync_interval_minutes || 15,
    auto_sync_enabled: sheets.auto_sync_enabled !== false && sheets.auto_sync !== false,
  };
  return config;
}

function normalizeOtpProvider(config) {
  config.active_channel = config.active_channel || config.preferred_channel || 'email';
  config.preferred_channel = config.preferred_channel || config.active_channel;
  config.code_ttl_minutes = Number(config.code_ttl_minutes || config.expiry_minutes || 15);
  config.expiry_minutes = Number(config.expiry_minutes || config.code_ttl_minutes || 15);
  return config;
}

async function getSysConfig(section, defaults) {
  const [[row]] = await pool.query('SELECT `value` FROM site_config WHERE `key`=? LIMIT 1', [`sys_${section}`]);
  return mergeObject(defaults, tryParseJson(row?.value, defaults));
}

function isPaymobActive(config) {
  return config?.active_provider === 'paymob' && !!config?.paymob?.enabled;
}

async function getPaymentGatewaySettings() {
  return getSysConfig('payment_gateway', DEFAULT_PAYMENT_GATEWAY);
}

async function getLeadSourceConnectorSettings() {
  return normalizeLeadSourceConnectors(await getSysConfig('lead_source_connectors', DEFAULT_LEAD_SOURCE_CONNECTORS));
}

async function getOtpProviderSettings() {
  return normalizeOtpProvider(await getSysConfig('otp_provider', DEFAULT_OTP_PROVIDER));
}

async function getBranchWorkspaces() {
  try {
    const [rows] = await pool.query(`
      SELECT branch_key, slug, label, branch_type, timezone, currency, modules_json, tabs_json, is_active
      FROM branches
      WHERE is_active = 1
      ORDER BY FIELD(branch_key, 'online_egypt', 'daqqi'), label
    `);
    if (rows.length) {
      return rows.map(row => ({
        key: row.branch_key,
        slug: row.slug,
        label: row.label,
        type: row.branch_type || 'other',
        is_active: !!row.is_active,
        timezone: row.timezone || 'Africa/Cairo',
        currency: row.currency || 'EGP',
        modules: tryParseJson(row.modules_json, []),
        tabs: tryParseJson(row.tabs_json, []),
      }));
    }
  } catch (_) {
    // Older databases may not have the normalized branches table yet.
  }
  return getSysConfig('branch_workspaces', DEFAULT_BRANCH_WORKSPACES);
}

module.exports = {
  DEFAULT_BRANCH_WORKSPACES,
  DEFAULT_LEAD_SOURCE_CONNECTORS,
  DEFAULT_OTP_PROVIDER,
  DEFAULT_PAYMENT_GATEWAY,
  getBranchWorkspaces,
  getLeadSourceConnectorSettings,
  getOtpProviderSettings,
  getPaymentGatewaySettings,
  isPaymobActive,
};
