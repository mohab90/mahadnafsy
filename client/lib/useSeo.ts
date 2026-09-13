import { useEffect } from 'react';

/**
 * The page's own title, canonical and share card.
 *
 * The prerenderer (tools/generate-seo.mjs) writes these into the HTML a crawler
 * fetches, which is what fixes link previews — Facebook and WhatsApp do not run
 * JavaScript. This is the other half: once the app is running, moving between
 * pages has to keep them in step, or the canonical of whichever page was loaded
 * first follows the visitor around the site.
 *
 * Every page used to set `document.title` in its own useEffect and nothing
 * else. So `<link rel="canonical">` stayed on the homepage for the whole
 * session — the one tag that tells Google a page is a duplicate.
 */

const SITE = 'https://mahadnafsy.com';

function setMeta(selector: string, attribute: 'content' | 'href', value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attribute, value);
}

export type SeoInput = {
  /** Shown in the tab and as the share card's headline. */
  title: string;
  /** One sentence. Long text is trimmed by the caller, not here. */
  description?: string;
  /** Path only — `/c/my-course`. Defaults to the current location. */
  path?: string;
  /** Absolute URL. Omit to keep the institute's default card image. */
  image?: string;
  /** 'article' for a course or bundle, 'website' for a section. */
  type?: 'website' | 'article';
};

export function useSeo({ title, description, path, image, type = 'website' }: SeoInput): void {
  useEffect(() => {
    if (!title) return;
    const url = `${SITE}${path ?? window.location.pathname}`;

    document.title = title;
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:type"]', 'content', type);
    if (description) {
      setMeta('meta[name="description"]', 'content', description);
      setMeta('meta[property="og:description"]', 'content', description);
      setMeta('meta[name="twitter:description"]', 'content', description);
    }
    if (image) setMeta('meta[property="og:image"]', 'content', image);
  }, [title, description, path, image, type]);
}

/** Markup out, one readable sentence in — for descriptions built from rich text. */
export function seoSummary(html: string | undefined | null, fallback: string, limit = 180): string {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Just the canonical and og:url, for a page whose title effect does other work
 * and is not worth rewriting. Same job as useSeo's first two lines.
 */
export function setCanonical(pathname: string): void {
  const url = `${SITE}${pathname}`;
  setMeta('link[rel="canonical"]', 'href', url);
  setMeta('meta[property="og:url"]', 'content', url);
}
