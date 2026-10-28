// Where this visit came from: the ad parameters of its first page.
//
// A visitor lands on /?utm_source=facebook&utm_campaign=…&fbclid=…, clicks to a
// course, and fills the form three pages later — by then the parameters were
// gone from the address bar and nothing had kept them, so every lead read the
// same «الموقع». They are kept here for the visit (sessionStorage), and in a
// session cookie the API reads with every lead form, sign-up and order
// (api/lib/visitAttribution.js). The first landing of the visit wins: moving
// between pages does not overwrite it.

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'] as const;
type Key = typeof KEYS[number];
export type VisitAttribution = Partial<Record<Key, string>>;

const STORE_KEY = 'mahad-visit-attribution';
const COOKIE = 'mahad_attr';

function fromUrl(search: string): VisitAttribution {
  const params = new URLSearchParams(search);
  const found: VisitAttribution = {};
  for (const key of KEYS) {
    const value = (params.get(key) || '').trim().slice(0, key === 'fbclid' || key === 'gclid' ? 255 : 200);
    if (value) found[key] = value;
  }
  return found;
}

function writeCookie(value: VisitAttribution) {
  try {
    // A session cookie: it ends with the visit, as the stored copy does.
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(value))}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch { /* cookies off: the stored copy still travels in request bodies that send it */ }
}

/** The visit's attribution, {} when it came from nowhere in particular. */
export function visitAttribution(): VisitAttribution {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    return stored && typeof stored === 'object' ? stored as VisitAttribution : {};
  } catch { return {}; }
}

/** Run once on load: keeps the landing page's parameters for the rest of the visit. */
export function captureAttribution(search: string = window.location.search): void {
  const kept = visitAttribution();
  if (Object.keys(kept).length) { writeCookie(kept); return; }
  const found = fromUrl(search);
  if (!Object.keys(found).length) return;
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(found)); } catch { /* private mode: the cookie still carries it */ }
  writeCookie(found);
}
