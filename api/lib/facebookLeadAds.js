'use strict';

const { pool } = require('./db');
const logger = require('./logger').child({ module: 'facebook-lead-ads' });
const { tryJson } = require('./helpers');
const { getLeadSourceConnectorSettings } = require('./saasSettings');
const { getTenantSetting } = require('./tenantSettings');

async function getFbLeadConfig(tenantId) {
  const [legacyConfig, generalSettings] = await Promise.all([
    getTenantSetting('facebook_lead_ads', { tenantId, fallback: {} }),
    getTenantSetting('settings', { tenantId, fallback: {} }),
  ]);
  const parsedLegacy = typeof legacyConfig === 'string' ? tryJson(legacyConfig, {}) : legacyConfig;
  const parsedGeneral = typeof generalSettings === 'string' ? tryJson(generalSettings, {}) : generalSettings;
  let cfg = { ...(parsedLegacy || {}) };
  const legacyFb = (parsedGeneral || {}).fbLeadAdsConfig;
  if (legacyFb) {
    if (legacyFb.defaultInterestedCourseId && !cfg.defaultInterestedCourseId) cfg.defaultInterestedCourseId = legacyFb.defaultInterestedCourseId;
    if (legacyFb.defaultBranch && !cfg.defaultBranch) cfg.defaultBranch = legacyFb.defaultBranch;
    if (legacyFb.defaultAssignedSalesId && !cfg.defaultAssignedSalesId) cfg.defaultAssignedSalesId = legacyFb.defaultAssignedSalesId;
  }
  const connectorSettings = await getLeadSourceConnectorSettings(tenantId).catch(() => ({}));
  const fb = connectorSettings.facebook || {};
  if (fb.enabled) {
    cfg = {
      ...cfg,
      verifyToken: fb.verify_token || cfg.verifyToken,
      pageAccessToken: fb.page_access_token || cfg.pageAccessToken,
      appSecret: fb.app_secret || cfg.appSecret,
      defaultStatus: fb.default_status || cfg.defaultStatus,
      defaultBranch: fb.default_branch || cfg.defaultBranch,
      defaultLeadType: fb.default_lead_type || cfg.defaultLeadType,
      defaultInterestedCourseId: fb.default_interested_course_id || cfg.defaultInterestedCourseId,
      defaultAssignedSalesId: fb.default_assigned_sales_id || cfg.defaultAssignedSalesId,
    };
  }
  return cfg;
}

async function fetchFbLeadDetails(leadgenId, pageAccessToken) {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${pageAccessToken}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FB Graph API ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function getNextSalesRep(tenantId = 'tenant-default') {
  const [reps] = await pool.execute(
    `SELECT id, name FROM staff WHERE tenant_id=? AND role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`,
    [tenantId]
  );
  if (!reps.length) return null;
  const [counts] = await pool.execute(
    `SELECT assigned_sales_id, COUNT(*) as cnt FROM leads WHERE tenant_id=? AND hidden=0 AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`,
    [tenantId]
  );
  const countMap = {};
  for (const c of counts) countMap[c.assigned_sales_id] = Number(c.cnt);
  reps.sort((a, b) => (countMap[a.id] || 0) - (countMap[b.id] || 0));
  return reps[0];
}

if (!process.env.FB_VERIFY_TOKEN) {
  logger.warn('[FB] FB_VERIFY_TOKEN not set - Facebook webhook verification will fail');
}

module.exports = {
  fetchFbLeadDetails,
  getFbLeadConfig,
  getNextSalesRep,
};
