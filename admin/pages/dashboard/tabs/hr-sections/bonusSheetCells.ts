// What the payroll month sheet writes in its bonus columns (9 Nov 2026), from the server's figures (attendance summary → bonus_plan, api/lib/roundProgress.js).
// Pure, so the sentences can be tested on their own: «11 حجز → 1,000», «مكافأة 1,200 ج.م مع تحقيق 60,000 ج.م», and what is still to be done with the total.
import type { BonusRound, SheetBonusPlan } from '../../../../lib/mysqlapi';

const n = (value: number) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });

/** «11 حجز → 1,000» */
export const roundCellText = (round: Pick<BonusRound, 'bookings' | 'amount'>) => `${n(round.bookings)} حجز → ${n(round.amount)}`;

/** The collector's one cell: «مكافأة 1,200 ج.م مع تحقيق 60,000 ج.م». */
export const collectionCellText = (collection: NonNullable<SheetBonusPlan['collection']>) => `مكافأة ${n(collection.amount)} ج.م مع تحقيق ${n(collection.collected)} ج.م`;

/** The month's bonuses of an employee: what the plan works out (the owner's figures in it) plus what was typed by hand. */
export const bonusTotal = (plan: SheetBonusPlan | null, manual: { manualApproved?: number; manualPending?: number } = {}) =>
  Math.round(((plan ? plan.total : 0) + (manual.manualApproved || 0) + (manual.manualPending || 0)) * 100) / 100;

export type SaveState = { kind: 'none' | 'unsaved' | 'differs' | 'pending' | 'approved'; saved: number | null };
/** Where the plan's bonus stands towards payroll: not saved yet, saved but different from what is worked out now, waiting for approval, or approved. */
export function saveState(plan: SheetBonusPlan | null, planSaved: { amount: number; approved: boolean } | null | undefined): SaveState {
  if (!plan || !(plan.total > 0)) return { kind: 'none', saved: planSaved ? planSaved.amount : null };
  if (!planSaved) return { kind: 'unsaved', saved: null };
  if (Math.abs(planSaved.amount - plan.total) >= 0.01) return { kind: 'differs', saved: planSaved.amount };
  return { kind: planSaved.approved ? 'approved' : 'pending', saved: planSaved.amount };
}
export const SAVE_STATE_TEXT: Record<SaveState['kind'], string> = {
  none: '', unsaved: 'لسه ما اتحفظتش للاعتماد', differs: 'المحفوظ مختلف عن المحسوب — احفظ المكافآت تاني', pending: 'مستنية الاعتماد', approved: 'معتمدة',
};
