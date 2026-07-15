'use strict';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function validateUploadFile(options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const videoMaxBytes = options.videoMaxBytes || DEFAULT_VIDEO_MAX_BYTES;
  const allowed = new Set(options.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES);

  return function uploadFileValidator(req, res, next) {
    const file = req.file;
    if (!file) return next();

    const mimetype = String(file.mimetype || '').toLowerCase();
    const size = Number(file.size || 0);

    if (mimetype.startsWith('video/')) {
      if (size > videoMaxBytes) {
        return res.status(400).json({ error: 'Video file is too large' });
      }
      return next();
    }

    if (!allowed.has(mimetype)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    if (size > maxBytes) {
      return res.status(400).json({ error: 'File is too large' });
    }

    return next();
  };
}

module.exports = {
  DEFAULT_ALLOWED_MIME_TYPES,
  validateUploadFile,
};
