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

/**
 * Statuses that end a lead's life — api/lib/leadStatuses.js TERMINAL_LEAD_STATUSES,
 * which the distributor reads. Keep the two identical.
 */
export const TERMINAL_LEAD_STATUSES = new Set([
  'converted', 'lost', 'won', 'closed', 'not_interested', 'not_interested_hidden',
  'wrong_number', 'unqualified', 'disqualified', 'archived',
]);

type PoolLead = {
  hidden?: boolean; assignedSalesId?: string | null; assignedCsId?: string | null; source?: string | null;
  status?: string | null; branch?: string | null;
};

/**
 * Waiting for a rep: what «توزيع تلقائي» draws from, and where whatever it
 * leaves behind — a day's cap reached, the deliberate no-rep slot — stays.
 *
 * «اي ليد مش بيتوزع اتوماتك بيظهر في الصفحه دي». The screen and the server
 * disagreed about it. The tab excluded only converted and lost, so a lead the
 * auto-archiver had closed as never contacted, or one marked wrong number, sat
 * in «محلي جديد» as if it were waiting — though no distribution would ever hand
 * it out. And the badge, the counter above the table and the two tables each
 * counted their own version: 4, 3 and 2 for the same five leads.
 *
 * A lead handed to a collection officer from the remaining data has an owner
 * too: it leaves the pool, so a sales distribution cannot give the same person
 * to somebody else (api/routes/admin/leads.js reads assigned_cs_id the same way).
 */
export const isUndistributedLead = (lead: PoolLead): boolean =>
  !lead.hidden && !lead.assignedSalesId && !lead.assignedCsId
  && !isArchiveSource(lead.source)
  && !TERMINAL_LEAD_STATUSES.has(String(lead.status || '').trim().toLowerCase());

/** «محلي جديد». */
export const isLocalNewLead = (lead: PoolLead): boolean => isUndistributedLead(lead) && !isInternationalLead(lead);

/** «دولي جديد». */
export const isDawliNewLead = (lead: PoolLead): boolean => isUndistributedLead(lead) && isInternationalLead(lead);
