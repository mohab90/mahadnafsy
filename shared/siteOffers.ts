/**
 * The site's two marketing surfaces — the home page's timed offer and the
 * pop-up shown to every visitor — read from the same place the marketing team
 * writes to (التسويق ← الخصومات), so the maths lives here once.
 *
 * Everything is a plain key in the site content, which is how the rest of the
 * site's copy is stored: no new table, and an edit reaches the site with the
 * next content refresh.
 *
 *   offer.enabled        '0' hides the offer section; anything else shows it
 *   offer.durationHours  how long the countdown runs once started (default 24)
 *   offer.timerStartedAt ISO instant «ابدأ العداد» wrote; empty = no countdown
 *   offer.courseId       the course the offer is on (empty = typed prices)
 *   offer.price.<CUR>    the offer's own price in EGP / SAR / USD; blank = the
 *                        course's price in the visitor's currency
 *   home.offer.discountPercent  draws the struck-out price
 *
 *   popup.enabled '1' · popup.title · popup.body · popup.discountPercent
 *   popup.code · popup.courseId · popup.ctaText · popup.ctaLink
 *   popup.endsAt (ISO instant, blank = until switched off)
 *   popup.frequency  once | daily | session | always
 *   popup.delaySeconds · popup.theme · popup.version (bumped on every save so
 *   a changed pop-up is shown again to people who closed the old one)
 */
export type OfferContent = Record<string, string | undefined>;
export type OfferCurrency = 'EGP' | 'SAR' | 'USD';

export const OFFER_DEFAULT_HOURS = 24;
export const OFFER_MAX_HOURS = 24 * 30;
export const POPUP_FREQUENCIES = ['once', 'daily', 'session', 'always'] as const;
export type PopupFrequency = (typeof POPUP_FREQUENCIES)[number];
export const POPUP_THEMES = ['royal', 'sunset', 'emerald'] as const;
export type PopupTheme = (typeof POPUP_THEMES)[number];

const num = (value: unknown): number => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

export function offerEnabled(content: OfferContent): boolean {
  return content['offer.enabled'] !== '0';
}

export function offerHours(content: OfferContent): number {
  const hours = num(content['offer.durationHours']);
  if (hours <= 0) return OFFER_DEFAULT_HOURS;
  return Math.min(OFFER_MAX_HOURS, Math.round(hours));
}

/** Milliseconds left on the countdown, or null when nobody started one. */
export function offerRemainingMs(content: OfferContent, now: number = Date.now()): number | null {
  const startedAt = String(content['offer.timerStartedAt'] || '');
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, offerHours(content) * 3600_000 - (now - start));
}

/** A countdown that was started and has run out. */
export function offerIsOver(content: OfferContent, now: number = Date.now()): boolean {
  return offerRemainingMs(content, now) === 0;
}

/** The offer is on the home page: switched on, and its countdown (if any) has not run out. */
export function offerIsShown(content: OfferContent, now: number = Date.now()): boolean {
  return offerEnabled(content) && !offerIsOver(content, now);
}

export function offerDiscountPercent(content: OfferContent): number {
  const pct = num(content['home.offer.discountPercent'] ?? 45);
  return pct > 0 && pct < 100 ? pct : 0;
}

/**
 * What the visitor is shown. The offer's own price wins over the course's
 * when the marketing team typed one; the struck-out price is that price
 * lifted by the discount. null = nothing numeric to show (the typed text
 * fields take over, as they always have).
 */
export function offerPrices(
  content: OfferContent,
  course: { price?: Partial<Record<OfferCurrency, number>> } | null | undefined,
  currency: OfferCurrency,
): { oldPrice: number; newPrice: number } | null {
  const own = num(content[`offer.price.${currency}`]);
  const newPrice = own > 0 ? own : num(course?.price?.[currency]);
  if (newPrice <= 0) return null;
  const pct = offerDiscountPercent(content);
  const oldPrice = pct ? Math.round(newPrice / (1 - pct / 100)) : newPrice;
  return { oldPrice, newPrice };
}

export function popupFrequency(content: OfferContent): PopupFrequency {
  const value = String(content['popup.frequency'] || '');
  return (POPUP_FREQUENCIES as readonly string[]).includes(value) ? (value as PopupFrequency) : 'daily';
}

export function popupTheme(content: OfferContent): PopupTheme {
  const value = String(content['popup.theme'] || '');
  return (POPUP_THEMES as readonly string[]).includes(value) ? (value as PopupTheme) : 'royal';
}

/** The pop-up is switched on, has something to say, and its end (if any) has not passed. */
export function popupIsLive(content: OfferContent, now: number = Date.now()): boolean {
  if (content['popup.enabled'] !== '1') return false;
  if (!String(content['popup.title'] || '').trim() && !num(content['popup.discountPercent'])) return false;
  const endsAt = String(content['popup.endsAt'] || '');
  if (endsAt) {
    const end = new Date(endsAt).getTime();
    if (Number.isFinite(end) && end <= now) return false;
  }
  return true;
}

/**
 * Has this visitor already seen this version of the pop-up, as often as the
 * frequency allows? `seen` is what the browser remembered: when (ms) and
 * which version.
 */
export function popupWasSeen(
  content: OfferContent,
  seen: { at: number; version: string } | null,
  now: number = Date.now(),
): boolean {
  const frequency = popupFrequency(content);
  if (frequency === 'always' || !seen) return false;
  if (seen.version !== String(content['popup.version'] || '')) return false;
  if (frequency === 'once') return true;
  if (frequency === 'session') return true; // read from sessionStorage, so any record is this session's
  return now - seen.at < 24 * 3600_000;
}
