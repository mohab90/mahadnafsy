'use strict';

// Google Drive for the photos the institute asks for with a certificate or a
// carnet: «رفع الصور مربوط بجوجل درايف … ولما نرفع صورة اتوماتيك تروح لجوجل درايف
// ويبقى على السيستم لينك الصورة فقط».
//
// A service account uploads into ONE folder that the owner shares with it as
// «محرر» (Editor); the system keeps only the file's link. No library: the
// service account signs a short JWT (RS256, node:crypto) for an access token,
// and the picture goes up with a single multipart request.
//
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   the service account's e-mail
//   GOOGLE_PRIVATE_KEY             its private key (the \n of an .env line are fine)
//   GOOGLE_DRIVE_FOLDER_ID         the shared folder the pictures go into
//
// The files are NOT made public: an identity card is not for anyone with the
// link. Whoever the folder is shared with opens them from the link.

const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// What a stored link may be: a Drive file, never an arbitrary address a caller typed.
const DRIVE_LINK = /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)[A-Za-z0-9_-]{10,}(?:\/view)?(?:\?[\w=&%-]*)?$/;

function readConfig(env = process.env) {
  const email = String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = String(env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const folderId = String(env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  return { email, key, folderId, configured: Boolean(email && key.includes('PRIVATE KEY') && /^[A-Za-z0-9_-]{10,}$/.test(folderId)) };
}

const isConfigured = (env = process.env) => readConfig(env).configured;

const b64url = value => Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function signedAssertion({ email, key }, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key);
  return `${header}.${claims}.${b64url(signature)}`;
}

let cached = { token: null, expiresAt: 0, email: '' };

async function accessToken(config, { fetchImpl = global.fetch, now = Date.now } = {}) {
  if (cached.token && cached.email === config.email && cached.expiresAt - 60_000 > now()) return cached.token;
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(config, Math.floor(now() / 1000)),
    }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const error = new Error(`Google refused the service account (${response.status}${body.error ? ` ${body.error}` : ''})`);
    error.code = 'DRIVE_AUTH_FAILED';
    throw error;
  }
  cached = { token: body.access_token, expiresAt: now() + Number(body.expires_in || 3600) * 1000, email: config.email };
  return cached.token;
}

const safeName = value => String(value || 'file').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

/**
 * Upload one picture into the shared folder; resolves { id, name, url }.
 * Throws an Error with .code DRIVE_NOT_CONFIGURED | DRIVE_AUTH_FAILED | DRIVE_UPLOAD_FAILED.
 */
async function uploadImage({ name, mimeType, buffer }, { env = process.env, fetchImpl = global.fetch, now = Date.now } = {}) {
  const config = readConfig(env);
  if (!config.configured) {
    const error = new Error('Google Drive is not configured');
    error.code = 'DRIVE_NOT_CONFIGURED';
    throw error;
  }
  const token = await accessToken(config, { fetchImpl, now });
  const boundary = `mahad${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name: safeName(name), parents: [config.folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await fetchImpl(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await response.json().catch(() => ({}));
  if (!response.ok || !file.id) {
    // A token revoked meanwhile is fetched again next time.
    if (response.status === 401) cached = { token: null, expiresAt: 0, email: '' };
    const error = new Error(`Google Drive refused the upload (${response.status}${file.error?.message ? `: ${file.error.message}` : ''})`);
    error.code = 'DRIVE_UPLOAD_FAILED';
    error.status = response.status;
    throw error;
  }
  return { id: file.id, name: file.name || name, url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` };
}

/** A link worth storing: a Drive file link, or null. */
function cleanDriveLink(value) {
  const link = String(value || '').trim();
  return link.length <= 500 && DRIVE_LINK.test(link) ? link : null;
}

/** { personal, id } of whatever a payment carried, each a clean Drive link or null. */
function cleanPhotoLinks(photos) {
  const source = photos && typeof photos === 'object' ? photos : {};
  return { personal: cleanDriveLink(source.personal), id: cleanDriveLink(source.id) };
}

function resetTokenCache() { cached = { token: null, expiresAt: 0, email: '' }; }

module.exports = { readConfig, isConfigured, uploadImage, cleanDriveLink, cleanPhotoLinks, resetTokenCache, safeName };
