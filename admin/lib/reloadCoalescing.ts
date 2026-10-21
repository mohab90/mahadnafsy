/**
 * One download shared by every caller (useCrmCoreState reloadLeads).
 *
 * A call while one runs cannot simply join it: that one may have read before
 * the caller's write landed. It waits for a single follow-up instead, and every
 * other caller meanwhile shares that follow-up too — so ten saves in a row cost
 * two downloads, not ten, and the last one always starts after the last save.
 */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again: Promise<void> | null = null;
  const call = (): Promise<void> => {
    if (!running) {
      running = run().finally(() => { running = null; });
      return running;
    }
    if (!again) {
      again = running.then(() => {
        again = null;
        return call();
      });
    }
    return again;
  };
  return call;
}

/**
 * The rows asked for, fetched again, put back into the list: replaced in
 * place, added at the top when new, and dropped when the server no longer
 * returns them (hidden by a merge, out of this employee's scope).
 */
export function patchRowsById<T extends { id: string }>(current: T[], fresh: T[], only: string[]): T[] {
  const wanted = new Set(only);
  const byId = new Map(fresh.map(row => [row.id, row]));
  const kept = current
    .filter(row => !wanted.has(row.id) || byId.has(row.id))
    .map(row => byId.get(row.id) ?? row);
  const known = new Set(kept.map(row => row.id));
  return [...fresh.filter(row => !known.has(row.id)), ...kept];
}
