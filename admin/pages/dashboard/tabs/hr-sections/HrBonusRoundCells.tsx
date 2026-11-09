// The month sheet's bonus columns for the half-month rounds (9 Nov 2026): «مكافأة الروند الأولى» / «مكافأة الروند الثانية» / «إجمالي المكافآت».
// A round cell says the bookings it reached and what that paid («11 حجز → 1,000»); when the owner set the round's figure by hand the plan's stays beside it with
// the reason. A collector has one cell: «مكافأة X مع تحقيق Y». The owner's change (ROUND_OVERRIDE) needs a reason and can be taken back.
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { mysqlAdmin, type BonusRound, type SheetBonusPlan } from '../../../../lib/mysqlapi';
import { fmtMoney } from './hrFormat';
import { SAVE_STATE_TEXT, bonusTotal, collectionCellText, roundCellText, saveState } from './bonusSheetCells';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Manual = { manualApproved?: number; manualPending?: number; planSaved?: { amount: number; approved: boolean } | null };

const CELL = 'whitespace-nowrap border-b border-gray-100 px-3 py-2';

/** A rep's round: the bookings it reached and the bonus, the owner's figure marked. */
export function RoundCell({ round, canEdit, onEdit }: { round: BonusRound | undefined; canEdit: boolean; onEdit: () => void }) {
  if (!round) return <td className={`${CELL} text-gray-300`}>—</td>;
  return (
    <td className={`${CELL} tabular-nums`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs">
          <p className="font-bold text-gray-800">{roundCellText(round)}</p>
          <p className="text-[10px] text-gray-400">{round.label}</p>
          {round.override && (
            <p className="text-[10px] text-indigo-700" title={`${round.override.reason}${round.override.by ? ` — ${round.override.by}` : ''}`}>
              اتعدلت من الإدارة · المحسوب {fmtMoney(round.computedAmount)}
            </p>
          )}
        </div>
        {canEdit && <button type="button" onClick={onEdit} title="تعديل مكافأة الروند" className="shrink-0 rounded-lg bg-gray-100 p-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"><Pencil size={11} /></button>}
      </div>
    </td>
  );
}

/** The two round cells of a rep, or the collector's one cell across both, or nothing for an employee on no scheme. */
export function BonusRoundCells({ plan, canEdit, onEdit }: { plan: SheetBonusPlan | null; canEdit: boolean; onEdit: (round: number) => void }) {
  if (!plan) return <><td className={`${CELL} text-gray-300`}>—</td><td className={`${CELL} text-gray-300`}>—</td></>;
  if (plan.rounds && plan.halfMonths) {
    return <><RoundCell round={plan.rounds[0]} canEdit={canEdit} onEdit={() => onEdit(1)} /><RoundCell round={plan.rounds[1]} canEdit={canEdit} onEdit={() => onEdit(2)} /></>;
  }
  if (plan.rounds) {
    return <><td colSpan={2} className={`${CELL} text-xs font-bold tabular-nums text-gray-800`}>{roundCellText(plan.rounds[0])} <span className="font-normal text-gray-400">(الشهر)</span></td></>;
  }
  return (
    <td colSpan={2} className={`${CELL} text-xs tabular-nums`}>
      {plan.collection && <p className="font-bold text-gray-800">{collectionCellText(plan.collection)}</p>}
      {plan.deskBonus ? <p className="text-gray-600">حجوزات الريسبشن +{fmtMoney(plan.deskBonus)}</p> : null}
      {!plan.collection && !plan.deskBonus && <span className="text-gray-300">—</span>}
    </td>
  );
}

/** «إجمالي المكافآت»: the plan's month with the owner's figures, and what was typed by hand; underneath, where it stands towards payroll. */
export function BonusTotalCell({ plan, bonuses }: { plan: SheetBonusPlan | null; bonuses: Manual | undefined }) {
  const total = bonusTotal(plan, bonuses);
  const state = saveState(plan, bonuses?.planSaved);
  const hand = (bonuses?.manualApproved || 0) + (bonuses?.manualPending || 0);
  return (
    <td className={`${CELL} tabular-nums`}>
      {total > 0 ? <p className="text-sm font-extrabold text-emerald-700">{fmtMoney(total)}</p> : <span className="text-gray-300">—</span>}
      {plan?.totalOverride && <p className="text-[10px] text-indigo-700" title={plan.totalOverride.reason}>الإجمالي اتعدل · المحسوب {fmtMoney(plan.computedTotal)}</p>}
      {hand > 0 && plan && plan.total > 0 && <p className="text-[10px] text-gray-500">منها يدوي {fmtMoney(hand)}</p>}
      {state.kind !== 'none' && state.kind !== 'approved' && <p className={`text-[10px] ${state.kind === 'pending' ? 'text-amber-600' : 'text-rose-600'}`}>{SAVE_STATE_TEXT[state.kind]}</p>}
    </td>
  );
}

/** The owner's figure for one round, with the reason; or the plan's figure back. */
export function RoundOverrideEditor({ staffId, name, month, round, notify, onSaved, onClose }: {
  staffId: string; name: string; month: string; round: BonusRound; notify: Notify; onSaved: () => void; onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(round.amount));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await job(); notify('success', done); onSaved(); onClose(); } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحفظ'); } finally { setBusy(false); }
  };
  const save = () => {
    if (!(Number(amount) >= 0) || amount.trim() === '') { notify('error', 'اكتب المبلغ'); return; }
    if (reason.trim().length < 3) { notify('error', 'لازم تكتب سبب التعديل'); return; }
    void run(() => mysqlAdmin.addBonusAdjustment({ month, kind: 'ROUND_OVERRIDE', staffId, round: round.round, amount: Number(amount), reason: reason.trim() }), `اتعدلت مكافأة الروند ${round.label} لـ${name}`);
  };
  const inputClass = 'rounded-lg border border-gray-200 px-2 py-1.5 text-sm';
  return (
    <div className="space-y-2" dir="rtl">
      <p className="text-xs font-extrabold text-indigo-900">مكافأة {name} — الروند {round.label}: {roundCellText({ bookings: round.bookings, amount: round.computedAmount })} (المحسوب من نظام المكافآت)</p>
      {round.override && <p className="text-xs text-gray-600">المعدّل الحالي {fmtMoney(round.override.amount)} — {round.override.reason}{round.override.by ? ` (${round.override.by})` : ''}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min={0} aria-label="مكافأة الروند" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputClass} w-28`} />
        <input aria-label="سبب التعديل" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="سبب التعديل (إجباري)" className={`${inputClass} min-w-[220px] flex-1`} />
        <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">حفظ التعديل</button>
        {round.override && (
          <button type="button" disabled={busy} onClick={() => void run(() => mysqlAdmin.revokeBonusAdjustment(round.override!.id, reason.trim() || undefined), 'رجعت مكافأة الروند للمحسوب')}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">رجّع المحسوب</button>
        )}
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500">إغلاق</button>
      </div>
      <p className="text-[11px] text-gray-500">التعديل بيتسجل باسمك وسببه، والمحسوب بيفضل ظاهر جنبه. بعد ما تعدّل دوس «حفظ المكافآت للاعتماد» عشان توصل لاعتمادات المرتبات.</p>
    </div>
  );
}
