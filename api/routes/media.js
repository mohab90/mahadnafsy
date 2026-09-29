'use strict';
// The site's pictures as files — lib/mediaImages.js.

const express = require('express');
const router = express.Router();

const { requireAuth, requireAdminOrStaff, requireAnyPermission } = require('../middleware/auth');
const { sendRouteError } = require('../lib/helpers');
const { imageProxyLimiter } = require('../middleware/rateLimits');
const { KIND_PX, mediaImagePath, storeMediaImage } = require('../lib/mediaImages');

// Whoever adds the pictures the site shows: events, courses and their gallery,
// instructors, the institute's gallery.
router.post('/api/admin/media/images', requireAuth, requireAdminOrStaff,
  requireAnyPermission('manage_community', 'manage_courses', 'manage_instructors', 'manage_content'), async (req, res) => {
    try {
      const kind = String(req.body?.kind || 'cover');
      if (!KIND_PX[kind]) return res.status(400).json({ error: 'نوع الصورة غير معروف' });
      res.json(await storeMediaImage({ tenantId: req.tenantId, dataUrl: req.body?.dataUrl, kind }));
    } catch (error) { sendRouteError(res, error); }
  });

router.get('/api/media/:tenant/:file', imageProxyLimiter, (req, res) => {
  const file = mediaImagePath(req.params.tenant, req.params.file);
  if (!file) return res.status(404).end();
  // A file's name is its content, so it never changes under its address.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('image/webp');
  res.sendFile(file, error => { if (error && !res.headersSent) res.status(404).end(); });
});

module.exports = router;
