import { CONVERTED_LEAD_STATUSES, TERMINAL_LEAD_STATUSES } from '../../../../../shared/leadStatuses';
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

/** Statuses that end a lead's life — the one list, shared/leadStatuses.ts. */
export { TERMINAL_LEAD_STATUSES };

type PoolLead = {
  hidden?: boolean; assignedSalesId?: string | null; assignedCsId?: string | null; source?: string | null;
  status?: string | null; branch?: string | null; phone?: string | null; email?: string | null;
};

/**
 * Why a lead is in «محلي جديد» (or, abroad, «داتا سعودي»), or null when it is not:
 *   waiting   nobody has it and it is still open — what «توزيع تلقائي» hands out
 *   closed    nobody has it and its status ended it (wrong number, not interested…)
 *   archived  the cold-lead job archived it, whoever had it
 *   hidden    someone hid it — a rep, the desk, «حذف» — and it can still be reached
 *
 * «مينفعش عميل مش ظاهر ادامي خلي اي عميل مورشف او مش ظاهر يكون موجود في محلي
 * جديد». On 6 Oct 2026, 1,747 leads were on no tab at all: hidden ones, and
 * archived ones nobody held. The pool held only the first kind of the four.
 * A client (converted) and an imported archive row («محلي قديم») have their own
 * screens. A hidden row with neither a number nor an address is not a person
 * anyone can call — the junk the clean-up hid — and stays hidden. The server's
 * copy is api/lib/leadPoolFilter.js POOL_REASON; keep the two in step.
 */
export type PoolReason = 'waiting' | 'closed' | 'archived' | 'hidden';

export const poolReasonOf = (lead: PoolLead): PoolReason | null => {
  const status = String(lead.status || '').trim().toLowerCase();
  if (CONVERTED_LEAD_STATUSES.has(status)) return null;
  if (lead.hidden) return String(lead.phone || '').trim() || String(lead.email || '').trim() ? 'hidden' : null;
  if (isArchiveSource(lead.source)) return null;
  if (status === 'archived') return 'archived';
  if (lead.assignedSalesId || lead.assignedCsId) return null;
  return TERMINAL_LEAD_STATUSES.has(status) ? 'closed' : 'waiting';
};

export const POOL_REASON_LABELS: Record<PoolReason, string> = {
  waiting: 'مستني توزيع', closed: 'مقفول من غير مندوب', archived: 'مؤرشف', hidden: 'مخفي',
};

/**
 * Waiting for a rep: what «توزيع تلقائي» draws from, and where whatever it
 * leaves behind — a day's cap reached, the deliberate no-rep slot — stays.
 * A lead handed to a collection officer from the remaining data has an owner
 * too: it leaves the pool, so a sales distribution cannot give the same person
 * to somebody else (api/routes/admin/leads.js reads assigned_cs_id the same way).
 */
export const isUndistributedLead = (lead: PoolLead): boolean => poolReasonOf(lead) === 'waiting';

/** «محلي جديد». */
export const isLocalNewLead = (lead: PoolLead): boolean => poolReasonOf(lead) !== null && !isInternationalLead(lead);

/** «دولي جديد», the half of «داتا سعودي» waiting for someone. */
export const isDawliNewLead = (lead: PoolLead): boolean => poolReasonOf(lead) !== null && isInternationalLead(lead);

/** How many of a pool tab's leads are there for each reason (GET /admin/leads/pool). */
export type PoolBreakdown = Record<PoolReason, number>;

/** The same count, over leads already in hand. */
export const poolBreakdownOf = (leads: ReadonlyArray<PoolLead>): PoolBreakdown => {
  const counts: PoolBreakdown = { waiting: 0, closed: 0, archived: 0, hidden: 0 };
  for (const lead of leads) {
    const reason = poolReasonOf(lead);
    if (reason) counts[reason]++;
  }
  return counts;
};
