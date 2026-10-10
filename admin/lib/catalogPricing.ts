// A course's or track's price at each branch, its discount prices and its
// booking bonuses — the browser side of api/lib/priceTiers.js.
import { mysqlAdmin } from './mysqlapi';

export type PriceTierKey = 'DAQQI' | 'DAQQI_FOREIGN' | 'TAGAMOA' | 'ONLINE_EGYPT' | 'ONLINE_EGYPT_FOREIGN' | 'ONLINE_SAUDI' | 'ONLINE_ABROAD';
export type TierCurrency = 'EGP' | 'SAR' | 'USD';

export interface PriceTierDef {
  key: PriceTierKey;
  label: string;
  currency: TierCurrency;
  branch: string;
  physical?: boolean;
  nationality?: string;
  /** Reads this tier's price and discount until given its own (عميل الدقي غير المصري ← أونلاين غير مصري). */
  inheritsFrom?: PriceTierKey;
}

export interface TierPrice {
  key: PriceTierKey;
  label: string;
  currency: TierCurrency;
  branch: string;
  price: number | null;
  discountPrice: number | null;
  /** No price of its own: it reads another tier's until someone sets one. */
  inherited: boolean;
  inheritedFrom?: PriceTierKey | null;
  /** The discount price is the inherited tier's too. */
  discountInherited?: boolean;
}

export type BonusRole = 'sales' | 'service' | 'instructor';
export interface BookingBonus { type: 'fixed' | 'percent'; value: number }
export type BookingBonuses = Partial<Record<BonusRole, BookingBonus>>;

export interface ItemPricing { tiers: TierPrice[]; bonuses: BookingBonuses }
export interface CatalogPricing {
  tiers: PriceTierDef[];
  items: { course: Record<string, ItemPricing>; bundle: Record<string, ItemPricing> };
}

/** The percentage buttons beside المقدم — the server accepts these only (api/lib/priceTiers.js). */
export const DISCOUNT_PERCENTS = [5, 10, 15, 20, 25, 30, 40, 50] as const;

export const BONUS_ROLE_LABELS: Record<BonusRole, string> = {
  sales: 'السيلز',
  service: 'الرسيبشن / التحصيل / خدمة العملاء',
  instructor: 'المحاضر',
};

export const CURRENCY_LABELS: Record<TierCurrency, string> = { EGP: 'جنيه', SAR: 'ريال', USD: 'دولار' };

export const getCatalogPricing = () => mysqlAdmin.adminGet<CatalogPricing>('/admin/catalog-pricing');
export const getItemPricing = (type: 'course' | 'bundle', id: string) =>
  mysqlAdmin.adminGet<ItemPricing & { tiers: TierPrice[] }>(`/admin/catalog-pricing/${type}/${encodeURIComponent(id)}`);
export const saveItemPricing = (
  type: 'course' | 'bundle',
  id: string,
  body: { tiers: Partial<Record<PriceTierKey, { price: number | null; discountPrice: number | null }>>; bonuses: BookingBonuses },
) => mysqlAdmin.adminPut<ItemPricing & { ok: boolean }>(`/admin/catalog-pricing/${type}/${encodeURIComponent(id)}`, body);

/** The tier a branch is priced at — online Egypt splits by nationality. Mirrors tierForBranch on the server. */
export function tierForBranch(branch: string | null | undefined, nationality?: string | null): PriceTierKey | null {
  const b = String(branch || '').toUpperCase();
  const foreign = String(nationality || '').toUpperCase() === 'NON_EGYPTIAN_EGYPT';
  if (b === 'ONLINE_EGYPT' && foreign) return 'ONLINE_EGYPT_FOREIGN';
  if (b === 'DAQQI' && foreign) return 'DAQQI_FOREIGN';
  return (['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD'] as string[]).includes(b) ? b as PriceTierKey : null;
}

export const formatMoney = (value: number | null | undefined, currency: TierCurrency) =>
  value == null ? '—' : `${Number(value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} ${CURRENCY_LABELS[currency]}`;
