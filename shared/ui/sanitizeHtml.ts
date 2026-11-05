import DOMPurify from 'dompurify';

const RICH_HTML_ALLOWED_TAGS = ['p','br','strong','em','u','s','h1','h2','h3','h4','ul','ol','li','a','span','div','blockquote','hr'];
const RICH_HTML_ALLOWED_ATTR = ['href','target','rel','class','dir'];

export function sanitizeRichHtml(html: string | null | undefined): string {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: RICH_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: RICH_HTML_ALLOWED_ATTR,
    FORCE_BODY: true,
  });
}

/**
 * A page has one h1 — its own title. Admin-written text (a course's long description) carries h1s of its own, so a course page
 * had ten. This moves every heading in the text one level down (h1 -> h2 ... h4 -> h5); the text was already sanitised, so only
 * the tag names change.
 */
export function demoteHeadings(html: string): string {
  return html.replace(/<(\/?)h([1-4])\b/gi, (_match, slash: string, level: string) => `<${slash}h${Number(level) + 1}`);
}
