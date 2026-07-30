import { useEffect, useState } from 'react';
import type { Currency } from '../../types';
import { mysqlCatalog } from '../../lib/mysqlapi';

/** Server-owned location context; customer browsers never choose their own price currency. */
export function useCurrency() {
  const [currency, setCurrencyState] = useState<Currency>('USD');

  useEffect(() => {
    localStorage.removeItem('mahad-currency');
    let cancelled = false;
    mysqlCatalog.getClientContext()
      .then(value => { if (!cancelled) setCurrencyState(value.currency); })
      .catch(() => { /* keep fail-safe USD display; checkout itself fails closed */ });
    return () => { cancelled = true; };
  }, []);

  // Kept for the existing context contract only. Customer pricing is
  // server-owned and cannot be overridden from browser UI or stored state.
  const setCurrency = (_currency: Currency) => {};

  return { currency, setCurrency };
}
