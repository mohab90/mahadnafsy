import { useEffect, useState } from 'react';
import { adminAuthHeaders } from './adminAuthHeaders';

// The institute's payment methods / cash boxes.
//
// One reader for one setting. Five screens each parsed
// content['finance.payment_methods'] themselves and each carried its own
// different fallback list, so before the key was ever saved the booking dialog
// offered one set, the Daqqi dialogs another, the financial tab a third and the
// settings page a fourth — which is what "the right ones from settings do not
// show up" was.
//
// الإعدادات ← وسائل الدفع owns the value; everything else reads it through here.

export const DEFAULT_PAYMENT_METHODS = [
  'خزنة الدقي',
  'خزنة الفرع',
  'فودافون كاش',
  'انستا باي',
  'تحويل بنكي',
  'كاش',
  'أخرى',
];

/** Parse the stored `a||b||c` string, falling back to the shared default list. */
export function parsePaymentMethods(raw: string | undefined | null): string[] {
  const parsed = String(raw || '')
    .split('||')
    .map(s => s.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_PAYMENT_METHODS;
}

/**
 * Configured boxes first, then any box with money against it that the settings
 * list does not mention.
 *
 * The settings list is the admin's intent; the second half is what the desk has
 * been doing. A box drops out of the offer only when it is both unconfigured
 * and has never taken a payment.
 */
export function mergePaymentBoxes(configured: string[], inUse: string[]): string[] {
  const seen = new Set(configured.map(box => box.trim()).filter(Boolean));
  const out = [...seen];
  for (const box of inUse) {
    const name = String(box || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The list the payment dialog offers.
 *
 * One request per session, not per dialog: the dialog is now the only one in
 * the system and it opens from eleven places, so a fetch on every open would
 * be eleven times the traffic for a list that changes when an admin edits a
 * setting. A failure is silent and leaves the configured list — the desk can
 * still record a payment, just into fewer boxes.
 */
let boxesInUse: string[] | null = null;
let boxesPending: Promise<string[]> | null = null;

async function loadBoxesInUse(): Promise<string[]> {
  if (boxesInUse) return boxesInUse;
  if (!boxesPending) {
    boxesPending = fetch('/api/admin/payment-boxes', { credentials: 'include', headers: adminAuthHeaders() })
      .then(response => (response.ok ? response.json() : []))
      .then((rows: { box?: string }[]) => (Array.isArray(rows) ? rows.map(row => String(row.box || '')) : []))
      .catch(() => [])
      .then(list => { boxesInUse = list; boxesPending = null; return list; });
  }
  return boxesPending;
}

export function usePaymentBoxes(configuredRaw: string | undefined | null): string[] {
  const configured = parsePaymentMethods(configuredRaw);
  const [inUse, setInUse] = useState<string[]>(boxesInUse || []);

  useEffect(() => {
    let alive = true;
    void loadBoxesInUse().then(list => { if (alive) setInUse(list); });
    return () => { alive = false; };
  }, []);

  return mergePaymentBoxes(configured, inUse);
}
