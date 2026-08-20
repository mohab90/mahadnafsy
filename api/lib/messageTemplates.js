'use strict';
const logger = require('./logger');
/**
 * Message-template engine. The admin edits WhatsApp templates in the Settings page
 * (saved to site_config content['msg.templates'] as JSON: { key: text }). This
 * module loads them at startup + on change and renders {{var}} placeholders against
 * runtime values. If a template is not customized, the built-in default is used.
 *
 * Templates are edited from the admin UI and stored in site_config; there is no
 * second copy of the defaults to keep in sync. (A mirrored
 * admin/pages/dashboard/messageTemplates.ts once existed but nothing imported
 * it, so the "keep in sync" contract it named was already dead; it is removed.)
 */
const { pool } = require('./db');
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

// Built-in defaults (the original hardcoded texts). {{var}} placeholders are filled
// by renderTemplate. Keep var names identical to the frontend defs.
const TEMPLATE_DEFAULTS = Object.freeze({
  installment_reminder:
    '⏰ تذكير: لديك قسط بمبلغ {{amount}} {{currency}} مستحق بعد 3 أيام ({{dueDate}}) - {{courseName}}. يرجى التواصل معنا لتسوية الدفع. — معهد مهاد',
  pending_payment_reminder:
    '⏰ تذكير: لديك دفعة معلّقة بمبلغ {{amount}} {{currency}} منذ {{date}}. يرجى إتمام الدفع أو التواصل معنا. — معهد مهاد 🌿',
  daqqi_session_reminder:
    'مرحباً {{name}} 💚\nتذكير بجلسة الدقي القادمة:\n📚 الكورس: {{courseTitle}}\n📅 التاريخ: {{sessionDate}}\n⏰ الوقت: {{timeLabel}}\n\nنتطلع لرؤيتك! 🌿\n— مهاد نفسي',
  lead_retargeting:
    'أهلاً {{name}} 💜\nمهاد نفسي — المعهد المتخصص في الصحة النفسية 🌱\n\nنحن هنا لدعمك في رحلتك نحو التطور المهني.\nتواصل معنا الآن لمعرفة أحدث البرامج المتاحة 📚\n\nللاستفسار تواصل معنا عبر الواتساب 💚',
});

const customByTenant = new Map();
let _timer = null;

function setTemplates(obj, tenantId = DEFAULT_TENANT) {
  const next = Object.create(null);
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim() && Object.prototype.hasOwnProperty.call(TEMPLATE_DEFAULTS, k)) {
        next[k] = v;
      }
    }
  }
  customByTenant.set(String(tenantId || DEFAULT_TENANT), next);
  return next;
}

/** Fill {{var}} (whitespace-tolerant) from `vars`; unknown placeholders become ''. */
function renderTemplate(key, vars = {}, tenantId = DEFAULT_TENANT) {
  const custom = customByTenant.get(String(tenantId || DEFAULT_TENANT)) || Object.create(null);
  const tpl = custom[key] || TEMPLATE_DEFAULTS[key] || '';
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) => {
    const val = vars[name];
    return val === undefined || val === null ? '' : String(val);
  });
}

async function loadTemplates(tenantId = DEFAULT_TENANT) {
  try {
    const content = await getTenantSetting('content', { tenantId, fallback: {} }) || {};
    const raw = content && content['msg.templates'];
    let tpls = {};
    if (raw) { try { tpls = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { tpls = {}; } }
    return setTemplates(tpls, tenantId);
  } catch (e) {
    logger.error('[messageTemplates] load failed:', e.message);
    return null;
  }
}

function startTemplatesRefresh(intervalMs = 60 * 1000) {
  const refresh = async () => {
    const [rows] = await pool.query("SELECT id FROM tenants WHERE status='active'").catch(() => [[]]);
    const tenantIds = rows.length ? rows.map(row => row.id) : [DEFAULT_TENANT];
    await Promise.all(tenantIds.map(tenantId => loadTemplates(tenantId)));
  };
  refresh().catch(() => {});
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => { refresh().catch(() => {}); }, intervalMs);
  if (_timer.unref) _timer.unref();
  return _timer;
}

module.exports = { TEMPLATE_DEFAULTS, setTemplates, renderTemplate, loadTemplates, startTemplatesRefresh };
