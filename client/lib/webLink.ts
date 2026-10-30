/**
 * A link from a record, safe to put in an href: absolute http(s) only, or one of our own
 * /uploads paths. `javascript:` in an href is a script running in the visitor's session;
 * anything else comes out undefined so the caller can leave the link out.
 */
export function webLink(value: string | null | undefined): string | undefined {
  const raw = String(value ?? '').trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
  if (/^\/uploads\/[^\s"'<>]+$/.test(raw)) return raw;
  return undefined;
}
