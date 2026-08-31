'use strict';
/**
 * Tabs the staff build for themselves, inside a section they already have.
 *
 * العملاء المحتملين, الأونلاين and الدقي each work through batches of people that
 * arrive together and are worked together — an import from a campaign, a list
 * bought for one diploma, last season's walk-ins. Every one of those batches was
 * a request for a new screen, and every screen was the same three things in a
 * different arrangement: bring the data in, hand it out, look at it.
 *
 * So the arrangement is the thing that gets configured. A tab names a batch,
 * says which of those three panels it shows, and optionally pins itself to one
 * source so it only ever holds its own people.
 *
 * Shape, per section key ('leads' | 'online' | 'daqqi'):
 *   { id, label, source?, sections: { import?, distribute?, data? } }
 *
 * Reading is open to anyone who can already see the section, because the tabs
 * are part of its furniture. Writing is admin-only, matching crm-settings:
 * a tab is a shared object, and a rep rearranging the desk for everyone is not
 * the same act as a rep filtering their own view.
 */
const express = require('express');
const router = express.Router();

const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { sendRouteError } = require('../lib/helpers');

const SECTION_KEYS = ['leads', 'online', 'daqqi'];
const PANELS = ['import', 'distribute', 'data'];
const MAX_TABS_PER_SECTION = 12;
const MAX_LABEL = 40;

/**
 * Whatever was stored, reduced to something the screens can render.
 *
 * This is read by three tabs on every load, so a malformed value must degrade to
 * "no custom tabs" rather than throw inside a render. Anything unrecognised is
 * dropped rather than passed through: the settings blob is admin-writable, and
 * a label going straight into the DOM is exactly the shape of bug the campaign
 * unsubscribe page had.
 */
function sanitizeTabs(raw) {
  const out = {};
  for (const key of SECTION_KEYS) {
    const list = Array.isArray(raw?.[key]) ? raw[key] : [];
    out[key] = list.slice(0, MAX_TABS_PER_SECTION).map(tab => {
      const sections = {};
      for (const panel of PANELS) sections[panel] = tab?.sections?.[panel] !== false;
      // A tab showing nothing is a menu entry that opens an empty page. Fall
      // back to the data table, which is the one panel every batch wants.
      if (!PANELS.some(panel => sections[panel])) sections.data = true;
      return {
        id: String(tab?.id || '').slice(0, 64) || `tab-${Math.random().toString(36).slice(2, 10)}`,
        label: String(tab?.label || '').trim().slice(0, MAX_LABEL) || 'تاب بدون اسم',
        source: tab?.source ? String(tab.source).trim().slice(0, 60) : null,
        sections,
      };
    }).filter(tab => tab.label);
  }
  return out;
}

router.get('/api/admin/section-tabs',
  requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
    try {
      const stored = await getTenantSetting('section_tabs', { tenantId: req.tenantId, fallback: {} });
      res.json(sanitizeTabs(stored));
    } catch (error) { sendRouteError(res, error); }
  });

router.put('/api/admin/section-tabs', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Sanitised before it is stored as well as after it is read. Storing the raw
    // body would leave the next reader trusting whatever shape happened to be
    // written, and the reader is a render.
    const clean = sanitizeTabs(req.body || {});
    await setTenantSetting('section_tabs', clean, { tenantId: req.tenantId, actorId: req.user?.uid });
    res.json(clean);
  } catch (error) { sendRouteError(res, error); }
});

module.exports = router;
