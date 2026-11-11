/**
 * One key per opened form, sent with the save: a second request carrying it (a double click, a retry after a timeout) is answered with the first one's result by the
 * server instead of writing again (expenses, box withdrawals, manual journal entries — api/lib/idempotency.js). Two forms opened apart get two keys, so two genuinely
 * identical records both save.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}
