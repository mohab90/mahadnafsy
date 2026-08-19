// Routes external course/therapist/bundle images (hosted full-resolution on
// top4top.io — some 8–12 MB) through the server-side /api/img resize+WebP proxy,
// which caches an optimized copy. Anything not proxyable (data: URIs, relative
// or blob URLs, other hosts like ui-avatars) is returned unchanged so nothing
// breaks — the proxy itself also falls back to the original on any error.
const PROXY_HOST_RE = /(^|\.)top4top\.io$/i;

// Returns undefined — not '' — when there is no image. Every caller feeds this
// straight into `src`, and `src=""` makes the browser re-request the current
// page URL as if it were an image: a whole extra page download per missing
// thumbnail, and React warns about it for exactly that reason. undefined makes
// React omit the attribute, so a card with no picture simply shows its
// background instead of quietly re-fetching the page.
export function cdnImg(url: string | null | undefined, width: number): string | undefined {
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) return url; // data:, blob:, relative
  try {
    if (!PROXY_HOST_RE.test(new URL(url).hostname)) return url;
  } catch {
    return url;
  }
  return `/api/img?src=${encodeURIComponent(url)}&w=${width}`;
}
