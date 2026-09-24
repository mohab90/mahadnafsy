/**
 * Which lead sources belong to an archive tab rather than the live pool.
 *
 * "محلي جديد" is the unassigned pool of *fresh* enquiries. An imported archive
 * is also unassigned — deliberately, so the desk can distribute it — so without
 * this split a 2,000-row import floods the tab meant for today's new leads.
 * Two tabs, two pools.
 *
 * The server applies the same rule (api/lib/leadArchive.js) — keep the two
 * prefix lists identical.
 *
 * Matched by prefix so the "— موزّع" variant written when a batch is released
 * into the main table is covered by the same rule.
 */
export const ARCHIVE_SOURCE_PREFIXES = ['محلي قديم', 'دولي قديم', 'استيراد'];

export const isArchiveSource = (source?: string | null): boolean => {
  const value = String(source || '').trim();
  return ARCHIVE_SOURCE_PREFIXES.some(prefix => value.startsWith(prefix));
};

/**
 * Local or international, decided by branch first and source second.
 *
 * The دولي tabs used to be source-only, matching a "دولي قديم" source that no
 * lead in the database has — so they could only ever be empty, and what showed
 * on them was the previous tab's rows. Branch is the field that is actually
 * filled: every lead carries one, and the two online-international branches
 * hold real customers. Source is still honoured for data imported under a
 * "دولي …" label, so either way of marking a lead abroad lands it in the right
 * pair of tabs.
 */
const INTERNATIONAL_BRANCHES = ['ONLINE_ABROAD', 'ONLINE_SAUDI'];

export const isInternationalLead = (lead: { branch?: string | null; source?: string | null }): boolean => {
  const branch = String(lead.branch || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (INTERNATIONAL_BRANCHES.includes(branch)) return true;
  return String(lead.source || '').trim().startsWith('دولي');
};
