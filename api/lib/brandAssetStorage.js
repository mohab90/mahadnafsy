'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_BYTES = 1024 * 1024;
const ROOT = path.resolve(process.env.BRAND_ASSET_DIR || path.join(__dirname, '..', 'uploads', 'branding'));
const MIME_EXT = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
});

function safeTenantSegment(tenantId) {
  const value = String(tenantId || 'tenant-default');
  if (!/^[a-z0-9_-]{1,36}$/i.test(value)) throw new Error('Invalid tenant id');
  return value;
}

function parseDataUrl(dataUrl, declaredMime) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error('Invalid image data');
  const mime = String(match[1]).toLowerCase();
  if (!MIME_EXT[mime] || (declaredMime && mime !== String(declaredMime).toLowerCase())) throw new Error('Unsupported image type');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Image must be between 1 byte and 1MB');
  return { buffer, mime, extension: MIME_EXT[mime] };
}

function detectedMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.length >= 8 && buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon';
  return null;
}

async function inspectBrandAsset({ dataUrl, declaredMime, kind }) {
  if (!['logo', 'favicon'].includes(kind)) throw new Error('Invalid brand asset kind');
  const parsed = parseDataUrl(dataUrl, declaredMime);
  const signature = detectedMime(parsed.buffer);
  const signatureMatches = signature === parsed.mime || (signature === 'image/x-icon' && parsed.extension === 'ico');
  if (!signatureMatches) throw new Error('Image signature does not match its MIME type');

  let width;
  let height;
  if (parsed.extension === 'ico') {
    width = parsed.buffer[6] || 256;
    height = parsed.buffer[7] || 256;
  } else {
    const metadata = await sharp(parsed.buffer, { failOn: 'error', limitInputPixels: 16_777_216 }).metadata();
    width = Number(metadata.width || 0);
    height = Number(metadata.height || 0);
  }
  const maxDimension = kind === 'favicon' ? 512 : 4096;
  if (width < 1 || height < 1 || width > maxDimension || height > maxDimension) {
    throw new Error(`Image dimensions must be within ${maxDimension}x${maxDimension}`);
  }
  return { ...parsed, width, height, kind };
}

function resolveLocalUrl(url) {
  const prefix = '/uploads/branding/';
  if (!String(url || '').startsWith(prefix)) return null;
  const relative = decodeURIComponent(String(url).slice(prefix.length));
  const absolute = path.resolve(ROOT, relative);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) return null;
  return absolute;
}

async function storeBrandAsset({ tenantId, asset }) {
  const tenant = safeTenantSegment(tenantId);
  const digest = crypto.createHash('sha256').update(asset.buffer).digest('hex').slice(0, 24);
  const filename = `${asset.kind}-${digest}.${asset.extension}`;
  if (String(process.env.BRAND_ASSET_STORAGE || '').toLowerCase() === 's3') {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;
    const publicBase = String(process.env.BRAND_ASSET_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!bucket || !region || !publicBase) throw new Error('S3 brand asset storage is not fully configured');
    const key = `branding/${tenant}/${filename}`;
    const client = new S3Client({ region });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: asset.buffer,
      ContentType: asset.mime,
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: { tenant, kind: asset.kind, sha256: digest },
    }));
    return {
      url: `${publicBase}/${key}`,
      storage: 's3',
      key,
      size: asset.buffer.length,
      width: asset.width,
      height: asset.height,
      kind: asset.kind,
    };
  }
  const directory = path.resolve(ROOT, tenant);
  if (!directory.startsWith(`${ROOT}${path.sep}`)) throw new Error('Invalid asset directory');
  await fs.promises.mkdir(directory, { recursive: true });
  const absolute = path.join(directory, filename);
  try { await fs.promises.writeFile(absolute, asset.buffer, { flag: 'wx', mode: 0o640 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return {
    url: `/uploads/branding/${tenant}/${filename}`,
    storage: 'local',
    absolute,
    size: asset.buffer.length,
    width: asset.width,
    height: asset.height,
    kind: asset.kind,
  };
}

async function deleteLocalBrandAsset(url) {
  const absolute = resolveLocalUrl(url);
  if (!absolute) return false;
  try { await fs.promises.unlink(absolute); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function deleteStoredBrandAsset(url) {
  const local = resolveLocalUrl(url);
  if (local) return deleteLocalBrandAsset(url);
  const publicBase = String(process.env.BRAND_ASSET_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!publicBase || !String(url || '').startsWith(`${publicBase}/branding/`)) return false;
  const key = String(url).slice(publicBase.length + 1);
  if (!/^branding\/[a-z0-9_-]{1,36}\/(logo|favicon)-[a-f0-9]{24}\.(png|jpg|webp|ico)$/i.test(key)) return false;
  const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return false;
  await new S3Client({ region }).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return true;
}

module.exports = {
  MAX_BYTES,
  ROOT,
  deleteLocalBrandAsset,
  deleteStoredBrandAsset,
  detectedMime,
  inspectBrandAsset,
  parseDataUrl,
  resolveLocalUrl,
  storeBrandAsset,
};
