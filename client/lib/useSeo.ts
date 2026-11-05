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

// What a page that gives no description of its own says: the institute's, not the previous page's. Before this a page without
// one (the sign-in page, the checkout) kept the description of whichever page the visitor had just left.
export const DEFAULT_DESCRIPTION = 'معهد الدراسات النفسية — رواد التعليم النفسي منذ 2010. دبلومات معتمدة في الصحة النفسية والعلاج النفسي والإرشاد الأسري.';
const DEFAULT_IMAGE = `${SITE}/brand/og.jpg`;

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
  /** A page that belongs to one visitor (account, payment, rating link, 404): out of the search results. */
  noindex?: boolean;
};

/**
 * The structured data the prerendered page carries (api/lib/seoPages.js marks each block with data-page-ld="<its path>"). The app
 * swaps pages without a reload, so a block that describes the page just left has to go: Google would otherwise read a course's
 * data on the page of the next one. The block of the page we are on stays — it is what the server wrote for it.
 */
function dropStaleStructuredData(path: string) {
  const same = (a: string, b: string) => {
    const plain = (value: string) => {
      let text = value;
      try { text = decodeURIComponent(value); } catch { /* keep it as written */ }
      return text.length > 1 ? text.replace(/\/+$/, '') : text;
    };
    return plain(a) === plain(b);
  };
  document.head.querySelectorAll('script[data-page-ld]').forEach(node => {
    const owner = (node.getAttribute('data-page-ld') || '').split('#')[0];
    if (!same(owner, path)) node.remove();
  });
}

export function useSeo({ title, description, path, image, type = 'website', noindex = false }: SeoInput): void {
  useEffect(() => {
    if (!title) return;
    const pagePath = path ?? window.location.pathname;
    const url = `${SITE}${pagePath}`;
    const text = description || DEFAULT_DESCRIPTION;
    const picture = image || DEFAULT_IMAGE;

    document.title = title;
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:type"]', 'content', type);
    setMeta('meta[name="description"]', 'content', text);
    setMeta('meta[property="og:description"]', 'content', text);
    setMeta('meta[name="twitter:url"]', 'content', url);
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', text);
    setMeta('meta[property="og:image"]', 'content', picture);
    setMeta('meta[name="twitter:image"]', 'content', picture);
    // Set on every page, either way: a `noindex` left behind by the page before would take the next one out of Google.
    setMeta('meta[name="robots"]', 'content', noindex ? 'noindex, nofollow' : 'index, follow');
    dropStaleStructuredData(pagePath);
  }, [title, description, path, image, type, noindex]);
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
 * Just the canonical, og:url and robots, for a page whose title effect does other work
 * and is not worth rewriting. Same job as useSeo's first two lines.
 */
export function setCanonical(pathname: string, noindex = false): void {
  const url = `${SITE}${pathname}`;
  setMeta('link[rel="canonical"]', 'href', url);
  setMeta('meta[property="og:url"]', 'content', url);
  // Either way, so a page that is out of the results does not leave its noindex on the next one.
  setMeta('meta[name="robots"]', 'content', noindex ? 'noindex, nofollow' : 'index, follow');
  dropStaleStructuredData(pathname);
}
