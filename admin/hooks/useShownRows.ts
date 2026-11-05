import { useEffect, useState } from 'react';

/**
 * A long list drawn in steps (6 Nov 2026): the first `step` rows, and a button for `step` more. The الفلوس الخارجة table drew every expense the server sent (up to 5,000) —
 * about 200,000 characters of markup that the browser built before showing anything — and the orders table stopped at row 300 with no way to see the rest. The totals and
 * the CSV are computed from the whole list by the caller, as before; only what is drawn is stepped. Back to the first step when the list itself changes (another
 * filter, another count), not when it merely renders again.
 */
export function useShownRows<T>(rows: T[], step = 100): { shown: T[]; hidden: number; more: () => void; all: () => void } {
  const [count, setCount] = useState(step);
  const signature = `${rows.length}:${(rows[0] as { id?: string } | undefined)?.id ?? ''}:${(rows[rows.length - 1] as { id?: string } | undefined)?.id ?? ''}`;
  useEffect(() => { setCount(step); }, [signature, step]);
  return {
    shown: rows.length > count ? rows.slice(0, count) : rows,
    hidden: Math.max(0, rows.length - count),
    more: () => setCount(current => current + step),
    all: () => setCount(rows.length),
  };
}
