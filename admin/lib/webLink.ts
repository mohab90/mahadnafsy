/**
 * A link from a record, safe to put in an href. Some of these were typed by an anonymous
 * visitor (the join-us form's «LinkedIn / الموقع») and opened by staff in one click, and
 * `javascript:` in an href is a script running in the staff member's session. Only
 * absolute http(s) links, and our own /uploads paths, come out; anything else is undefined
 * so the caller can leave the link out.
 */
export function webLink(value: string | null | undefined): string | undefined {
  const raw = String(value ?? '').trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
  if (/^\/uploads\/[^\s"'<>]+$/.test(raw)) return raw;
  return undefined;
}
