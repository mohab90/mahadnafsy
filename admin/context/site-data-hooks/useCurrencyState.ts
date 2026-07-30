import { useState, useEffect } from 'react';
import type { Currency } from '../../types';

// Admin-only reporting preference. Customer pricing uses the server-owned geo context.
export function useCurrencyState() {
  const [currency, setCurrencyState] = useState<Currency>('EGP');

  useEffect(() => {
    const stored = localStorage.getItem('mahad-admin-currency') as Currency | null;
    if (stored && ['EGP', 'SAR', 'USD'].includes(stored)) {
      setCurrencyState(stored);
      return;
    }
    setCurrencyState('EGP');
  }, []);

  const setCurrency = (c: Currency) => {
    localStorage.setItem('mahad-admin-currency', c);
    setCurrencyState(c);
  };

  return { currency, setCurrency };
}
