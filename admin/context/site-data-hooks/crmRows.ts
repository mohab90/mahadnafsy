import type { LeadItem, LeadStatus, SubscriberItem } from '../../types';

/**
 * The lead and client rows as the context holds them, shared by the loaders (useAdminDataRuntime) and the reloads
 * after a write (useCrmCoreState), so a reload puts back exactly the shape and order the load put there.
 */

/**
 * Newest first, decided once here rather than per screen.
 *
 * The API already answers `ORDER BY created_at DESC` on both lists, so the
 * order was usually right — but no screen asked for it. Every table downstream
 * (the archive pool, العملاء الأونلاين, الدقي) renders whatever order the array
 * happens to arrive in, so a route that paginates differently, a merge of two
 * fetches, or a filter that rebuilds the array silently reorders the page with
 * nothing to point at. Sorting where the rows enter the app makes it a property
 * of the data instead of a coincidence of the fetch.
 *
 * Rows without a date sort last: an undated row is not new, and floating it to
 * the top would put the least-known records in front of today's work.
 */
export const newestFirst = <T extends { createdAt?: string | null }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => {
    const left = String(a.createdAt || '');
    const right = String(b.createdAt || '');
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return right.localeCompare(left);
  });

export function normalizeLeads(rows: unknown): LeadItem[] {
  return newestFirst((rows as LeadItem[]).map(lead => ({
    ...lead,
    status: (lead.status || 'new').toLowerCase() as LeadStatus,
  })));
}

export function normalizeSubscribers(rows: unknown): SubscriberItem[] {
  return newestFirst((rows as SubscriberItem[]).map(subscriber => ({
    ...subscriber,
    enrolledCourseIds: Array.isArray(subscriber.enrolledCourseIds) ? subscriber.enrolledCourseIds : [],
  })));
}

/**
 * The clients already held, with `incoming` laid over them by id.
 *
 * A page that arrives is added to what is on screen; it does not replace it. The
 * background refresh used to replace the whole array with the newest 500, so a
 * branch's clients loaded for its screen vanished two minutes later and the
 * count fell back to however many of them were among the newest 500.
 */
export function mergeSubscribers(current: SubscriberItem[], incoming: SubscriberItem[]): SubscriberItem[] {
  const byId = new Map<string, SubscriberItem>();
  for (const row of current) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return newestFirst([...byId.values()]);
}

/**
 * What a reload after a write fetches: the whole table when the session holds the whole table, the first page when it
 * holds a page, and nothing when no screen has asked for the list. A reload used to download the whole lead table
 * (27k rows, six pages) whatever was held — usually the 500-row page or nothing at all.
 */
export type HeldRows = 'whole' | 'page' | 'none';
export const heldRowsOf = (wholeTable: boolean, heldCount: number): HeldRows =>
  (wholeTable ? 'whole' : heldCount > 0 ? 'page' : 'none');

/** Which whole tables the session holds; set by useAdminDataRuntime's full loads, read by the reloads. */
export interface WholeTables { leads: boolean; subscribers: boolean }
