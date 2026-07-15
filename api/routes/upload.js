'use strict';

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const { requireAuth, requireAdminOrStaff } = require('../middleware/auth');
const logger = require('../lib/logger').child({ module: 'upload-route' });

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'videos');
const MAX_VIDEO_UPLOAD_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '');
    if (mime.startsWith('video/') || mime.startsWith('audio/')) return cb(null, true);
    cb(new Error('Invalid file type. Only video and audio files are allowed.'));
  },
});

// POST /api/admin/upload/video
router.post('/api/admin/upload/video', requireAuth, requireAdminOrStaff, (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('multer video upload failed', err);
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    if (err) {
      logger.error('video upload failed', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded' });

    const fileUrl = `/uploads/videos/${req.file.filename}`;
    logger.info(`Video uploaded successfully: ${fileUrl} (${req.file.size} bytes)`);
    res.json({
      ok: true,
      message: 'Video uploaded successfully',
      url: fileUrl,
      size: req.file.size,
      filename: req.file.filename,
    });
  });
});

module.exports = router;
