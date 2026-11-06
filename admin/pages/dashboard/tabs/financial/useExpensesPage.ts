import { useCallback, useEffect, useRef, useState } from 'react';
import { mysqlAdmin, type ExpensesPage } from '../../../../lib/mysqlapi';
import type { ExpenseItem } from '../../../../types';

const STEP = 100;
const EXPORT_STEP = 500;
const EXPORT_CEILING = 5000; // the same ceiling the whole list always had

interface Params {
  /** 'daqqi' | 'tagamoa' for a branch's books, nothing for the main books. */
  branch?: string;
  category: string;
  from: string;
  to: string;
  /** Only the screens that show the expenses or their category split ask. */
  enabled: boolean;
  /** How many rows the screen draws: the expenses list wants a page, the category cards only the figures. */
  pageSize: number;
}

/**
 * The expenses a screen shows, from the server a page at a time (6 Nov 2026), and the figures over ALL of them — the count and the per-currency total of the current
 * filter, and the category split of the whole scope. The screen used to download every expense (up to 5,000) and add them up here; now the totals are the database's,
 * the rows are a page, «عرض ١٠٠ كمان» asks for the next, and the exports (which are of every row) ask for them all when they are clicked.
 */
export function useExpensesPage({ branch, category, from, to, enabled, pageSize }: Params) {
  const [rows, setRows] = useState<ExpenseItem[]>([]);
  const [figures, setFigures] = useState<Pick<ExpensesPage, 'total' | 'filteredTotals' | 'byCategory'>>({ total: 0, filteredTotals: [], byCategory: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const asked = useRef(0);
  const server = branch ? branch.toUpperCase() : undefined;

  const first = useCallback(async (limit: number) => {
    const ticket = ++asked.current;
    setLoading(true);
    try {
      const page = await mysqlAdmin.getExpensesPage({ limit, offset: 0, category, from, to, branch: server });
      if (ticket !== asked.current) return;
      setRows(page.rows as unknown as ExpenseItem[]);
      setFigures({ total: page.total, filteredTotals: page.filteredTotals, byCategory: page.byCategory });
      setError('');
    } catch (failure) {
      if (ticket === asked.current) setError(failure instanceof Error ? failure.message : 'تعذر تحميل المصروفات');
    } finally {
      if (ticket === asked.current) setLoading(false);
    }
  }, [category, from, to, server]);

  // a different filter, branch or page size starts again from the first page
  useEffect(() => {
    if (!enabled) return;
    void first(pageSize);
  }, [enabled, first, pageSize]);

  const more = useCallback(async () => {
    const ticket = asked.current;
    const page = await mysqlAdmin.getExpensesPage({ limit: STEP, offset: rows.length, category, from, to, branch: server });
    if (ticket !== asked.current) return;
    setRows(current => [...current, ...(page.rows as unknown as ExpenseItem[])]);
    setFigures({ total: page.total, filteredTotals: page.filteredTotals, byCategory: page.byCategory });
  }, [rows.length, category, from, to, server]);

  /** After a save or a delete: the same rows again, from the server (as many as were on screen). */
  const reload = useCallback(() => first(Math.min(Math.max(rows.length, pageSize), EXPORT_STEP)), [first, rows.length, pageSize]);

  /** Every expense that matches the filter — or, with `wholeScope`, every expense of the books whatever the filter — for an export. */
  const all = useCallback(async (wholeScope = false): Promise<ExpenseItem[]> => {
    const filters = wholeScope ? {} : { category, from, to };
    const collected: ExpenseItem[] = [];
    while (collected.length < EXPORT_CEILING) {
      const page = await mysqlAdmin.getExpensesPage({ limit: EXPORT_STEP, offset: collected.length, ...filters, branch: server });
      collected.push(...(page.rows as unknown as ExpenseItem[]));
      if (page.rows.length < EXPORT_STEP || collected.length >= page.total) break;
    }
    return collected;
  }, [category, from, to, server]);

  return { rows, ...figures, loading, error, more, reload, all };
}
