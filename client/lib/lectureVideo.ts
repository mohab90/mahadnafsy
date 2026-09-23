/**
 * One answer to "how does this site show a video".
 *
 * There were five copies of the same two functions — the dashboard player, the
 * course page, the bundle trailer, the home page and the community feed — and
 * they had drifted into five different levels of protection. The two lecture
 * players sent rel=0, fs=0, disablekb=1 and modestbranding; the other three
 * sent some subset, and the bundle trailer was still on plain youtube.com with
 * the full chrome: a title bar, «Watch on YouTube» and related videos at the
 * end, each one a link to the channel that lists 2,416 lectures.
 *
 * The de-obfuscation had drifted too. The course page had its own copy with the
 * key written into it, ignoring VITE_VIDEO_KEY, so rotating the key would have
 * left the dashboard working and the course page showing nothing.
 *
 * Closing a route out of the site is not worth doing four times out of five.
 */

// The key the lecture URLs were obfuscated with. The env var wins if it is ever
// set, so a deployment that rotates it keeps working.
const VIDEO_KEY = (import.meta.env.VITE_VIDEO_KEY as string)
  || '\x6d\x68\x64\x2d\x6e\x61\x66\x73\x79\x2d\x32\x30\x32\x36';

/**
 * The lecture's real URL.
 *
 * Not encryption and not claimed to be: it stops the URL being read straight
 * out of an API response or the DOM, which is where it used to sit. Anything
 * that is not marked `enc:` is returned untouched, so a plain URL — an mp4, an
 * HLS manifest, a signed media ticket — passes through.
 */
export function revealVideoUrl(raw: string): string {
  if (!raw || !raw.startsWith('enc:') || !VIDEO_KEY) return raw;
  try {
    return atob(raw.slice(4)).split('').map((character, index) =>
      String.fromCharCode(character.charCodeAt(0) ^ VIDEO_KEY.charCodeAt(index % VIDEO_KEY.length))
    ).join('');
  } catch { return raw; }
}

function youtubeId(url: string): string {
  return url.match(/[?&]v=([\w-]{11})/)?.[1]
    || url.match(/youtu\.be\/([\w-]{11})/)?.[1]
    || url.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/)?.[1]
    || '';
}

export type EmbedOptions = {
  autoplay?: boolean;
  /** Resume position, in seconds. */
  startSeconds?: number;
  /**
   * enablejsapi=1, for the one player that listens for progress over
   * postMessage. Off everywhere else: without a referrer YouTube answers
   * Error 153 and refuses to play at all, which is how the course page broke
   * the first time it was set.
   */
  jsApi?: boolean;
};

/**
 * A YouTube URL as an embed this site can host, or the URL unchanged when it is
 * not YouTube.
 *
 * controls=0 is the one that matters, and it is the answer to «عاوز اقفل اني
 * يظهر علامه اليوتيوب في اسفل الشاشه او انه يضغط علي عنوان الفيديو ويتنقل منه
 * لليوتيوب». modestbranding has not removed the logo since YouTube retired it
 * in 2023, and showinfo has done nothing since 2018 — both were in this URL,
 * both were doing nothing, and the logo and the title were still there. With
 * controls=0 there is no control bar to hold a logo and no title bar to click:
 * checked on the live site against a real lecture, playing and on hover, and
 * the frame shows the video and nothing else.
 *
 * Two pieces of YouTube branding survive controls=0 — the red play button on
 * the poster and the wordmark on the loading screen — and neither is a link.
 * VideoSurface covers both with its own poster, which is why this function is
 * only ever called from there.
 *
 * The rest:
 *   rel=0              no related videos on the end screen
 *   iv_load_policy=3   no annotations, which can carry links
 *   disablekb=1        YouTube's keyboard shortcuts, some of which navigate away
 *   fs=0               no YouTube fullscreen — its native chrome shows the
 *                      title. VideoSurface fullscreens its own wrapper instead.
 * and youtube-nocookie.com rather than youtube.com, so watching a lecture does
 * not write a viewing history against the customer's Google account.
 */
export function youtubeEmbedUrl(url: string, options: EmbedOptions = {}): string {
  const plain = revealVideoUrl(url || '');
  if (!plain) return '';
  const id = youtubeId(plain);
  if (!id) return plain;
  const params = [
    `autoplay=${options.autoplay ? 1 : 0}`,
    'controls=0',
    'modestbranding=1',
    'rel=0',
    'showinfo=0',
    'iv_load_policy=3',
    'color=white',
    'playsinline=1',
    'disablekb=1',
    'fs=0',
  ];
  if (options.jsApi) params.push('enablejsapi=1');
  if (options.startSeconds && options.startSeconds > 0) {
    params.push(`start=${Math.floor(options.startSeconds)}`);
  }
  return `https://www.youtube-nocookie.com/embed/${id}?${params.join('&')}`;
}

/**
 * Which element a lecture goes in, and — when it is framed — whose player.
 *
 * A URL reaches the browser in one of two shapes: the free preview lecture
 * carries its stored URL, usually `enc:`-obfuscated; every other lecture
 * carries `/api/media/lectures/<id>?ticket=…&kind=…&provider=…`, which the
 * server has already classified.
 *
 * Only a real media file can go in a <video> element. Everything else — a
 * YouTube, Vimeo or Drive page, any hosted player — is a web page and has to be
 * framed. The test used to be "does this look like YouTube", so a Drive or
 * Vimeo lecture fell through to <video> and played nothing, while the free
 * first lecture worked: «اول فيديو بس اللى بيشتغل».
 */

const DIRECT_MEDIA_FILE = /\.(?:mp4|m4v|webm|ogg|ogv|mov|m3u8)(?:$|[?#])/i;

const isTicket = (raw: string) => raw.includes('/api/media/lectures/');

export function isHlsLectureUrl(url: string): boolean {
  return url.includes('.m3u8') || url.includes('/hls/') || url.includes('kind=hls');
}

/** true → render in a frame; false → render in a <video> element. */
export function isFramedLectureUrl(raw: string): boolean {
  if (!raw) return false;
  if (isTicket(raw)) return raw.includes('kind=embed');
  const url = revealVideoUrl(raw);
  if (url.startsWith('/uploads/') || isHlsLectureUrl(url)) return false;
  return !DIRECT_MEDIA_FILE.test(url);
}

/**
 * Whether a framed lecture is one VideoSurface can drive.
 *
 * VideoSurface replaces YouTube's controls with the site's own and talks to it
 * over postMessage. Vimeo and Drive answer none of that, so pointing it at one
 * leaves a poster that never lifts and a play button that does nothing — they
 * keep their own player instead. A ticket hides the host, which is why the
 * server says so in `provider`.
 */
export function isYouTubeLecture(raw: string): boolean {
  if (!raw) return false;
  if (isTicket(raw)) return !raw.includes('provider=other');
  const url = revealVideoUrl(raw);
  return url.includes('youtube.com') || url.includes('youtu.be');
}

/**
 * The embeddable form of a framed lecture that is not YouTube.
 *
 * `vimeo.com/<id>` and a Drive `.../view` link both refuse to be framed; their
 * player/preview forms are the equivalents that do not.
 */
export function lectureEmbedUrl(raw: string): string {
  const plain = revealVideoUrl(raw || '');
  if (!plain || isTicket(plain)) return plain;
  try {
    const parsed = new URL(plain, window.location.origin);
    if (/(^|\.)vimeo\.com$/.test(parsed.hostname) && parsed.hostname !== 'player.vimeo.com') {
      const vimeoId = parsed.pathname.split('/').filter(Boolean).find(part => /^\d+$/.test(part));
      if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
    }
    if (parsed.hostname === 'drive.google.com') {
      const driveId = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id');
      if (driveId) return `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`;
    }
  } catch { /* a relative URL such as /uploads/… — use it as it is */ }
  return plain;
}
