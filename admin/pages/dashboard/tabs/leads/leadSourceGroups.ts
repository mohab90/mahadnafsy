/**
 * Which lead sources belong to an archive tab rather than the live pool.
 *
 * "محلي جديد" is the unassigned pool of *fresh* enquiries. An imported archive
 * is also unassigned — deliberately, so the desk can distribute it — so without
 * this split a 2,000-row import floods the tab meant for today's new leads.
 * Two tabs, two pools.
 *
 * Matched by prefix so the "— موزّع" variant written when a batch is released
 * into the main table is covered by the same rule.
 */
export const ARCHIVE_SOURCE_PREFIXES = ['محلي قديم', 'دولي قديم', 'استيراد'];

export const isArchiveSource = (source?: string | null): boolean => {
  const value = String(source || '').trim();
  return ARCHIVE_SOURCE_PREFIXES.some(prefix => value.startsWith(prefix));
};
