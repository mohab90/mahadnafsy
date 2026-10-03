// «تسكين» together with a booking («حجز ودفع»).
//
// A Dokki booking can name the round the client is seated in. The server records
// the booking and then seats them, and says how that went in `housed`; this turns
// the answer into what the desk is told, and tells the rest of the admin that the
// rosters have changed so the schedule and «عملاء الدقي» read them again.

const WHY: Record<string, string> = {
  failed: 'لكن التسكين ماتمش — سكّنه من «عملاء الدقي».',
  no_round: 'لكن الروند اللي اخترته مبقاش موجود — سكّنه من «عملاء الدقي».',
  archived: 'لكن العميل مؤرشف فماينفعش يتسكّن.',
  no_subscriber: 'لكن التسكين ماتمش — العميل مش لاقيينه.',
};

/** The rounds changed — the context reads them again (SiteDataContext listens for this). */
export const ROUNDS_CHANGED_EVENT = 'daqqi-rounds-changed';
export const announceRoundsChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROUNDS_CHANGED_EVENT));
};

/**
 * What the booking answered about the seating. `text` goes after the booking's own
 * message; `warning` is set when the booking stands but the seating did not happen.
 */
export function housingOutcome(results: Array<{ housed?: string } | undefined | null>): { text: string; warning: boolean; changed: boolean } {
  const answers = results.map(result => result?.housed).filter((answer): answer is string => Boolean(answer));
  if (answers.length === 0) return { text: '', warning: false, changed: false };
  const failed = answers.find(answer => answer !== 'seated');
  if (failed) return { text: ` ${WHY[failed] || WHY.failed}`, warning: true, changed: false };
  return { text: ' واتسكّن في الروند ✓', warning: false, changed: true };
}
