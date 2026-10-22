'use strict';

// AWS Signature Version 4 for S3-compatible stores (Cloudflare R2, Backblaze
// B2, AWS S3), on node:crypto alone.
//
// @aws-sdk/client-s3 is installed for the brand assets, but its presigner is
// a separate package that is not, and the bucket only needs four verbs (PUT,
// HEAD, GET, DELETE) plus presigned GETs — about a hundred lines of a well
// specified algorithm against a dependency tree of several hundred files.
// tests/s3Signature.test.js holds this to AWS's own published examples.

const crypto = require('node:crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

const sha256Hex = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 3986 encoding as S3 wants it: only A-Z a-z 0-9 - . _ ~ pass, and the
// slash only inside an object key's path.
function uriEncode(value, { keepSlash = false } = {}) {
  return Array.from(Buffer.from(String(value), 'utf8')).map(byte => {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char) || (keepSlash && char === '/')) return char;
    return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

function amzDate(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function signingKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  return hmac(hmac(hmac(kDate, region), service), 'aws4_request');
}

function canonicalQuery(params) {
  return params
    .map(([key, value]) => [uriEncode(key), uriEncode(value == null ? '' : value)])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

// The path as S3 canonicalises it: each segment decoded once and encoded
// again, so `test$file.text` and `test%24file.text` sign alike.
function canonicalPath(pathname) {
  return String(pathname || '/').split('/').map(segment => {
    let raw = segment;
    try { raw = decodeURIComponent(segment); } catch { /* leave it as given */ }
    return uriEncode(raw);
  }).join('/') || '/';
}

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    text: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

/**
 * The signature for one request. `path` is the already-encoded canonical URI
 * (it is also what goes on the wire), `query` a list of [key, value] pairs.
 */
function signature({ method, path, query = [], headers, payloadHash, credentials, region, service = 's3', date }) {
  const stamp = amzDate(date);
  const scope = `${stamp.slice(0, 8)}/${region}/${service}/aws4_request`;
  const canonical = canonicalHeaders(headers);
  const request = [
    method.toUpperCase(), path, canonicalQuery(query), canonical.text, canonical.signed, payloadHash,
  ].join('\n');
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(request)].join('\n');
  return {
    stamp,
    scope,
    signedHeaders: canonical.signed,
    canonicalRequest: request,
    stringToSign,
    signature: hmac(signingKey(credentials.secretAccessKey, stamp.slice(0, 8), region, service), stringToSign).toString('hex'),
  };
}

/**
 * Headers for a server-side request: Authorization, x-amz-date and
 * x-amz-content-sha256 added to the ones given (which are all signed, with
 * host). A real payload hash makes the store check the body it received.
 */
function signRequest({ method, url, headers = {}, payloadHash = EMPTY_SHA256, credentials, region, service = 's3', date = new Date() }) {
  const target = new URL(url);
  const signed = {
    ...headers,
    host: target.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate(date),
  };
  if (credentials.sessionToken) signed['x-amz-security-token'] = credentials.sessionToken;
  const query = Array.from(target.searchParams.entries());
  const result = signature({ method, path: canonicalPath(target.pathname), query, headers: signed, payloadHash, credentials, region, service, date });
  const out = { ...signed };
  delete out.host;
  out.authorization = `${ALGORITHM} Credential=${credentials.accessKeyId}/${result.scope}, SignedHeaders=${result.signedHeaders}, Signature=${result.signature}`;
  return out;
}

/**
 * A presigned URL: the signature travels in the query string, so whoever
 * holds the URL can make exactly this request until it expires — and only
 * this one (method, bucket, key and any signed query are fixed).
 */
function presignUrl({ method = 'GET', url, credentials, region, expiresIn = 900, date = new Date(), service = 's3', query: extraQuery = [] }) {
  const target = new URL(url);
  const seconds = Math.floor(Number(expiresIn));
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_PRESIGN_SECONDS) throw new Error('Presigned URL lifetime must be 1 second to 7 days');
  const stamp = amzDate(date);
  const scope = `${stamp.slice(0, 8)}/${region}/${service}/aws4_request`;
  const query = [
    ...Array.from(target.searchParams.entries()),
    ...extraQuery,
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${credentials.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(seconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  if (credentials.sessionToken) query.push(['X-Amz-Security-Token', credentials.sessionToken]);
  const path = canonicalPath(target.pathname);
  const result = signature({
    method, path, query, headers: { host: target.host }, payloadHash: UNSIGNED_PAYLOAD, credentials, region, service, date,
  });
  return `${target.protocol}//${target.host}${path}?${canonicalQuery(query)}&X-Amz-Signature=${result.signature}`;
}

module.exports = {
  EMPTY_SHA256,
  UNSIGNED_PAYLOAD,
  amzDate,
  canonicalPath,
  canonicalQuery,
  presignUrl,
  sha256Hex,
  signRequest,
  signature,
  signingKey,
  uriEncode,
};
