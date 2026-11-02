import { demoteHeadings, sanitizeRichHtml } from './sanitizeHtml';

interface SafeHtmlProps {
  html: string;
  className?: string;
  fallback?: string;
  /** The page already has its h1: the text's own headings start one level lower. */
  demoteHeadings?: boolean;
}

/** Renders admin-authored HTML safely after DOMPurify sanitization.
 *  Use wherever dangerouslySetInnerHTML is needed. */
export function SafeHtml({ html, className, fallback = '', demoteHeadings: demote = false }: SafeHtmlProps) {
  const sanitized = sanitizeRichHtml(html || fallback);
  const clean = demote ? demoteHeadings(sanitized) : sanitized;
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
