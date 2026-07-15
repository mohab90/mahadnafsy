import DOMPurify from 'dompurify';

export const RICH_HTML_ALLOWED_TAGS = ['p','br','strong','em','u','s','h1','h2','h3','h4','ul','ol','li','a','span','div','blockquote','hr'];
export const RICH_HTML_ALLOWED_ATTR = ['href','target','rel','class','dir'];

export function sanitizeRichHtml(html: string | null | undefined): string {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: RICH_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: RICH_HTML_ALLOWED_ATTR,
    FORCE_BODY: true,
  });
}
