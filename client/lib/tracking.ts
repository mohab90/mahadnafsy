// ══════════════════════════════════════════════════════════════
// lib/tracking.ts — the Meta pixel and Google Analytics, past the first page
// ══════════════════════════════════════════════════════════════
//
// «تتبّع الإعلانات صح» (11 Oct 2026). index.html loads both tags and they sent
// one PageView, for whatever page the visitor landed on, and nothing after it:
// a single-page app never reloads, so every page after the first went unseen,
// and no form sent, checkout begun or card payment told the ads anything. The
// campaigns were being optimised on visits.
//
// Lead and Purchase are also sent by the server (api/lib/metaCapi.js), so an
// ad blocker or a tab closed on the payment page does not lose them. Both
// copies carry one event id and Meta counts the pair once:
//   • a lead form sends the id it is about to fire with as X-Event-Id
//     (leadHeaders, used by lib/mysqlapi.ts), then fires with it (trackLead);
//   • a purchase is «purchase-<order id>» on both sides.
//
// Consent: the site has no cookie banner. Global Privacy Control is honoured,
// and so is «denied» under CONSENT_KEY, which is where a banner would put it;
// the server is told through X-Ad-Consent and sends nothing either.

type Tag = (...args: unknown[]) => void;
type TrackedWindow = Window & { fbq?: Tag; gtag?: Tag };

const CONSENT_KEY = 'mahad-ad-consent';
const ORDER_KEY = 'mahad-checkout-order';
const SENT_KEY = 'mahad-purchase-sent';

export function adConsentDenied(): boolean {
  try {
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return true;
  } catch { /* no navigator */ }
  try { return localStorage.getItem(CONSENT_KEY) === 'denied'; } catch { return false; }
}

const newEventId = (): string => {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* insecure context */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

// A tag that failed to load, or a blocker that stubbed it badly, must never
// break the page that called it.
function fbq(...args: unknown[]): void {
  if (adConsentDenied()) return;
  try { (window as TrackedWindow).fbq?.(...args); } catch { /* tag unavailable */ }
}
function gtag(...args: unknown[]): void {
  if (adConsentDenied()) return;
  try { (window as TrackedWindow).gtag?.(...args); } catch { /* tag unavailable */ }
}

let lastPage = '';

/** Every route the app shows, the first one included (index.html no longer sends it). */
export function trackPageView(path: string): void {
  if (!path || path === lastPage) return;
  lastPage = path;
  fbq('track', 'PageView');
  gtag('event', 'page_view', { page_path: path, page_location: window.location.href });
}

// ── Lead ─────────────────────────────────────────────────────────────────────
let pendingLeadId = newEventId();

/** Headers a lead form posts with, so the server's Lead carries the same id. */
export function leadHeaders(): Record<string, string> {
  return adConsentDenied() ? { 'X-Ad-Consent': 'denied' } : { 'X-Event-Id': pendingLeadId };
}

/** A lead, contact or registration form went through. */
export function trackLead(details: { source?: string; contentName?: string } = {}): void {
  const eventID = pendingLeadId;
  pendingLeadId = newEventId();
  fbq('track', 'Lead', {
    ...(details.contentName ? { content_name: details.contentName } : {}),
    ...(details.source ? { content_category: details.source } : {}),
  }, { eventID });
  gtag('event', 'generate_lead', { ...(details.source ? { lead_source: details.source } : {}) });
}

/** A new account. Browser only — the server's copy is the Lead its sign-up files. */
export function trackCompleteRegistration(): void {
  fbq('track', 'CompleteRegistration', {}, { eventID: newEventId() });
  gtag('event', 'sign_up');
}

// ── Checkout and purchase ────────────────────────────────────────────────────
export type CheckoutItem = { id: string; type: string; title: string; value: number; currency: string };

export function trackInitiateCheckout(item: CheckoutItem): void {
  fbq('track', 'InitiateCheckout', {
    value: item.value, currency: item.currency, content_ids: [item.id], content_type: 'product',
    content_name: item.title, content_category: item.type, num_items: 1,
  }, { eventID: newEventId() });
  gtag('event', 'begin_checkout', {
    value: item.value, currency: item.currency,
    items: [{ item_id: item.id, item_name: item.title, item_category: item.type, price: item.value, quantity: 1 }],
  });
}

/** Must stay what api/lib/metaCapi.js purchaseEventId gives. */
export const purchaseEventId = (orderId: string): string => `purchase-${orderId}`;

type RememberedOrder = { orderId: string; value: number; currency: string; itemId: string; title: string };

/**
 * The order the checkout just priced, kept for the page Paymob sends the
 * customer back to: the redirect carries the EGP it charged, not the price in
 * the customer's own currency the server's Purchase reports.
 */
export function rememberCheckoutOrder(order: RememberedOrder): void {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* storage unavailable */ }
}

/** What Paymob's redirect to /success says was paid, matched to the remembered order. */
export function purchaseFromReturn(params: URLSearchParams): RememberedOrder | null {
  // The merchant order id is «<order>~<attempt>» (api/lib/paymobGateway.js).
  const orderId = String(params.get('merchant_order_id') || '').split('~')[0].trim();
  if (!orderId) return null;
  let remembered: RememberedOrder | null = null;
  try { remembered = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); } catch { remembered = null; }
  if (remembered?.orderId === orderId && remembered.value > 0) return remembered;
  const value = Number(params.get('amount_cents')) / 100;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { orderId, value, currency: String(params.get('currency') || 'EGP').toUpperCase(), itemId: '', title: '' };
}

/** A card payment went through. Once per order, however often /success is reloaded. */
export function trackPurchase(order: RememberedOrder): void {
  try {
    const sent: string[] = JSON.parse(localStorage.getItem(SENT_KEY) || '[]');
    if (sent.includes(order.orderId)) return;
    localStorage.setItem(SENT_KEY, JSON.stringify([...sent, order.orderId].slice(-20)));
    localStorage.removeItem(ORDER_KEY);
  } catch { /* storage unavailable: Meta still drops the repeat by its id */ }
  fbq('track', 'Purchase', {
    value: order.value, currency: order.currency, content_type: 'product',
    ...(order.itemId ? { content_ids: [order.itemId] } : {}),
    ...(order.title ? { content_name: order.title } : {}),
  }, { eventID: purchaseEventId(order.orderId) });
  gtag('event', 'purchase', {
    transaction_id: order.orderId, value: order.value, currency: order.currency,
    ...(order.itemId ? { items: [{ item_id: order.itemId, item_name: order.title, price: order.value, quantity: 1 }] } : {}),
  });
}
