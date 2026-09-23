/**
 * One rule, shared by the course page player and the student dashboard player,
 * for how a lecture URL is shown.
 *
 * A URL reaches the browser in one of two shapes:
 *  - the free preview lecture carries its stored URL (usually `enc:`-obfuscated);
 *  - every other lecture carries `/api/media/lectures/<id>?ticket=…&kind=…`,
 *    where the server already classified it.
 *
 * Only a real media file can go in a <video> element. Everything else (YouTube,
 * Vimeo, Google Drive, a hosted player page) must be framed — handing those to
 * <video> is what left every lecture after the first one blank.
 */

// Same key as api/lib/mediaAccess.js and the admin editor. It only obfuscates
// the link in the catalogue; it was never a secret. The dashboard player used
// to read it from VITE_VIDEO_KEY, which no build sets, so it could not decode
// the preview lecture at all.
const VIDEO_KEY = '\x6d\x68\x64\x2d\x6e\x61\x66\x73\x79\x2d\x32\x30\x32\x36';

export function decodeLectureUrl(raw: string): string {
  if (!raw || !raw.startsWith('enc:')) return raw;
  try {
    return atob(raw.slice(4)).split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ VIDEO_KEY.charCodeAt(i % VIDEO_KEY.length)),
    ).join('');
  } catch { return raw; }
}

const DIRECT_MEDIA_FILE = /\.(?:mp4|m4v|webm|ogg|ogv|mov|m3u8)(?:$|[?#])/i;

export function isHlsLectureUrl(url: string): boolean {
  return url.includes('.m3u8') || url.includes('/hls/') || url.includes('kind=hls');
}

/** true → render in an <iframe>; false → render in a <video> element. */
export function isFramedLectureUrl(raw: string): boolean {
  if (!raw) return false;
  if (raw.includes('/api/media/lectures/')) return raw.includes('kind=embed');
  const url = decodeLectureUrl(raw);
  if (url.startsWith('/uploads/') || isHlsLectureUrl(url)) return false;
  return !DIRECT_MEDIA_FILE.test(url);
}

/** Embeddable form of a framed lecture URL; `params` is appended to YouTube embeds. */
export function toLectureEmbedUrl(raw: string, params = ''): string {
  const plain = decodeLectureUrl(raw);
  if (!plain) return '';
  let youtubeId = '';
  if (plain.includes('youtube.com/watch')) {
    try { youtubeId = new URL(plain).searchParams.get('v') || ''; } catch { /* fall through */ }
  } else if (plain.includes('youtu.be/')) {
    youtubeId = plain.split('youtu.be/')[1]?.split(/[?#]/)[0] || '';
  } else if (plain.includes('youtube.com/embed/')) {
    youtubeId = plain.split('embed/')[1]?.split(/[?#]/)[0] || '';
  }
  if (youtubeId) return `https://www.youtube-nocookie.com/embed/${youtubeId}${params}`;
  try {
    const parsed = new URL(plain);
    // vimeo.com/<id> and a Drive ".../view" link refuse to be framed.
    if (/(^|\.)vimeo\.com$/.test(parsed.hostname) && parsed.hostname !== 'player.vimeo.com') {
      const vimeoId = parsed.pathname.split('/').filter(Boolean).find(part => /^\d+$/.test(part));
      if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
    }
    if (parsed.hostname === 'drive.google.com') {
      const driveId = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id');
      if (driveId) return `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`;
    }
  } catch { /* relative URL such as /api/media/… — use as is */ }
  return plain;
}
