// The employee's bonus scheme, one editor for every screen that sets it (the staff data table, the month sheet's «تعديل», the employee's file): the scheme
// (staff.bonus_scheme), for a sales rep the step the ladder starts at (booking_first_target) with what each round would pay from the plan, and for a collector
// the levels. 9 Nov 2026: the half-month rounds replace the flat monthly target — the system works the amount out, nobody types a target bonus.
import { useEffect, useState } from 'react';
import { mysqlAdmin, type BonusLevel, type BonusPlan } from '../../../../lib/mysqlapi';

export const BONUS_SCHEME_LABEL: Record<string, string> = {
  NONE: 'بدون', SALES_BOOKINGS: 'حجوزات (سيلز)', COLLECTION: 'تحصيل', COLLECTION_BOOKINGS: 'تحصيل + حجوزات',
};
const FALLBACK_STEPS = [10, 15, 20, 25, 30];

/** What a screen holds while the scheme is being edited (text fields stay text until saved). */
export interface SchemeDraft {
  bonusScheme: string; bookingFirstTarget: string; collectionLevels: { from: string; kind: 'percent' | 'fixed'; value: string }[];
}
export const schemeDraftOf = (source: { bonusScheme?: string | null; bookingFirstTarget?: number | null; collectionLevels?: BonusLevel[] | null }): SchemeDraft => ({
  bonusScheme: source.bonusScheme || 'NONE',
  bookingFirstTarget: source.bookingFirstTarget == null ? '' : String(source.bookingFirstTarget),
  collectionLevels: (source.collectionLevels || []).map(level => ({ from: String(level.from), kind: level.kind, value: String(level.value) })),
});
/** The scheme as the API takes it. */
export const schemePayload = (draft: SchemeDraft) => ({
  bonusScheme: draft.bonusScheme,
  bookingFirstTarget: draft.bonusScheme === 'SALES_BOOKINGS' && draft.bookingFirstTarget.trim() !== '' ? Number(draft.bookingFirstTarget) : null,
  collectionLevels: draft.bonusScheme.startsWith('COLLECTION')
    ? draft.collectionLevels.filter(level => level.from.trim() !== '' && level.value.trim() !== '').map((level): BonusLevel => ({ from: Number(level.from), kind: level.kind, value: Number(level.value) }))
    : [],
});

let planRequest: Promise<BonusPlan | null> | null = null;
/** The bonus plan (one request for all the editors on the page); null while loading or when the account cannot read it. */
export function useBonusPlan(): BonusPlan | null {
  const [plan, setPlan] = useState<BonusPlan | null>(null);
  useEffect(() => {
    let live = true;
    planRequest ||= mysqlAdmin.getBonusPlan().then(answer => answer.plan).catch(() => { planRequest = null; return null; });
    void planRequest.then(value => { if (live) setPlan(value); });
    return () => { live = false; };
  }, []);
  return plan;
}

/** After the plan is saved, the editors read it again. */
export const forgetBonusPlan = () => { planRequest = null; };

const money = (value: number) => Number(value).toLocaleString('ar-EG-u-nu-latn');
/** «10 حجز ← 1,000 · 15 ← 1,500 …» from the plan, starting at the rep's step. */
export function stepsText(plan: BonusPlan | null, firstTarget: number | null): string {
  if (!plan) return '';
  const tiers = plan.bookingLadder.filter(tier => firstTarget == null || tier.bookings >= firstTarget);
  if (!tiers.length) return '';
  return tiers.map((tier, index) => `${money(tier.bookings)}${index === 0 ? ' حجز' : ''} ← ${money(tier.amount)}`).join(' · ');
}

const field = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
type Change = (patch: Partial<SchemeDraft>) => void;

export function SchemeSelect({ value, onChange, disabled = false }: { value: SchemeDraft; onChange: Change; disabled?: boolean }) {
  return (
    <select aria-label="نظام المكافأة" className={field} disabled={disabled} value={value.bonusScheme} onChange={e => onChange({ bonusScheme: e.target.value })}>
      {Object.entries(BONUS_SCHEME_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
  );
}

/** A rep's starting step, and what each round pays from there (from the plan). */
export function FirstStepField({ value, onChange, disabled = false, compact = false }: { value: SchemeDraft; onChange: Change; disabled?: boolean; compact?: boolean }) {
  const plan = useBonusPlan();
  const steps = plan?.bookingLadder.length ? plan.bookingLadder.map(tier => tier.bookings) : FALLBACK_STEPS;
  const first = value.bookingFirstTarget === '' ? null : Number(value.bookingFirstTarget);
  const half = plan?.salesPeriod === 'HALF_MONTH';
  return (
    <div>
      <select aria-label="أول خطوة" className={field} disabled={disabled} value={value.bookingFirstTarget} onChange={e => onChange({ bookingFirstTarget: e.target.value })}>
        <option value="">— اختار —</option>
        {steps.map(step => <option key={step} value={step}>{step} حجز</option>)}
      </select>
      <p className="mt-1 text-[11px] leading-5 text-gray-500">
        {first == null ? 'اختار الخطوة اللي بيبدأ منها — تحتها مفيش مكافأة.' : `${half ? 'كل روند (نص شهر)' : 'الشهر'} بيدفع: ${stepsText(plan, first) || 'حسب نظام المكافآت'}.`}
        {!compact && ' المبلغ بيتحسب لوحده من نظام المكافآت.'}
      </p>
    </div>
  );
}

/** A collector's levels. */
export function CollectionLevels({ value, onChange, disabled = false }: { value: SchemeDraft; onChange: Change; disabled?: boolean }) {
  const setLevel = (index: number, patch: Partial<SchemeDraft['collectionLevels'][number]>) =>
    onChange({ collectionLevels: value.collectionLevels.map((level, i) => (i === index ? { ...level, ...patch } : level)) });
  return (
    <div className="space-y-2">
      <span className="block text-xs font-bold text-gray-600">ليفلات التحصيل — الليفل اللي التحصيل يوصله بيتطبق على تحصيل الشهر كله</span>
      {value.collectionLevels.map((level, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">من</span>
          <input type="number" min="0" dir="ltr" aria-label="من مبلغ" disabled={disabled} value={level.from} placeholder="50000" onChange={e => setLevel(index, { from: e.target.value })} className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm" />
          <span className="text-xs text-gray-500">ج.م ←</span>
          <select aria-label="نوع الليفل" disabled={disabled} value={level.kind} onChange={e => setLevel(index, { kind: e.target.value as 'percent' | 'fixed' })} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm">
            <option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option>
          </select>
          <input type="number" min="0" dir="ltr" aria-label="قيمة الليفل" disabled={disabled} value={level.value} placeholder={level.kind === 'percent' ? '2' : '1000'} onChange={e => setLevel(index, { value: e.target.value })} className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" />
          {!disabled && <button type="button" onClick={() => onChange({ collectionLevels: value.collectionLevels.filter((_, i) => i !== index) })} className="rounded-lg px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50">حذف</button>}
        </div>
      ))}
      {!disabled && <button type="button" onClick={() => onChange({ collectionLevels: [...value.collectionLevels, { from: '', kind: 'percent', value: '' }] })} className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">+ ليفل</button>}
      {value.bonusScheme === 'COLLECTION_BOOKINGS' && <span className="block text-[11px] text-gray-500">وكل حجز بيسجّله بياخد مكافأة الريسبشن المسجّلة في صفحة الكورس نفسه.</span>}
    </div>
  );
}

/** The whole editor: the scheme, then what the chosen scheme needs. */
export default function BonusSchemeFields({ value, onChange, disabled = false }: { value: SchemeDraft; onChange: Change; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-gray-700">نظام المكافأة</span>
        <SchemeSelect value={value} onChange={onChange} disabled={disabled} />
      </label>
      {value.bonusScheme === 'SALES_BOOKINGS' && (
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-700">بيبدأ من (أول خطوة في الروند)</span>
          <FirstStepField value={value} onChange={onChange} disabled={disabled} />
        </label>
      )}
      {value.bonusScheme.startsWith('COLLECTION') && <CollectionLevels value={value} onChange={onChange} disabled={disabled} />}
    </div>
  );
}
