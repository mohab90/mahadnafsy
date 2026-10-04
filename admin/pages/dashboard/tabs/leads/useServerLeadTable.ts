import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { BranchOption } from '../../../../hooks/useBranches';
import type { LeadItem, LeadStatus } from '../../../../types';
import { BRANCH_ENUM_LABELS, calcLeadScore, getStaleDays } from '../leadUtils';

/**
 * One page of the main lead table, filtered and counted by the server
 * (GET /admin/leads/table, api/lib/leadTableFilter.js).
 *
 * The table used to filter the whole leads array in the browser — every lead
 * downloaded first, 20 MB at 30k leads, and past the fetch's 50,000-row cap it
 * silently showed the newest tenth as the whole. The server applies the same
 * predicate as useLeadFilteringData (checked case by case against it) and sends
 * one page and the true total.
 */
export type LeadTableFilters = {
  searchTerm: string;
  assignFilter: Set<string>;
  tagFilter: string | null;
  sourceFilter: Set<string>;
  courseFilter: string | null;
  branchFilter: string | null;
  singleStatus: LeadStatus | '';
  showHiddenLeads: boolean;
  rottenFilter: boolean;
  salesSourceFilter: string;
  leadsFollowupFilter: string;
};

/** The filter bar as the query string GET /admin/leads/table and /board read. */
export function leadTableQuery(filters: LeadTableFilters, instituteBranches: BranchOption[]): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null | undefined) => { if (value) params.set(key, value); };
  set('q', filters.searchTerm.trim());
  set('assigned', [...filters.assignFilter].join(','));
  set('tag', filters.tagFilter);
  set('sources', [...filters.sourceFilter].join(','));
  set('course', filters.courseFilter);
  if (filters.branchFilter) {
    set('branch', filters.branchFilter);
    // The browser matched the branch by id or by its label.
    set('branchLabel', instituteBranches.find(branch => branch.id === filters.branchFilter)?.label
      || BRANCH_ENUM_LABELS[filters.branchFilter] || '');
  }
  set('status', filters.singleStatus);
  if (filters.showHiddenLeads) params.set('hidden', '1');
  if (filters.rottenFilter) { params.set('rotten', '1'); params.set('staleDays', String(getStaleDays()[0])); }
  set('salesSource', filters.salesSourceFilter);
  if (filters.leadsFollowupFilter !== 'all') params.set('followup', filters.leadsFollowupFilter);
  return params.toString();
}

export const SERVER_TABLE_PAGE_SIZE = 100;

export function useServerLeadTable(enabled: boolean, filters: LeadTableFilters, instituteBranches: BranchOption[]) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<(LeadItem & { _score?: number })[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  // The search box fires on every keystroke; the server is asked once typing pauses.
  const [search, setSearch] = useState(filters.searchTerm);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.searchTerm), 300);
    return () => clearTimeout(timer);
  }, [filters.searchTerm]);

  // Keyed on the filter fields, not the object, which is rebuilt every render.
  const query = useMemo(() => leadTableQuery({ ...filters, searchTerm: search }, instituteBranches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, filters.assignFilter, filters.tagFilter, filters.sourceFilter, filters.courseFilter, filters.branchFilter,
      filters.singleStatus, filters.showHiddenLeads, filters.rottenFilter, filters.salesSourceFilter, filters.leadsFollowupFilter,
      instituteBranches]);

  // A new filter starts from the first page.
  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current !== query) { lastQuery.current = query; setPage(0); }
  }, [query]);

  // The total is counted once per set of filters (and on refresh): counting
  // reads every matching lead, a page turn does not change it, and at 500k
  // leads it is most of the request's time.
  const countedFor = useRef('');
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    const countKey = `${query}#${refreshToken}`;
    const withTotal = countedFor.current !== countKey;
    const path = `/admin/leads/table?${query}${query ? '&' : ''}page=${page}&pageSize=${SERVER_TABLE_PAGE_SIZE}${withTotal ? '' : '&withTotal=0'}`;
    mysqlAdmin.adminGet<{ rows: LeadItem[]; total: number | null }>(path).then(
      result => {
        if (!alive) return;
        setRows(result.rows.map(lead => ({ ...lead, _score: calcLeadScore(lead) })));
        if (result.total !== null) { setTotal(result.total); countedFor.current = countKey; }
      },
      err => { if (alive) setError(err instanceof Error ? err.message : 'تعذر تحميل الليدز'); },
    ).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled, query, page, refreshToken]);

  const refresh = useCallback(() => setRefreshToken(token => token + 1), []);
  return { rows, total, page, setPage, loading, error, refresh, pageSize: SERVER_TABLE_PAGE_SIZE };
}
