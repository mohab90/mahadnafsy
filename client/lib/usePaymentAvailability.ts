import { useEffect, useState } from 'react';

// Whether the payment gateway can actually take a card right now, answered by
// the server. Three customer-facing screens used to state "الدفع الإلكتروني
// متوقف مؤقتاً" as a hardcoded fact, which stayed on the page after the gateway
// was configured and told every visitor not to try paying.
//
// Returns null while unknown, so a caller can render neither claim until the
// answer is in. Anything other than a clear yes resolves to false: being
// wrongly told to use bank transfer costs a little friction, while being
// wrongly offered a card that cannot be charged costs the order.

// One request per page load no matter how many components ask, and the answer
// is reused for the rest of the session — gateway state does not change between
// two components rendering.
let cached: Promise<boolean> | null = null;

const fetchAvailability = (): Promise<boolean> => {
  if (!cached) {
    cached = fetch('/api/public/payment-availability')
      .then(r => (r.ok ? r.json() : { online: false }))
      .then(d => Boolean(d?.online))
      .catch(() => false);
  }
  return cached;
};

export function usePaymentAvailability(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAvailability().then(value => { if (!cancelled) setOnline(value); });
    return () => { cancelled = true; };
  }, []);
  return online;
}
