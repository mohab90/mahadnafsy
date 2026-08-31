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
// Pure, and kept in lib/ so it can be tested without booting a connection pool.
// It is the only thing between an admin-writable settings blob and three render
// paths, and a guard nothing can exercise is not a guard.
const { sanitizeTabs } = require('../lib/sectionTabs');

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
