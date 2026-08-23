import { useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { ScoredLeadsResult } from '../../../types';

export interface ScoredLeadsQuery {
  minScore: number;
  status: string;
  source: string;
  q: string;
  sortBy: 'score' | 'date';
}

/**
 * The lead-scoring screen's rows, scored and filtered by the database.
 *
 * The screen renders fifty rows and used to download all 26,878 leads to choose
 * them, because the score it sorts by was computed per lead in the browser. The
 * same formula in SQL — checked bucket by bucket against the JavaScript original
 * on production — makes the sort, the filters and the histogram queries.
 *
 * Every filter change re-queries. That is a request per keystroke in the search
 * box, so the query is debounced; the sequence guard then drops any reply that
 * is no longer the newest, which matters more than the debounce because a slow
 * response for "ah" must not overwrite the results for "ahmed".
 */
export function useScoredLeads(query: ScoredLeadsQuery): ScoredLeadsResult | null {
  const [result, setResult] = useState<ScoredLeadsResult | null>(null);
  const seqRef = useRef(0);
  const { minScore, status, source, q, sortBy } = query;

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = await mysqlAdmin.getScoredLeads({ minScore, status, source, q, sortBy });
          if (cancelled || seq !== seqRef.current) return;
          setResult(data);
        } catch {
          // Leaves the last good result on screen rather than blanking it; the
          // screen falls back to its own array only while nothing has arrived.
          if (cancelled || seq !== seqRef.current) return;
          setResult(current => current);
        }
      })();
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [minScore, status, source, q, sortBy]);

  return result;
}
