import { useCallback, useEffect, useMemo, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { BranchOption } from '../../../../hooks/useBranches';
import type { LeadItem, LeadStatus } from '../../../../types';
import { calcLeadScore } from '../leadUtils';
import { leadTableQuery, type LeadTableFilters } from './useServerLeadTable';

/**
 * The pipeline board from GET /admin/leads/board: each column's true count and
 * its first cards, under the same filters as the table.
 *
 * The board loaded every lead and grouped them here — the last CRM screen that
 * did. The cards and counts come out the same (checked against the browser's
 * own grouping by leadTableParity.integration.test.js); only a column's first
 * `colLimit` cards are fetched, and «عرض المزيد» asks for more.
 */
export function useServerLeadBoard(
  enabled: boolean,
  filters: LeadTableFilters,
  instituteBranches: BranchOption[],
  columns: LeadStatus[],
  colLimit: Record<string, number>,
) {
  const [rows, setRows] = useState<(LeadItem & { _score: number })[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState(0);
  // Typing in the search box asks once the typing pauses.
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
  const statuses = columns.join(',');
  const limits = columns.map(status => `${status}:${colLimit[status] || 15}`).join(',');

  useEffect(() => {
    if (!enabled || !statuses) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    mysqlAdmin.adminGet<{ counts: Record<string, number>; rows: LeadItem[] }>(
      `/admin/leads/board?${query}${query ? '&' : ''}statuses=${encodeURIComponent(statuses)}&limits=${encodeURIComponent(limits)}`,
    ).then(
      result => {
        if (!alive) return;
        setCounts(result.counts);
        setRows(result.rows.map(lead => ({ ...lead, _score: calcLeadScore(lead) })));
      },
      err => { if (alive) setError(err instanceof Error ? err.message : 'تعذر تحميل البايبلاين'); },
    ).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled, query, statuses, limits, token]);

  const refresh = useCallback(() => setToken(t => t + 1), []);
  return { rows, counts, loading, error, refresh };
}
