/**
 * The receipt numbers the last booking was given.
 *
 * «ارقام العمليات اللي هيا ارقام الايصالات تكون مرتبة بتسلسل» (13 Oct 2026). A Dokki or
 * Tagamoa payment is answered with the branch's next receipt number (api/lib/receiptNumbers.js);
 * the payment dialog prints it on the receipt. The answer comes back through twelve callers
 * that return nothing, so — like the picture links and «who brought it» — the API client
 * leaves it here and the dialog takes it once its save has finished.
 */
let numbers: number[] = [];

/** Called by the API client with the payment POST's answer. */
export function noteReceipt(answer: unknown) {
  const receiptNo = Number((answer as { receiptNo?: unknown } | null)?.receiptNo);
  if (Number.isInteger(receiptNo) && receiptNo > 0) numbers.push(receiptNo);
}

/** The dialog clears it before it saves. */
export function forgetReceipts() { numbers = []; }

/** «57» for one payment, «57–59» when a booking made several (the course and what was added to it). */
export function takeReceiptLabel(): string | null {
  const taken = numbers;
  numbers = [];
  if (!taken.length) return null;
  const first = Math.min(...taken);
  const last = Math.max(...taken);
  return first === last ? String(first) : `${first}–${last}`;
}
