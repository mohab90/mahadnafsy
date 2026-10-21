import { useEffect, useState } from 'react';
import type { Currency } from '../types';

// The price of a course or path as the server charges it (api/lib/effectivePrice.js):
// the catalogue price less the marketing discount running on it. Every page that
// shows a price reads it from here, so the course page, the card, the home page,
// the pop-up and checkout cannot disagree again — they did, and a customer read
// 2,800 on one page and was asked for 3,600 at the end.
//
// The pay mode (cash / instalment) and a promo code go on top at checkout, by
// POST /api/public/price-quote.

export type PriceDiscount = { source: string; percent: number | null; label: string; expiresAt: string | null; code?: string | null };
type Entry = { base: number; price: number; discount: PriceDiscount | null };
type PriceList = Record<string, Partial<Record<Currency, Entry>>>;

// One request per page load, shared by every component; refreshed after a few
// minutes so a long visit sees an offer end.
let cached: { at: number; list: Promise<PriceList> } | null = null;
const TTL_MS = 5 * 60 * 1000;

const fetchPrices = (): Promise<PriceList> => {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const list = fetch('/api/public/prices')
      .then(r => (r.ok ? r.json() : {}))
      .then((d: { items?: PriceList }) => (d && typeof d.items === 'object' && d.items ? d.items : {}))
      .catch(() => ({} as PriceList));
    cached = { at: Date.now(), list };
  }
  return cached.list;
};

/** The whole list — {} until it has loaded. */
export function usePriceList(): PriceList {
  const [list, setList] = useState<PriceList>({});
  useEffect(() => {
    let alive = true;
    void fetchPrices().then(l => { if (alive) setList(l); });
    return () => { alive = false; };
  }, []);
  return list;
}

export type EffectivePrice = { base: number; price: number; discount: PriceDiscount | null; loaded: boolean };

/**
 * One item's price in one currency. Until the list has loaded (or for an item
 * it does not carry) it is the catalogue price the page already has.
 */
export function effectivePrice(list: PriceList, kind: 'course' | 'bundle', id: string | undefined | null, currency: Currency, catalogue: number): EffectivePrice {
  const entry = id ? list[`${kind}:${id}`]?.[currency] : undefined;
  if (entry && entry.price > 0) return { base: entry.base, price: entry.price, discount: entry.discount, loaded: true };
  return { base: catalogue, price: catalogue, discount: null, loaded: false };
}

/** The struck-out price to show beside it: the catalogue's «was» price, or the base when a discount took it lower. */
export function wasPrice(effective: EffectivePrice, originalPrice: number): number {
  return Math.max(Number(originalPrice) || 0, effective.price < effective.base ? effective.base : 0);
}

type Priced = { id: string; price: Partial<Record<Currency, number>>; originalPrice?: Partial<Record<Currency, number>> };

/** A course or path with its prices as checkout charges them, for screens that read `price` / `originalPrice` directly. */
export function withEffectivePrices<T extends Priced>(list: PriceList, kind: 'course' | 'bundle', item: T): T {
  const entry = list[`${kind}:${item.id}`];
  if (!entry) return item;
  const price = { ...item.price };
  const originalPrice = { ...(item.originalPrice || {}) };
  for (const currency of Object.keys(entry) as Currency[]) {
    const effective = effectivePrice(list, kind, item.id, currency, Number(item.price?.[currency]) || 0);
    if (!effective.loaded) continue;
    price[currency] = effective.price;
    originalPrice[currency] = wasPrice(effective, Number(item.originalPrice?.[currency]) || 0);
  }
  return { ...item, price, originalPrice } as T;
}
