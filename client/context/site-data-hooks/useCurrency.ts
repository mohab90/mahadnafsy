import { useEffect, useState } from 'react';
import type { Currency } from '../../types';
import { mysqlCatalog } from '../../lib/mysqlapi';

// What the server last told this browser, kept only so the page does not open in
// dollars for an Egyptian or Saudi visitor while the location is being checked,
// and does not flip to dollars if one check fails. It is a display hint: the
// server answers again on every visit and always wins, and checkout prices
// are the server's own — never this value.
const HINT_KEY = 'mahad-display-currency';
const HINT_MAX_AGE_MS = 7 * 24 * 3600_000;
const RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

const isCurrency = (value: unknown): value is Currency => value === 'EGP' || value === 'SAR' || value === 'USD';

const readHint = (): Currency => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HINT_KEY) || 'null') as { currency?: unknown; at?: number } | null;
    if (parsed && isCurrency(parsed.currency) && Date.now() - Number(parsed.at || 0) < HINT_MAX_AGE_MS) return parsed.currency;
  } catch { /* unreadable storage: fall through to the fail-safe */ }
  return 'USD';
};
const writeHint = (currency: Currency) => {
  try { localStorage.setItem(HINT_KEY, JSON.stringify({ currency, at: Date.now() })); } catch { /* private window */ }
};

/** Server-owned location context; customer browsers never choose their own price currency. */
export function useCurrency() {
  const [currency, setCurrencyState] = useState<Currency>(readHint);

  useEffect(() => {
    try { localStorage.removeItem('mahad-currency'); } catch { /* ignore */ }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (attempt: number) => {
      mysqlCatalog.getClientContext()
        .then(value => {
          if (cancelled || !isCurrency(value.currency)) return;
          setCurrencyState(value.currency);
          writeHint(value.currency);
        })
        .catch(() => {
          // A provider hiccup is not an answer: ask again shortly instead of
          // leaving the visitor on whatever was guessed. Checkout itself fails closed.
          if (cancelled || attempt >= RETRY_DELAYS_MS.length) return;
          timer = setTimeout(() => ask(attempt + 1), RETRY_DELAYS_MS[attempt]);
        });
    };
    ask(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // Kept for the existing context contract only. Customer pricing is
  // server-owned and cannot be overridden from browser UI or stored state.
  const setCurrency = (_currency: Currency) => {};

  return { currency, setCurrency };
}
