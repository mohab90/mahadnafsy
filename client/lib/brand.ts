import type React from 'react';

// The logo on the institute's own domain, not on a free image host.
//
// «تتبّع الإعلانات صح … صفحات الكورسات في جوجل» (11 Oct 2026): the logo and the
// share image were served from top4top.io, so their availability was a stranger's
// to decide and every page leaned on a third-party host. They are
// client/public/brand/logo.png and og.jpg now (tools/fetch-brand-assets.mjs puts
// them there). Until they are, the old address still answers: here, by swapping
// the image once if it does not load, and in nginx, by redirecting /brand/.
export const BRAND_LOGO = '/brand/logo.png';
export const LEGACY_LOGO = 'https://h.top4top.io/p_3734xfq501.png';

/** onError for a logo <img>: the old hosted logo, once — never a loop. */
export function logoFallback(event: React.SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;
  if (img.dataset.logoFallback) return;
  img.dataset.logoFallback = '1';
  img.src = LEGACY_LOGO;
}
