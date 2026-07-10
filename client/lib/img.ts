// Routes external course/therapist/bundle images (hosted full-resolution on
// top4top.io — some 8–12 MB) through the server-side /api/img resize+WebP proxy,
// which caches an optimized copy. Anything not proxyable (data: URIs, relative
// or blob URLs, other hosts like ui-avatars) is returned unchanged so nothing
// breaks — the proxy itself also falls back to the original on any error.
const PROXY_HOST_RE = /(^|\.)top4top\.io$/i;

export function cdnImg(url: string | null | undefined, width: number): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url; // data:, blob:, relative
  try {
    if (!PROXY_HOST_RE.test(new URL(url).hostname)) return url;
  } catch {
    return url;
  }
  return `/api/img?src=${encodeURIComponent(url)}&w=${width}`;
}
