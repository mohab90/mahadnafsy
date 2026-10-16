/**
 * The video id in a YouTube link, or null when it is not one.
 * Accepts youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…, /live/… and m./www./music. hosts.
 */
export function youtubeId(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '').toLowerCase();
  const valid = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);
  if (host === 'youtu.be') return valid(url.pathname.split('/')[1]);
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (url.pathname === '/watch') return valid(url.searchParams.get('v'));
  const [, kind, id] = url.pathname.split('/');
  if (['shorts', 'embed', 'live', 'v'].includes(kind)) return valid(id);
  return null;
}

export const youtubeThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
