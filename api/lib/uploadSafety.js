'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VIDEO_ROOT = path.resolve(process.env.VIDEO_UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'videos'));
const VIDEO_TYPES = Object.freeze({
  'video/mp4': { extension: 'mp4', contentType: 'video/mp4' },
  'video/quicktime': { extension: 'mov', contentType: 'video/quicktime' },
  'video/webm': { extension: 'webm', contentType: 'video/webm' },
  'video/ogg': { extension: 'ogv', contentType: 'video/ogg' },
  'video/mpeg': { extension: 'mpeg', contentType: 'video/mpeg' },
  'audio/mpeg': { extension: 'mp3', contentType: 'audio/mpeg' },
  'audio/wav': { extension: 'wav', contentType: 'audio/wav' },
  'audio/x-wav': { extension: 'wav', contentType: 'audio/wav' },
  'audio/webm': { extension: 'webm', contentType: 'audio/webm' },
  'audio/ogg': { extension: 'ogg', contentType: 'audio/ogg' },
});

function safeTenantSegment(tenantId) {
  const value = String(tenantId || '');
  if (!/^[a-z0-9_-]{1,64}$/i.test(value)) throw new Error('Invalid tenant id');
  return value;
}

function detectMediaSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'iso-bmff';
  if (buffer.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'webm';
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'mp3';
  if (buffer.subarray(0, 4).equals(Buffer.from('000001ba', 'hex')) || buffer.subarray(0, 4).equals(Buffer.from('000001b3', 'hex'))) return 'mpeg';
  return null;
}

async function inspectMediaFile(filePath, declaredMime) {
  const type = VIDEO_TYPES[String(declaredMime || '').toLowerCase()];
  if (!type) throw new Error('Unsupported video or audio type');
  const handle = await fs.promises.open(filePath, 'r');
  const header = Buffer.alloc(64);
  let bytesRead = 0;
  try { ({ bytesRead } = await handle.read(header, 0, header.length, 0)); }
  finally { await handle.close(); }
  const signature = detectMediaSignature(header.subarray(0, bytesRead));
  const expected = ['mp4', 'mov'].includes(type.extension)
    ? 'iso-bmff'
    : ['ogv', 'ogg'].includes(type.extension) ? 'ogg'
      : type.extension;
  if (signature !== expected) throw new Error('File signature does not match its declared media type');
  return { ...type, signature };
}

function detectImageSignature(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

function inspectProofImageDataUrl(dataUrl, maxBytes = 4 * 1024 * 1024) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error('Only JPEG, PNG, WebP or GIF images are allowed');
  const declared = match[1].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${match[1].toLowerCase()}`;
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw new Error('Image is too large');
  if (detectImageSignature(buffer) !== declared) throw new Error('Image signature does not match its MIME type');
  return { declaredMime: declared, size: buffer.length };
}

function resolveTenantMediaPath(url, tenantId) {
  const tenant = safeTenantSegment(tenantId);
  const prefix = `/uploads/videos/${tenant}/`;
  if (!String(url || '').startsWith(prefix)) return null;
  let filename;
  try { filename = decodeURIComponent(String(url).slice(prefix.length)); } catch { return null; }
  if (!/^media-[a-f0-9-]{36}\.(mp4|mov|webm|ogv|mpeg|mp3|wav|ogg)$/i.test(filename)) return null;
  const tenantRoot = path.resolve(VIDEO_ROOT, tenant);
  const absolute = path.resolve(tenantRoot, filename);
  return absolute.startsWith(`${tenantRoot}${path.sep}`) ? absolute : null;
}

async function streamTenantMedia(req, res, url, tenantId) {
  const absolute = resolveTenantMediaPath(url, tenantId);
  if (!absolute) return false;
  let stat;
  try { stat = await fs.promises.stat(absolute); } catch { return false; }
  if (!stat.isFile()) return false;
  const extension = path.extname(absolute).slice(1).toLowerCase();
  const contentType = Object.values(VIDEO_TYPES).find(type => type.extension === extension)?.contentType || 'application/octet-stream';
  const range = String(req.headers.range || '');
  res.set({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!range) {
    res.set('Content-Length', String(stat.size));
    fs.createReadStream(absolute).pipe(res);
    return true;
  }
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    return true;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stat.size) {
    res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    return true;
  }
  res.status(206).set({
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Content-Length': String(end - start + 1),
  });
  fs.createReadStream(absolute, { start, end }).pipe(res);
  return true;
}

module.exports = {
  VIDEO_ROOT,
  VIDEO_TYPES,
  detectImageSignature,
  detectMediaSignature,
  inspectMediaFile,
  inspectProofImageDataUrl,
  resolveTenantMediaPath,
  safeTenantSegment,
  streamTenantMedia,
};
