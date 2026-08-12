import { useEffect, useMemo, useState } from 'react';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlCatalog } from '../lib/mysqlapi';

export type BranchOption = { id: string; label: string };

type ApiBranch = { branch_key?: string; label?: string };

// One cached fetch shared by every caller: the modals that use this hook are
// often mounted several at a time, and each of them asking for the same list
// would issue its own request on open.
let cachedBranches: BranchOption[] | null = null;
let inFlight: Promise<BranchOption[]> | null = null;

async function loadBranches(): Promise<BranchOption[]> {
  if (cachedBranches) return cachedBranches;
  if (!inFlight) {
    inFlight = mysqlCatalog.listBranches()
      .then(rows => {
        const mapped = (Array.isArray(rows) ? rows : [])
          .map((b: ApiBranch) => ({ id: String(b.branch_key || ''), label: String(b.label || b.branch_key || '') }))
          .filter(b => b.id);
        if (mapped.length) cachedBranches = mapped;
        return mapped;
      })
      .catch(() => [])
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * The institute's branches, from the `branches` table via /api/branches.
 *
 * This used to parse content['institute.branches'], one of four different
 * sources the same payment dialog was fed from depending on which page opened
 * it — a hardcoded enum on one screen, a content string on another, nothing at
 * all on a third, which is why the branch dropdown was empty in some places and
 * differed in others. The table is what the server validates against, so it is
 * the one that belongs here.
 *
 * The content key stays as a fallback for a tenant that has not been migrated
 * onto the table yet.
 */
export function useBranches(): BranchOption[] {
  const { content } = useSiteData();
  const [fetched, setFetched] = useState<BranchOption[]>(() => cachedBranches || []);

  useEffect(() => {
    let cancelled = false;
    void loadBranches().then(rows => { if (!cancelled && rows.length) setFetched(rows); });
    return () => { cancelled = true; };
  }, []);

  const fromContent = useMemo(() => {
    try {
      const parsed = JSON.parse(content['institute.branches'] || '[]');
      return Array.isArray(parsed) ? (parsed as BranchOption[]) : [];
    } catch {
      return [];
    }
  }, [content]);

  return fetched.length ? fetched : fromContent;
}
