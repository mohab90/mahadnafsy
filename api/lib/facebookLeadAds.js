'use strict';

const { pool } = require('./db');
const logger = require('./logger').child({ module: 'facebook-lead-ads' });
const { tryJson } = require('./helpers');
const { getLeadSourceConnectorSettings } = require('./saasSettings');

async function getFbLeadConfig() {
  const [rows] = await pool.query("SELECT `key`, `value` FROM site_config WHERE `key` IN ('facebook_lead_ads', 'settings')");
  let cfg = {};
  for (const row of rows) {
    const data = tryJson(row.value, {});
    if (row.key === 'facebook_lead_ads') {
      Object.assign(cfg, data);
    } else if (row.key === 'settings' && data.fbLeadAdsConfig) {
      const fb = data.fbLeadAdsConfig;
      if (fb.defaultInterestedCourseId && !cfg.defaultInterestedCourseId) cfg.defaultInterestedCourseId = fb.defaultInterestedCourseId;
      if (fb.defaultBranch && !cfg.defaultBranch) cfg.defaultBranch = fb.defaultBranch;
      if (fb.defaultAssignedSalesId && !cfg.defaultAssignedSalesId) cfg.defaultAssignedSalesId = fb.defaultAssignedSalesId;
    }
  }
  const connectorSettings = await getLeadSourceConnectorSettings().catch(() => ({}));
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

async function getNextSalesRep() {
  const [reps] = await pool.execute(
    `SELECT id, name FROM staff WHERE role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`
  );
  if (!reps.length) return null;
  const [counts] = await pool.execute(
    `SELECT assigned_sales_id, COUNT(*) as cnt FROM leads WHERE hidden=0 AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`
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
