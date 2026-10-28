'use strict';

// The screenshot of a transfer a client uploads with «دفعت انستاباي»: it goes to Google Drive and
// the system keeps its link (api/lib/googleDrive.js), so the accountant opens it from the payment.
// Best-effort — a Drive that is not set up, or is down, must not lose the client's receipt, so the
// caller keeps the picture itself when no link comes back.

const { uploadImage, isConfigured, cleanDriveLink } = require('./googleDrive');
const { inspectProofImageDataUrl } = require('./uploadSafety');
const { cairoToday } = require('./dates');
const logger = require('./logger');

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * @param {string} dataUrl  the client's compressed receipt (data:image/...;base64,...)
 * @param {{ who?: string, orderId?: string }} label  what the file is named after
 * @returns {Promise<string|null>} the Drive link, or null when none could be made
 */
async function storeTransferScreenshot(dataUrl, { who = '', orderId = '' } = {}, deps = {}) {
  const upload = deps.uploadImage || uploadImage;
  if (!(deps.isConfigured || isConfigured)()) return null;
  try {
    const checked = inspectProofImageDataUrl(dataUrl, 8 * 1024 * 1024);
    const base64 = String(dataUrl).split(',')[1] || '';
    const tag = String(who || orderId || 'عميل').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40) || 'عميل';
    const file = await upload({
      name: `صورة-التحويل-${tag}-${cairoToday()}.${EXTENSION[checked.declaredMime] || 'jpg'}`,
      mimeType: checked.declaredMime,
      buffer: Buffer.from(base64.replace(/\s/g, ''), 'base64'),
    });
    return cleanDriveLink(file.url) || null;
  } catch (error) {
    logger.warn('[transfer-screenshot] kept the picture in the system, Drive upload failed:', error.code || '', error.message);
    return null;
  }
}

module.exports = { storeTransferScreenshot };
