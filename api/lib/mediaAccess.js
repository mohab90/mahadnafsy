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

function mediaKind(value) {
  const url = decodeStoredUrl(value).toLowerCase();
  if (/youtu\.be|youtube\.com/.test(url)) return 'embed';
  if (/\.m3u8(?:$|\?)/.test(url) || url.includes('/hls/')) return 'hls';
  return 'video';
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

/**
 * The embed a paid lecture is redirected to.
 *
 * This is the second place that builds one of these URLs, and for a while it
 * was the forgotten one. A free preview lecture carries its URL in the public
 * catalogue and the browser builds the embed itself; every paid lecture comes
 * back as a ticket and the browser only ever loads this redirect. So the
 * parameters that matter have to be set twice — once in
 * client/lib/lectureVideo.ts and once here — and when they were not, the paid
 * lectures were the ones that broke: «اول فيديو بس اللى بيشتغل».
 *
 * controls=1 was putting YouTube's own bar back, logo and clickable title and
 * all, on exactly the videos people pay for. And with no enablejsapi the player
 * accepts no commands, so a page that had replaced YouTube's controls with its
 * own could not start it at all.
 *
 * aPaidLecturePlaysLikeAFreeOne.test.js holds the two lists to each other.
 */
function playableRedirect(value, { start = 0, autoplay = false } = {}) {
  const url = decodeStoredUrl(value);
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return '';
  try {
    const parsed = new URL(url, 'https://local.invalid');
    let id = '';
    if (parsed.hostname.includes('youtu.be')) id = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (parsed.hostname.includes('youtube.com')) {
      id = parsed.searchParams.get('v') || parsed.pathname.split('/embed/')[1]?.split('/')[0] || '';
    }
    if (!id) return url;
    const params = [
      `autoplay=${autoplay ? 1 : 0}`,
      'controls=0',
      'modestbranding=1',
      'rel=0',
      'showinfo=0',
      'iv_load_policy=3',
      'color=white',
      'playsinline=1',
      'disablekb=1',
      'fs=0',
      'enablejsapi=1',
    ];
    // Where the viewer had got to. The browser cannot put this in the URL it
    // builds — for a paid lecture it never sees one — so it travels as a query
    // on the ticket and is folded in here. Without it a paid lecture always
    // restarted from zero, however much of it had been watched.
    const resume = Math.floor(Number(start) || 0);
    if (resume > 0) params.push(`start=${resume}`);
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.join('&')}`;
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
