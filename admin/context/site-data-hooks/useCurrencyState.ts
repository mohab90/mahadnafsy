import { useState, useEffect } from 'react';
import type { Currency } from '../../types';

// Currency: respects localStorage override, otherwise auto-detects by country via IP geolocation.
export function useCurrencyState() {
  const [currency, setCurrencyState] = useState<Currency>('USD');

  useEffect(() => {
    const stored = localStorage.getItem('mahad-currency') as Currency | null;
    if (stored && ['EGP', 'SAR', 'USD'].includes(stored)) {
      setCurrencyState(stored);
      return;
    }
    const countryToCurrency = (country?: string): Currency => {
      if (country === 'EG') return 'EGP';
      if (country === 'SA') return 'SAR';
      return 'USD';
    };
    const withTimeout = (url: string, ms = 4000) =>
      Promise.race([fetch(url), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]) as Promise<Response>;

    // Primary: api.country.is
    withTimeout('https://api.country.is/')
      .then(r => r.json())
      .then((d: { country?: string }) => { setCurrencyState(countryToCurrency(d.country)); })
      .catch(() =>
        // Fallback 1: ipapi.co
        withTimeout('https://ipapi.co/json/')
          .then(r => r.json())
          .then((d: { country_code?: string }) => { setCurrencyState(countryToCurrency(d.country_code)); })
          .catch(() =>
            // Fallback 2: ipinfo.io
            withTimeout('https://ipinfo.io/json?token=')
              .then(r => r.json())
              .then((d: { country?: string }) => { setCurrencyState(countryToCurrency(d.country)); })
              .catch(() => { setCurrencyState('USD'); })
          )
      );
  }, []);

  const setCurrency = (c: Currency) => {
    localStorage.setItem('mahad-currency', c);
    setCurrencyState(c);
  };

  return { currency, setCurrency };
}
