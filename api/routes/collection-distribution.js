'use strict';
// «التحصيل: التوزيع والشيتات» — lib/collectionDistribution.js.

const express = require('express');
const router = express.Router();

const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { sendRouteError } = require('../lib/helpers');
const { fetchCsvFollowRedirects, isHtmlResponse } = require('../lib/sheets');
const { sanitizeCollectionConfig } = require('../lib/collectionDistribution');

const LEAD_ROLES = new Set(['online_manager', 'sales_collection_manager']);

// Who runs collection: an administrator, or the managers over it. The online
// manager sees the distribute button on the screen and used to be refused by
// the route behind it.
function requireCollectionLead(req, res, next) {
  const role = String(req.staffRecord?.role || '').toLowerCase();
  if (req.isSuperAdmin || LEAD_ROLES.has(role)) return next();
  return res.status(403).json({ error: 'غير مصرح — للإدارة ومدير الأونلاين' });
}

const guard = [requireAuth, requireAdminOrStaff, requirePermission('manage_subscribers'), requireCollectionLead];

router.get('/api/admin/collection-distribution', ...guard, async (req, res) => {
  try {
    const stored = await getTenantSetting('collection_distribution', { tenantId: req.tenantId, fallback: {} });
    res.json(sanitizeCollectionConfig(stored || {}));
  } catch (error) { sendRouteError(res, error); }
});

router.put('/api/admin/collection-distribution', ...guard, async (req, res) => {
  try {
    const clean = sanitizeCollectionConfig(req.body || {});
    await setTenantSetting('collection_distribution', clean, { tenantId: req.tenantId, actorId: req.user?.uid });
    res.json(clean);
  } catch (error) { sendRouteError(res, error); }
});

// An officer's Google Sheet as CSV text, for the import screen to read the way
// it reads an uploaded file. Fetched here because the browser cannot: Google's
// export does not answer cross-origin requests. Only Google hosts are followed
// (lib/sheets.js).
router.get('/api/admin/collection-sheets/csv', ...guard, async (req, res) => {
  try {
    const sheetId = String(req.query.sheetId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    const gid = String(req.query.gid || '').replace(/\D/g, '').slice(0, 20);
    if (!sheetId) return res.status(400).json({ error: 'رابط الشيت مطلوب' });
    const csv = await fetchCsvFollowRedirects(
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`);
    if (!csv || isHtmlResponse(csv.slice(0, 500))) {
      return res.status(422).json({ error: 'الشيت مش متاح — خليه «أي حد معاه الرابط يقدر يشوف»' });
    }
    res.json({ csv });
  } catch (error) { sendRouteError(res, error); }
});

module.exports = router;
module.exports.requireCollectionLead = requireCollectionLead;
