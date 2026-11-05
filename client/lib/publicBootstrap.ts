/**
 * What every page of the site starts with — texts, courses, tracks, therapists, testimonials, prices and whether online payment is on — in ONE request
 * (GET /api/public/bootstrap) instead of seven. Each piece is null when the server could not answer it, and so is the whole when the request fails: whoever
 * reads a piece asks that piece's own route then, so a failure costs what it always did and nothing more.
 * Shared by the catalog loader and the two hooks that used to ask for their own piece; a failed answer is not kept.
 */

export type PublicBootstrap = {
  content: Record<string, string> | null;
  courses: unknown[] | null;
  bundles: unknown[] | null;
  therapists: unknown[] | null;
  testimonials: unknown[] | null;
  prices: { items?: Record<string, unknown> } | null;
  paymentAvailability: { online?: unknown; manualMethods?: unknown } | null;
};

// The server lets the browser keep it 30 seconds (the texts' own age); the page does the same, so a long visit asks again.
const TTL_MS = 30 * 1000;
let current: { at: number; answer: Promise<PublicBootstrap | null> } | null = null;

export function loadPublicBootstrap(fresh = false): Promise<PublicBootstrap | null> {
  if (fresh || !current || Date.now() - current.at > TTL_MS) {
    const answer = fetch('/api/public/bootstrap')
      .then(response => (response.ok ? (response.json() as Promise<PublicBootstrap>) : null))
      .catch(() => null);
    const entry = { at: Date.now(), answer };
    current = entry;
    void answer.then(value => { if (!value && current === entry) current = null; });
  }
  return current!.answer;
}
