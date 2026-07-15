import { sanitizeRichHtml } from './sanitizeHtml';

interface SafeHtmlProps {
  html: string;
  className?: string;
  fallback?: string;
}

/** Renders admin-authored HTML safely after DOMPurify sanitization.
 *  Use wherever dangerouslySetInnerHTML is needed. */
export function SafeHtml({ html, className, fallback = '' }: SafeHtmlProps) {
  const clean = sanitizeRichHtml(html || fallback);
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
