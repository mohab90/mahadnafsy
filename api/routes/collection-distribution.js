'use strict';
// «التحصيل: التوزيع والشيتات» — lib/collectionDistribution.js.

const express = require('express');
const router = express.Router();

const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { sendRouteError } = require('../lib/helpers');
const { fetchCsvFollowRedirects, isHtmlResponse } = require('../lib/sheets');
const { pool } = require('../lib/db');
const { CLIENT_STATUSES, collectionIntake, sanitizeCollectionConfig } = require('../lib/collectionDistribution');
const { importCollectionRows, officerById, syncCollectionSheet } = require('../lib/collectionSheets');

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
    const config = sanitizeCollectionConfig(await getTenantSetting('collection_distribution', { tenantId: req.tenantId, fallback: {} }) || {});
    // What each officer holds, and what they received in their own period —
    // the number their cap is checked against.
    const [held] = await pool.query(
      `SELECT assigned_cs_id AS id, COUNT(*) AS n FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND assigned_cs_id IS NOT NULL GROUP BY assigned_cs_id`,
      [req.tenantId]);
    const received = await collectionIntake(pool, req.tenantId, config.members);
    const counts = {};
    held.forEach(row => { counts[row.id] = { held: Number(row.n) || 0, received: received.get(String(row.id)) || 0 }; });
    res.json({ ...config, counts });
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

// «مزامنة الآن» on a linked sheet: its new rows come in under its officer.
router.post('/api/admin/collection-sheets/:id/sync', ...guard, async (req, res) => {
  try {
    const result = await syncCollectionSheet(req.tenantId, String(req.params.id || '').slice(0, 64), {
      actor: req.user?.email || req.staffRecord?.name || 'collection-sheet',
    });
    res.json(result);
  } catch (error) { sendRouteError(res, error); }
});

// An uploaded file, parsed by the screen: the same import as a linked sheet,
// so both dedupe and assign alike.
router.post('/api/admin/collection-sheets/import', ...guard, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ error: 'مفيش صفوف' });
    const staff = await officerById(pool, req.tenantId, String(req.body?.staffId || ''));
    if (!staff) return res.status(400).json({ error: 'اختار مسئول تحصيل نشط' });
    const result = await importCollectionRows({
      tenantId: req.tenantId, staff, rows,
      kind: CLIENT_STATUSES.includes(req.body?.kind) ? req.body.kind : 'old_local',
      source: String(req.body?.source || `شيت ${staff.name}`).trim().slice(0, 100),
      actor: req.user?.email || req.staffRecord?.name || 'collection-sheet',
    });
    res.json(result);
  } catch (error) { sendRouteError(res, error); }
});

// «محتاج اقدر الاونلاين اقدر اعمل استيراد للداتا واحدد هتظهر فين في العملاء
// النشطين ولا محلي قديم ولا دولي قديم»: the same import, where the desk says —
// and under an officer only if one is chosen.
const ONLINE_IMPORT = {
  active: { local: 'ONLINE_EGYPT', saudi: 'ONLINE_SAUDI', intl: 'ONLINE_ABROAD' },
  old_local: { local: 'ONLINE_EGYPT' },
  old_intl: { intl: 'ONLINE_ABROAD' },
};

router.post('/api/admin/online-clients/import', ...guard, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ error: 'مفيش صفوف' });
    const kind = String(req.body?.destination || '');
    const markets = ONLINE_IMPORT[kind];
    if (!markets) return res.status(400).json({ error: 'اختار العملاء هيظهروا فين' });
    const branch = markets[String(req.body?.market || '')] || Object.values(markets)[0];
    let staff = null;
    if (req.body?.staffId) {
      staff = await officerById(pool, req.tenantId, String(req.body.staffId));
      if (!staff) return res.status(400).json({ error: 'مسئول التحصيل ده مش نشط' });
    }
    const result = await importCollectionRows({
      tenantId: req.tenantId, staff, kind, branch, rows,
      source: String(req.body?.source || 'استيراد الأونلاين').trim().slice(0, 100),
      actor: req.user?.email || req.staffRecord?.name || 'online-import',
    });
    res.json(result);
  } catch (error) { sendRouteError(res, error); }
});

module.exports = router;
module.exports.requireCollectionLead = requireCollectionLead;
