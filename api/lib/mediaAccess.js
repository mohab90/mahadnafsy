'use strict';

const crypto = require('crypto');
const { resolveSecret } = require('./secretResolver');

const VIDEO_KEY = 'mhd-nafsy-2026';
const signingSecret = () => String(resolveSecret('MEDIA_SIGNING_SECRET') || resolveSecret('JWT_SECRET') || '');
const encode = value => Buffer.from(value).toString('base64url');

function decodeStoredUrl(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('enc:')) return raw;
  try {
    return Buffer.from(raw.slice(4), 'base64').toString('binary').split('')
      .map((character, index) => String.fromCharCode(character.charCodeAt(0) ^ VIDEO_KEY.charCodeAt(index % VIDEO_KEY.length)))
      .join('');
  } catch {
    return '';
  }
}

// Only a real media file can go in a <video> element. Anything else — YouTube,
// Vimeo, Google Drive, Bunny's iframe player, a Zoom recording page — is a web
// page and must be framed. This used to answer 'video' for every non-YouTube
// link, so the student app handed a Drive/Vimeo page to <video>, which plays
// nothing. The free first lecture was unaffected because its URL reaches the
// browser directly and is framed there — hence "only the first video works".
const DIRECT_MEDIA_FILE = /\.(?:mp4|m4v|webm|ogg|ogv|mov)(?:$|[?#])/;

function mediaKind(value) {
  const url = decodeStoredUrl(value).toLowerCase();
  if (/youtu\.be|youtube\.com/.test(url)) return 'embed';
  if (/\.m3u8(?:$|\?)/.test(url) || url.includes('/hls/')) return 'hls';
  if (url.startsWith('/uploads/') || DIRECT_MEDIA_FILE.test(url)) return 'video';
  return 'embed';
}

function createMediaTicket({ tenantId, subscriberId, lectureId, ttlSeconds = 300 }) {
  const secret = signingSecret();
  if (secret.length < 24) throw new Error('Media signing secret is not configured');
  const payload = encode(JSON.stringify({
    tenantId, subscriberId, lectureId,
    exp: Math.floor(Date.now() / 1000) + Math.min(Math.max(Number(ttlSeconds) || 300, 60), 900),
  }));
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyMediaTicket(ticket, lectureId) {
  const [payload, signature] = String(ticket || '').split('.');
  const secret = signingSecret();
  if (!payload || !signature || secret.length < 24) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.lectureId !== lectureId || Number(data.exp) <= Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function playableRedirect(value) {
  const url = decodeStoredUrl(value);
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return '';
  try {
    const parsed = new URL(url, 'https://local.invalid');
    let id = '';
    if (parsed.hostname.includes('youtu.be')) id = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (parsed.hostname.includes('youtube.com')) {
      id = parsed.searchParams.get('v') || parsed.pathname.split('/embed/')[1]?.split('/')[0] || '';
    }
    if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?controls=1&rel=0&playsinline=1`;
    // vimeo.com/<id> and a Drive ".../view" link refuse to be framed; their
    // player/preview forms are the embeddable equivalents.
    if (/(^|\.)vimeo\.com$/.test(parsed.hostname) && parsed.hostname !== 'player.vimeo.com') {
      const vimeoId = parsed.pathname.split('/').filter(Boolean).find(part => /^\d+$/.test(part));
      if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
    }
    if (parsed.hostname === 'drive.google.com') {
      const driveId = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id');
      if (driveId) return `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`;
    }
    return url;
  } catch {
    return '';
  }
}

module.exports = {
  createMediaTicket,
  decodeStoredUrl,
  mediaKind,
  playableRedirect,
  verifyMediaTicket,
};
