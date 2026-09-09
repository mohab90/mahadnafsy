import { useEffect, useState } from 'react';
import { DEFAULT_PAYMENT_METHODS, sanitizePaymentMethods, type PaymentMethodCode } from '../../shared/paymentMethods';

// Whether the payment gateway can actually take a card right now, answered by
// the server. Three customer-facing screens used to state "الدفع الإلكتروني
// متوقف مؤقتاً" as a hardcoded fact, which stayed on the page after the gateway
// was configured and told every visitor not to try paying.
//
// Returns null while unknown, so a caller can render neither claim until the
// answer is in. Anything other than a clear yes resolves to false: being
// wrongly told to use bank transfer costs a little friction, while being
// wrongly offered a card that cannot be charged costs the order.
//
// The same answer also carries which manual channels the institute takes, for
// the two screens where a customer says how they transferred. Both used to
// hardcode that list — one in Arabic, one in codes — so the admin setting was
// unreachable from the customer's side entirely.

export type PaymentAvailability = {
  online: boolean;
  manualMethods: PaymentMethodCode[];
};

// One request per page load no matter how many components ask, and the answer
// is reused for the rest of the session — gateway state does not change between
// two components rendering.
let cached: Promise<PaymentAvailability> | null = null;

// A failed lookup must not empty the method picker: the transfer route is the
// one that always works, and a customer who cannot name their channel cannot
// submit a receipt at all.
const FALLBACK: PaymentAvailability = { online: false, manualMethods: DEFAULT_PAYMENT_METHODS };

const fetchAvailability = (): Promise<PaymentAvailability> => {
  if (!cached) {
    cached = fetch('/api/public/payment-availability')
      .then(r => (r.ok ? r.json() : {}))
      .then((d: { online?: unknown; manualMethods?: unknown }) => {
        const methods = sanitizePaymentMethods(d?.manualMethods);
        return {
          online: Boolean(d?.online),
          manualMethods: methods.length ? methods : DEFAULT_PAYMENT_METHODS,
        };
      })
      .catch(() => FALLBACK);
  }
  return cached;
};

/** Cards, yes or no — null until the server has answered. */
export function usePaymentAvailability(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAvailability().then(value => { if (!cancelled) setOnline(value.online); });
    return () => { cancelled = true; };
  }, []);
  return online;
}

/**
 * The manual channels the admin has enabled.
 *
 * Never empty: it starts on the defaults and is replaced once the server
 * answers, so a method picker is usable on first paint and does not flicker
 * from blank to populated.
 */
export function useManualPaymentMethods(): PaymentMethodCode[] {
  const [methods, setMethods] = useState<PaymentMethodCode[]>(DEFAULT_PAYMENT_METHODS);
  useEffect(() => {
    let cancelled = false;
    fetchAvailability().then(value => { if (!cancelled) setMethods(value.manualMethods); });
    return () => { cancelled = true; };
  }, []);
  return methods;
}
