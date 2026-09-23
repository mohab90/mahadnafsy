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
 * Every parameter here exists to keep the viewer on this site:
 *   rel=0              no related videos on the end screen
 *   modestbranding=1   the logo in the control bar, not the wordmark
 *   showinfo=0         no title overlay
 *   iv_load_policy=3   no annotations, which can carry links
 *   disablekb=1        YouTube's keyboard shortcuts, some of which navigate away
 *   fs=0               no fullscreen — its native chrome shows the title, and
 *                      the title is a link to youtube.com
 *   controls=1         required: YouTube answers Error 153 to controls=0
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
    'controls=1',
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
