'use strict';

const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const path = require('node:path');

const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimits');
const { uuidv4 } = require('../lib/id');
const { writeAuditEvent } = require('../lib/auditTrail');
const { VIDEO_ROOT, VIDEO_TYPES, inspectMediaFile, safeTenantSegment } = require('../lib/uploadSafety');
const logger = require('../lib/logger').child({ module: 'upload-route' });

const router = express.Router();
const TEMP_DIR = path.resolve(VIDEO_ROOT, '.tmp');
const configuredMax = Number(process.env.MAX_VIDEO_UPLOAD_BYTES || 500 * 1024 * 1024);
const MAX_VIDEO_UPLOAD_BYTES = Math.min(Math.max(configuredMax, 1024 * 1024), 2 * 1024 * 1024 * 1024);
fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_DIR),
    filename: (_req, _file, cb) => cb(null, `pending-${uuidv4()}`),
  }),
  limits: { files: 1, fileSize: MAX_VIDEO_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => cb(null, Boolean(VIDEO_TYPES[String(file.mimetype || '').toLowerCase()])),
});

router.post(
  '/api/admin/upload/video',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_lectures'),
  uploadLimiter,
  (req, res) => {
    upload.single('video')(req, res, async (uploadError) => {
      let finalPath = null;
      try {
        if (uploadError) {
          const message = uploadError instanceof multer.MulterError ? uploadError.message : 'Unsupported video or audio type';
          return res.status(400).json({ error: message });
        }
        if (!req.file) return res.status(400).json({ error: 'No file was uploaded' });
        const media = await inspectMediaFile(req.file.path, req.file.mimetype);
        const tenant = safeTenantSegment(req.tenantId);
        const directory = path.resolve(VIDEO_ROOT, tenant);
        await fs.promises.mkdir(directory, { recursive: true });
        const filename = `media-${uuidv4()}.${media.extension}`;
        finalPath = path.resolve(directory, filename);
        if (!finalPath.startsWith(`${directory}${path.sep}`)) throw new Error('Invalid upload path');

        await writeAuditEvent({
          req,
          action: 'media.upload_requested',
          entityType: 'lecture_media',
          entityId: filename,
          metadata: { size: req.file.size, mime: media.contentType },
        });
        await fs.promises.rename(req.file.path, finalPath);
        const fileUrl = `/uploads/videos/${tenant}/${filename}`;
        await writeAuditEvent({
          req,
          action: 'media.uploaded',
          entityType: 'lecture_media',
          entityId: filename,
          metadata: { size: req.file.size, mime: media.contentType },
        });
        return res.json({ ok: true, url: fileUrl, size: req.file.size, filename });
      } catch (error) {
        logger.warn('media upload rejected', { err: error.message, tenantId: req.tenantId });
        if (finalPath) await fs.promises.unlink(finalPath).catch(() => {});
        const inputError = /signature|unsupported|invalid/i.test(error.message || '');
        return res.status(inputError ? 400 : 500)
          .json({ error: inputError ? error.message : 'Upload failed' });
      } finally {
        if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
      }
    });
  }
);

module.exports = router;
