import { useMemo } from 'react';
import { useStaticData } from '../context/siteDataSlices';

// «في صفحه اعدادات الشهادات واسعارها هنخلي كمان فيها سعر الكارنيه وسعر الكتب
// اقدر اضيف اكتر من كارنيه واكتر من كتاب» (9 Oct 2026). The carnets and books on
// offer, beside the certificates' prices (content `extra_item_pricing`). Picking
// one in the payment form names the payment after it, so the request lands in
// «طلبات إضافية» with its name (api/routes/certificates.js extra-requests).
export type ExtraItem = { id: string; label: string; priceEGP: number; priceSAR: number; priceUSD: number };
export type ExtraItemKind = 'carnets' | 'books';
export type ExtraItemsMap = Record<ExtraItemKind, ExtraItem[]>;

export const EXTRA_ITEMS_KEY = 'extra_item_pricing';
export const EXTRA_KIND_LABEL: Record<ExtraItemKind, string> = { carnets: 'الكارنيهات', books: 'الكتب' };

export function parseExtraItems(raw: string | undefined | null): ExtraItemsMap {
  try {
    const parsed = JSON.parse(raw || '{}') || {};
    const list = (value: unknown): ExtraItem[] => (Array.isArray(value) ? value : [])
      .filter(item => item && String(item.label || '').trim())
      .map(item => ({ id: String(item.id || item.label), label: String(item.label).trim(), priceEGP: Number(item.priceEGP) || 0, priceSAR: Number(item.priceSAR) || 0, priceUSD: Number(item.priceUSD) || 0 }));
    return { carnets: list(parsed.carnets), books: list(parsed.books) };
  } catch { return { carnets: [], books: [] }; }
}

/** The item's price in the payment's currency, 0 when it has none. */
export const priceIn = (item: ExtraItem, currency: string) =>
  (currency === 'SAR' ? item.priceSAR : currency === 'USD' ? item.priceUSD : item.priceEGP) || 0;

export function useExtraItemsCatalog(): ExtraItemsMap {
  const { content } = useStaticData();
  return useMemo(() => parseExtraItems(content[EXTRA_ITEMS_KEY]), [content]);
}
