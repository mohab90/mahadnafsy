'use strict';

const IMAGE_DOC_LIMIT = 5 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function validateImage(req, res, next) {
  const file = req.file;
  if (!file) return next();

  if (String(file.mimetype || '').startsWith('video/')) {
    if (file.size > VIDEO_LIMIT) {
      return res.status(400).json({ error: 'Video file must not exceed 50MB' });
    }
    return next();
  }

  if (!allowedMimeTypes.has(file.mimetype)) {
    return res.status(400).json({ error: 'Unsupported file type' });
  }

  if (file.size > IMAGE_DOC_LIMIT) {
    return res.status(400).json({ error: 'File must not exceed 5MB' });
  }

  return next();
}

module.exports = validateImage;
