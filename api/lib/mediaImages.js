'use strict';

// The pictures the site shows — an event's, a gallery's, an instructor's, a
// certificate sample — as files, not as text inside a row.
//
// They were sent and stored as data URLs, and the body sanitizer cuts every
// string at 50,000 characters: a picture over ~37 KB was saved cut off, and the
// site showed a broken image (the event picture served 37,482 bytes — exactly
// 50,000 characters less its data: prefix). A gallery kept in one JSON string
// broke the same way after its second picture.
//
// The admin compresses in the browser (shared/imageCompress.ts); the server
// encodes again as WebP at the kind's size, which also drops what the camera
// wrote into the file (its location among it). Files are named by their
// content, so the same picture uploaded twice is one file.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { detectImageSignature, safeTenantSegment } = require('./uploadSafety');

const ROOT = path.resolve(process.env.MEDIA_IMAGE_DIR || path.join(__dirname, '..', 'uploads', 'media'));
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const KIND_PX = Object.freeze({ cover: 1280, gallery: 1280, photo: 640, certificate: 1200 });
const FILE = /^[a-f0-9]{24}\.webp$/;

function imageFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw Object.assign(new Error('الملف لازم يكون صورة (JPG / PNG / WebP)'), { statusCode: 400 });
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) throw Object.assign(new Error('الصورة كبيرة جدًا'), { statusCode: 413 });
  if (!detectImageSignature(buffer)) throw Object.assign(new Error('الملف ده مش صورة'), { statusCode: 400 });
  return buffer;
}

/** Store one picture; returns the address the site shows it at. */
async function storeMediaImage({ tenantId, dataUrl, kind }) {
  const tenant = safeTenantSegment(tenantId);
  const maxPx = KIND_PX[kind] || KIND_PX.cover;
  let output;
  try {
    output = await sharp(imageFromDataUrl(dataUrl), { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 5 })
      .toBuffer();
  } catch (error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error('تعذّر قراءة الصورة'), { statusCode: 400 });
  }
  const filename = `${crypto.createHash('sha256').update(output).digest('hex').slice(0, 24)}.webp`;
  const directory = path.join(ROOT, tenant);
  await fs.promises.mkdir(directory, { recursive: true });
  try { await fs.promises.writeFile(path.join(directory, filename), output, { flag: 'wx', mode: 0o644 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return { url: `/api/media/${tenant}/${filename}`, size: output.length };
}

/** The file behind an address from storeMediaImage, or null. */
function mediaImagePath(tenant, filename) {
  try { safeTenantSegment(tenant); } catch { return null; }
  if (!FILE.test(String(filename || ''))) return null;
  return path.join(ROOT, tenant, filename);
}

module.exports = { KIND_PX, ROOT, mediaImagePath, storeMediaImage };
