'use strict';

// Where uploaded files live: this server's disk (`local`, the default — the
// behaviour before 21 Oct 2026) or an S3-compatible bucket (`s3`: Cloudflare
// R2, Backblaze B2, AWS S3), chosen by STORAGE_DRIVER.
//
// The disk was at 88% and lecture videos are most of it. Every file keeps the
// address it has always had (/uploads/videos/<tenant>/<file>,
// /api/media/<tenant>/<file>, a payment proof's own route), so nothing stored
// in a row changes; what changes is where the bytes behind that address come
// from. A file is looked for on the disk first and then, if the ledger
// (storage_objects, lib/storageLedger.js) says it was moved, in the bucket — so
// a half-finished move, or a rollback to `local`, keeps every file reachable.
//
// Objects are keyed `<kind>/<tenant>/<file>` (videos/, media/, proofs/),
// under STORAGE_S3_PREFIX when staging and production share a bucket.
// Requests are signed with lib/s3Signature.js and sent with fetch.
// deploy/CLOUD_STORAGE.md is the switch-on runbook.

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const { resolveSecret } = require('./secretResolver');
const { EMPTY_SHA256, presignUrl, signRequest, uriEncode } = require('./s3Signature');

const KEY_PATTERN = /^(videos|media|proofs)\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9._-]{1,120})$/;
const KIND_BY_PREFIX = Object.freeze({ videos: 'video', media: 'image', proofs: 'proof' });

function parseKey(key) {
  const match = KEY_PATTERN.exec(String(key || ''));
  if (!match || match[3].startsWith('.')) return null;
  return { prefix: match[1], kind: KIND_BY_PREFIX[match[1]], tenantId: match[2], filename: match[3] };
}

/**
 * The storage settings from the environment. `driver` is where new files are
 * written; `s3` is the bucket whenever it is fully configured, whatever the
 * driver — reads and the move tool use it even after a rollback to `local`.
 */
function storageConfig(env = process.env) {
  const requested = String(env.STORAGE_DRIVER || 'local').trim().toLowerCase() || 'local';
  const problems = [];
  if (!['local', 's3'].includes(requested)) problems.push(`STORAGE_DRIVER must be local or s3 (got ${requested})`);
  let accessKeyId = '';
  let secretAccessKey = '';
  try {
    accessKeyId = resolveSecret('STORAGE_S3_ACCESS_KEY_ID', env);
    secretAccessKey = resolveSecret('STORAGE_S3_SECRET_ACCESS_KEY', env);
  } catch (error) { problems.push(error.message); }
  const endpoint = String(env.STORAGE_S3_ENDPOINT || '').trim().replace(/\/+$/, '');
  const bucket = String(env.STORAGE_S3_BUCKET || '').trim();
  const fields = { STORAGE_S3_ENDPOINT: endpoint, STORAGE_S3_BUCKET: bucket, STORAGE_S3_ACCESS_KEY_ID: accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey };
  const anyS3 = Object.values(fields).some(Boolean);
  let s3 = null;
  if (anyS3 || requested === 's3') {
    const missing = Object.entries(fields).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) problems.push(`missing ${missing.join(', ')}`);
    let endpointUrl = null;
    try {
      endpointUrl = endpoint ? new URL(endpoint) : null;
      if (endpointUrl && !['https:', 'http:'].includes(endpointUrl.protocol)) throw new Error('bad protocol');
    } catch { problems.push('STORAGE_S3_ENDPOINT must be an http(s) URL'); endpointUrl = null; }
    if (bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) problems.push('STORAGE_S3_BUCKET is not a valid bucket name');
    const prefix = String(env.STORAGE_S3_PREFIX || '').trim().replace(/^\/+|\/+$/g, '');
    if (prefix && !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(prefix)) problems.push('STORAGE_S3_PREFIX may hold only letters, digits, . _ - and /');
    const publicBaseUrl = String(env.STORAGE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (publicBaseUrl && !/^https:\/\//i.test(publicBaseUrl)) problems.push('STORAGE_PUBLIC_BASE_URL must be https');
    if (!missing.length && endpointUrl && !problems.length) {
      s3 = {
        endpoint: endpointUrl.toString().replace(/\/+$/, ''),
        bucket,
        region: String(env.STORAGE_S3_REGION || 'auto').trim() || 'auto',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: String(env.STORAGE_S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false',
        prefix,
        publicBaseUrl,
        videoUrlTtlSeconds: Math.min(Math.max(Number(env.STORAGE_VIDEO_URL_TTL_SECONDS) || 4 * 60 * 60, 60), 4 * 60 * 60),
      };
    }
  }
  // A driver of s3 with a bucket that cannot be used writes to the disk as
  // before — an upload still works — and says so loudly (logged at boot and in
  // production-readiness), rather than refusing every upload.
  const driver = requested === 's3' && s3 ? 's3' : 'local';
  return { requested, driver, s3, problems };
}

function remoteKey(config, key) {
  return config.prefix ? `${config.prefix}/${key}` : key;
}

function objectUrl(config, key) {
  const encodedKey = uriEncode(remoteKey(config, key), { keepSlash: true });
  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  if (config.forcePathStyle) return `${endpoint.protocol}//${endpoint.host}${basePath}/${config.bucket}/${encodedKey}`;
  return `${endpoint.protocol}//${config.bucket}.${endpoint.host}${basePath}/${encodedKey}`;
}

class StorageError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest('hex'), size };
}

/**
 * A client for one bucket. `fetchImpl` is for tests. Bodies are streamed from
 * the disk with their length and SHA-256 declared up front: the store checks
 * the hash against what it received (a mismatch is refused, not stored), and
 * a 2 GB lecture never sits in memory.
 */
function createS3Client(config, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const send = async (method, key, { headers = {}, unsigned = {}, body, payloadHash = EMPTY_SHA256, signal } = {}) => {
    const url = objectUrl(config, key);
    const signed = signRequest({ method, url, headers, payloadHash, credentials: config.credentials, region: config.region, date: now() });
    const init = { method, headers: { ...signed, ...unsigned }, signal };
    if (body !== undefined) { init.body = body; init.duplex = 'half'; }
    return fetchImpl(url, init);
  };
  const fail = async (response, what) => {
    const text = await response.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] || '';
    throw new StorageError(`${what} failed: HTTP ${response.status}${code ? ` ${code}` : ''}`, response.status);
  };

  return {
    config,
    /** Upload a file from disk (streamed) or a Buffer. */
    async put(key, { filePath, buffer, contentType = 'application/octet-stream', cacheControl, sha256, size }) {
      let digest = sha256;
      let length = size;
      if (buffer) {
        digest = digest || crypto.createHash('sha256').update(buffer).digest('hex');
        length = buffer.length;
      } else if (!digest || length == null) {
        ({ sha256: digest, size: length } = await sha256OfFile(filePath));
      }
      const headers = {
        'content-type': contentType,
        'x-amz-meta-sha256': digest,
      };
      if (cacheControl) headers['cache-control'] = cacheControl;
      const body = buffer || Readable.toWeb(fs.createReadStream(filePath));
      // content-length is not signed, only declared: without it a streamed
      // body goes out chunked, which S3 refuses without aws-chunked framing.
      const response = await send('PUT', key, {
        headers, unsigned: { 'content-length': String(length) }, payloadHash: digest, body,
      }).catch(error => { throw new StorageError(`PUT ${key} failed: ${error.message}`, 0); });
      if (!response.ok) await fail(response, `PUT ${key}`);
      await response.arrayBuffer().catch(() => {});
      return { size: Number(length), sha256: digest };
    },
    /** Size, recorded SHA-256 and type of an object, or null if absent. */
    async head(key) {
      const response = await send('HEAD', key);
      if (response.status === 404) return null;
      if (!response.ok) await fail(response, `HEAD ${key}`);
      return {
        size: Number(response.headers.get('content-length')),
        sha256: response.headers.get('x-amz-meta-sha256') || null,
        contentType: response.headers.get('content-type') || null,
      };
    },
    /** The object's bytes, for the small ones (a payment proof). */
    async getBuffer(key, { maxBytes = 16 * 1024 * 1024 } = {}) {
      const response = await send('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) await fail(response, `GET ${key}`);
      const declared = Number(response.headers.get('content-length'));
      if (declared > maxBytes) throw new StorageError(`GET ${key}: object larger than ${maxBytes} bytes`, 413);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new StorageError(`GET ${key}: object larger than ${maxBytes} bytes`, 413);
      return { buffer, contentType: response.headers.get('content-type') || null };
    },
    /** Stream the object to a file on disk; returns its size and SHA-256. */
    async download(key, destination) {
      const response = await send('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) await fail(response, `GET ${key}`);
      const hash = crypto.createHash('sha256');
      let size = 0;
      const source = Readable.fromWeb(response.body);
      source.on('data', chunk => { hash.update(chunk); size += chunk.length; });
      await pipeline(source, fs.createWriteStream(destination, { mode: 0o640 }));
      return { size, sha256: hash.digest('hex') };
    },
    async remove(key) {
      const response = await send('DELETE', key);
      if (!response.ok && response.status !== 404) await fail(response, `DELETE ${key}`);
      await response.arrayBuffer().catch(() => {});
      return true;
    },
    /** A URL that GETs this one object until it expires. */
    presignGet(key, expiresIn) {
      return presignUrl({ method: 'GET', url: objectUrl(config, key), credentials: config.credentials, region: config.region, expiresIn, date: now() });
    },
    /** The CDN address of a public object (pictures only), when one is set. */
    publicUrl(key) {
      if (!config.publicBaseUrl) return null;
      return `${config.publicBaseUrl}/${uriEncode(remoteKey(config, key), { keepSlash: true })}`;
    },
  };
}

let cached = null;
/** The bucket client for the current environment, or null when none is configured. */
function remoteStore(env = process.env) {
  const config = storageConfig(env);
  if (!config.s3) return null;
  const signature = JSON.stringify(config.s3);
  if (!cached || cached.signature !== signature) cached = { signature, client: createS3Client(config.s3) };
  return cached.client;
}

/** True when new uploads should go to the bucket. */
function writesToBucket(env = process.env) {
  return storageConfig(env).driver === 's3';
}

/**
 * The file on this server's disk that a key names (videos under VIDEO_ROOT,
 * pictures under MEDIA_IMAGE_DIR), or null — a payment proof's local home is
 * its database row, not a file.
 */
function localPathForKey(key) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  let root;
  if (parsed.prefix === 'videos') root = require('./uploadSafety').VIDEO_ROOT;
  else if (parsed.prefix === 'media') root = require('./mediaImages').ROOT;
  else return null;
  const tenantRoot = path.resolve(root, parsed.tenantId);
  const absolute = path.resolve(tenantRoot, parsed.filename);
  return absolute.startsWith(`${tenantRoot}${path.sep}`) ? absolute : null;
}

module.exports = {
  KEY_PATTERN,
  StorageError,
  createS3Client,
  localPathForKey,
  objectUrl,
  parseKey,
  remoteStore,
  sha256OfFile,
  storageConfig,
  writesToBucket,
};
