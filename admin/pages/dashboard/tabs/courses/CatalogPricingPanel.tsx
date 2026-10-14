import React, { useEffect, useMemo, useState } from 'react';
import { Gift, Loader2, Save, Tag } from 'lucide-react';
import {
  BONUS_ROLE_LABELS, CURRENCY_LABELS, getItemPricing, saveItemPricing,
  type BonusRole, type BookingBonuses, type PriceTierKey, type TierPrice,
} from '../../../../lib/catalogPricing';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  type: 'course' | 'bundle';
  itemId: string | null | undefined;
  notify: NotifyFn;
  /** The online prices after a save, so the form holding price_* does not write back stale ones. */
  onSaved?: (online: { EGP: number; SAR: number; USD: number }) => void;
}

type Draft = Record<PriceTierKey, { price: string; discountPrice: string }>;
type BonusDraft = Record<BonusRole, { type: 'fixed' | 'percent'; value: string }>;

const toDraft = (tiers: TierPrice[]): Draft => Object.fromEntries(tiers.map(t => [t.key, {
  price: t.inherited || t.price == null ? '' : String(t.price),
  // An inherited discount is the other tier's; saved here it would stop following it.
  discountPrice: t.discountPrice == null || t.discountInherited ? '' : String(t.discountPrice),
}])) as Draft;

const toBonusDraft = (bonuses: BookingBonuses): BonusDraft => ({
  sales: { type: bonuses.sales?.type || 'fixed', value: bonuses.sales ? String(bonuses.sales.value) : '' },
  service: { type: bonuses.service?.type || 'fixed', value: bonuses.service ? String(bonuses.service.value) : '' },
  instructor: { type: bonuses.instructor?.type || 'fixed', value: bonuses.instructor ? String(bonuses.instructor.value) : '' },
});

const num = (value: string) => (value.trim() === '' ? null : Number(value));
const INP = 'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm tabular-nums';

/**
 * «الأسعار حسب الفرع» and «مكافأة الحجز» on the course and track page: one row per
 * branch tier, each with its discount price, and the three booking bonuses.
 */
export default function CatalogPricingPanel({ type, itemId, notify, onSaved }: Props) {
  const [tiers, setTiers] = useState<TierPrice[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bonusDraft, setBonusDraft] = useState<BonusDraft>(toBonusDraft({}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!itemId) return;
    let alive = true;
    setTiers(null);
    getItemPricing(type, itemId)
      .then(res => { if (!alive) return; setTiers(res.tiers); setDraft(toDraft(res.tiers)); setBonusDraft(toBonusDraft(res.bonuses || {})); })
      .catch(() => alive && setError('تعذر تحميل أسعار الفروع'));
    return () => { alive = false; };
  }, [type, itemId]);

  const onlineEgypt = useMemo(() => {
    const own = num(draft?.ONLINE_EGYPT.price || '');
    return own ?? tiers?.find(t => t.key === 'ONLINE_EGYPT')?.price ?? null;
  }, [draft, tiers]);

  if (!itemId) {
    return (
      <div className="md:col-span-2 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        احفظ {type === 'bundle' ? 'المسار' : 'الكورس'} الأول، وبعدها تقدر تحط سعر كل فرع وسعر الخصم ومكافآت الحجز.
      </div>
    );
  }
  if (error) return <div className="md:col-span-2 text-sm text-red-600">{error}</div>;
  if (!tiers || !draft) return <div className="md:col-span-2 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> بنحمّل الأسعار…</div>;

  const setTier = (key: PriceTierKey, field: 'price' | 'discountPrice', value: string) =>
    setDraft(prev => prev && ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const problems = tiers.flatMap(tier => {
    const price = num(draft[tier.key].price) ?? (tier.inherited || tier.key !== 'ONLINE_EGYPT' && tier.currency === 'EGP' ? onlineEgypt : null);
    const discount = num(draft[tier.key].discountPrice);
    if (discount != null && (price == null || discount >= price)) return [`سعر الخصم في «${tier.label}» لازم يبقى أقل من السعر`];
    return [];
  });

  const save = async () => {
    if (problems.length) { notify('error', problems[0]); return; }
    setSaving(true);
    try {
      const body = {
        tiers: Object.fromEntries(tiers.map(t => [t.key, { price: num(draft[t.key].price), discountPrice: num(draft[t.key].discountPrice) }])),
        bonuses: Object.fromEntries((Object.keys(bonusDraft) as BonusRole[])
          .filter(role => num(bonusDraft[role].value) != null)
          .map(role => [role, { type: bonusDraft[role].type, value: Number(bonusDraft[role].value) }])),
      };
      const res = await saveItemPricing(type, itemId, body);
      setTiers(res.tiers);
      setDraft(toDraft(res.tiers));
      setBonusDraft(toBonusDraft(res.bonuses || {}));
      const priceOf = (key: PriceTierKey) => res.tiers.find(t => t.key === key)?.price || 0;
      onSaved?.({ EGP: priceOf('ONLINE_EGYPT'), SAR: priceOf('ONLINE_SAUDI'), USD: priceOf('ONLINE_ABROAD') });
      notify('success', 'اتحفظت الأسعار ومكافآت الحجز');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'تعذر حفظ الأسعار');
    } finally { setSaving(false); }
  };

  return (
    <section className="md:col-span-2 rounded-2xl border border-gray-200 bg-white" dir="rtl">
      <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary-600" />
          <h4 className="font-bold text-gray-800">الأسعار حسب الفرع</h4>
        </div>
        <p className="text-[11px] text-gray-500">السعر بيظهر للموظف في «حجز ودفع» بعد ما يختار الكورس والفرع</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 text-right font-bold">الفرع</th>
              <th className="px-3 py-2 text-right font-bold">السعر</th>
              <th className="px-3 py-2 text-right font-bold">سعر الخصم <span className="font-normal">(اختياري)</span></th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(tier => {
              const source = tier.inheritedFrom && tier.inheritedFrom !== 'ONLINE_EGYPT' ? tiers.find(t => t.key === tier.inheritedFrom) : null;
              const placeholder = source && tier.price != null
                ? `زي «${source.label}»: ${tier.price}`
                : tier.currency === 'EGP' && tier.key !== 'ONLINE_EGYPT' && onlineEgypt != null
                ? `زي الأونلاين: ${onlineEgypt}` : 'مش متسعّر';
              return (
                <tr key={tier.key} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-bold text-gray-700 whitespace-nowrap">
                    {tier.label}
                    <span className="mr-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{CURRENCY_LABELS[tier.currency]}</span>
                  </td>
                  <td className="px-3 py-2 min-w-[8rem]">
                    <input type="number" min={0} className={INP} placeholder={placeholder}
                      value={draft[tier.key].price} onChange={e => setTier(tier.key, 'price', e.target.value)} />
                  </td>
                  <td className="px-3 py-2 min-w-[8rem]">
                    <input type="number" min={0} className={INP} placeholder={tier.discountInherited && tier.discountPrice != null ? `زي «${source?.label || ''}»: ${tier.discountPrice}` : 'بدون خصم'}
                      value={draft[tier.key].discountPrice} onChange={e => setTier(tier.key, 'discountPrice', e.target.value)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-100 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Gift className="w-4 h-4 text-emerald-600" />
          <h4 className="font-bold text-gray-800">مكافأة حجز الكورس</h4>
          <span className="text-[11px] text-gray-500">بتتحسب مرة واحدة لكل عميل، وبتنزل في العمولات والمرتبات</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(BONUS_ROLE_LABELS) as BonusRole[]).map(role => (
            <label key={role} className="block rounded-xl border border-gray-200 p-3">
              <span className="mb-2 block text-xs font-bold text-gray-600">{BONUS_ROLE_LABELS[role]}</span>
              <div className="flex gap-2">
                <input type="number" min={0} className={INP} placeholder="بدون مكافأة"
                  value={bonusDraft[role].value}
                  onChange={e => setBonusDraft(prev => ({ ...prev, [role]: { ...prev[role], value: e.target.value } }))} />
                <select className="border border-gray-300 rounded-xl px-2 text-sm"
                  value={bonusDraft[role].type}
                  onChange={e => setBonusDraft(prev => ({ ...prev, [role]: { ...prev[role], type: e.target.value as 'fixed' | 'percent' } }))}>
                  <option value="fixed">جنيه</option>
                  <option value="percent">% من السعر</option>
                </select>
              </div>
            </label>
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
        <p className="text-xs text-red-600">{problems[0] || ''}</p>
        <button type="button" onClick={save} disabled={saving || problems.length > 0}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ الأسعار والمكافآت
        </button>
      </footer>
    </section>
  );
}
