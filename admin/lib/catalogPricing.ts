// A course's or track's price at each branch, its discount prices and its
// booking bonuses — the browser side of api/lib/priceTiers.js.
import { mysqlAdmin } from './mysqlapi';

export type PriceTierKey = 'DAQQI' | 'TAGAMOA' | 'ONLINE_EGYPT' | 'ONLINE_EGYPT_FOREIGN' | 'ONLINE_SAUDI' | 'ONLINE_ABROAD';
export type TierCurrency = 'EGP' | 'SAR' | 'USD';

export interface PriceTierDef {
  key: PriceTierKey;
  label: string;
  currency: TierCurrency;
  branch: string;
  physical?: boolean;
  nationality?: string;
}

export interface TierPrice {
  key: PriceTierKey;
  label: string;
  currency: TierCurrency;
  branch: string;
  price: number | null;
  discountPrice: number | null;
  /** No price of its own: it reads the online Egyptian price until someone sets one. */
  inherited: boolean;
}

export type BonusRole = 'sales' | 'service' | 'instructor';
export interface BookingBonus { type: 'fixed' | 'percent'; value: number }
export type BookingBonuses = Partial<Record<BonusRole, BookingBonus>>;

export interface ItemPricing { tiers: TierPrice[]; bonuses: BookingBonuses }
export interface CatalogPricing {
  tiers: PriceTierDef[];
  items: { course: Record<string, ItemPricing>; bundle: Record<string, ItemPricing> };
}

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
  if (b === 'ONLINE_EGYPT' && String(nationality || '').toUpperCase() === 'NON_EGYPTIAN_EGYPT') return 'ONLINE_EGYPT_FOREIGN';
  return (['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD'] as string[]).includes(b) ? b as PriceTierKey : null;
}

export const formatMoney = (value: number | null | undefined, currency: TierCurrency) =>
  value == null ? '—' : `${Number(value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} ${CURRENCY_LABELS[currency]}`;
