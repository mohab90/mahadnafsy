import DOMPurify from 'dompurify';

interface SafeHtmlProps {
  html: string;
  className?: string;
  fallback?: string;
}

/** Renders admin-authored HTML safely after DOMPurify sanitization.
 *  Use wherever dangerouslySetInnerHTML is needed. */
export function SafeHtml({ html, className, fallback = '' }: SafeHtmlProps) {
  const clean = DOMPurify.sanitize(html || fallback, {
    ALLOWED_TAGS: ['p','br','strong','em','u','s','h1','h2','h3','h4','ul','ol','li','a','span','div','blockquote','hr'],
    ALLOWED_ATTR: ['href','target','rel','class','dir'],
    FORCE_BODY: true,
  });
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
