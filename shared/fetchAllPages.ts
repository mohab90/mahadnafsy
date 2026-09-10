/**
 * Read a paged endpoint until it stops filling pages.
 *
 * Written for the lectures list, which was fetched with a flat limit — 2000 in
 * the staff bootstrap, 5000 in the admin one — against 2392 published rows. The
 * short caller lost 392 lectures and said nothing: the endpoint orders by
 * course, so whole courses at the end of the list simply had no lectures, on
 * every screen that counted them. «شاهد 0 من 0» for a client who had watched
 * the course.
 *
 * A flat limit is a guess about how much data there will be, and it is wrong
 * the moment the institute adds a course. This asks for pages until it gets a
 * short one, which is the endpoint's own way of saying "that was the last".
 *
 * maxPages is a stop, not a size: 25 pages of 1000 is 25,000 rows, far past
 * anything this is used for. Reaching it means a paging bug, not a big table,
 * and returning what we have is better than looping forever.
 */
export async function fetchAllPages<T>(
  page: (limit: number, offset: number) => Promise<T[]>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 25;
  const all: T[] = [];
  for (let index = 0; index < maxPages; index += 1) {
    const rows = await page(pageSize, index * pageSize);
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
