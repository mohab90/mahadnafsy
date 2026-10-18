import { cairoDay } from '../../shared/cairoDate';
import type { PaymentHistoryEntry, SubscriberItem } from '../types';

/**
 * A client whose payment was rejected and who has paid nothing since.
 *
 * «لما عميل بيتحط له دفعه وتترفض لازم يظهر علامه مميزه علي العميل ان العميل دا موجود ولكن دفعته اترفضت»: the
 * client exists, the money did not land, and nothing on their row said so — a rejected payment is only a line
 * in a log. The mark goes on the client's name (the clients table, the client page) until a later payment is
 * recorded that is not rejected.
 *
 * `reason` is what the rejecter wrote: the server appends it to the payment's note as «Review: …».
 */
export type RejectedPayment = { payment: PaymentHistoryEntry; reason: string; day: string };

export function rejectedPaymentOf(client: Pick<SubscriberItem, 'paymentHistory'> | null | undefined): RejectedPayment | null {
  const history = client?.paymentHistory || [];
  let newestRejected: PaymentHistoryEntry | null = null;
  let newestRejectedDay = '';
  let newestSettledDay = '';
  for (const payment of history) {
    const day = cairoDay(payment.at);
    if (!day) continue;
    if (payment.status === 'failed') {
      if (day >= newestRejectedDay) { newestRejected = payment; newestRejectedDay = day; }
    } else if (payment.status !== 'refunded' && day > newestSettledDay) {
      newestSettledDay = day;
    }
  }
  // Anything recorded after the rejection (paid or still waiting) is the client trying again.
  if (!newestRejected || newestSettledDay >= newestRejectedDay) return null;
  const reason = /Review:\s*(.+?)(?:\s*\|\s*|$)/.exec(newestRejected.note || '')?.[1]?.trim() || '';
  return { payment: newestRejected, reason, day: newestRejectedDay };
}

/** The badge's tooltip: how much, when, and why. */
export function rejectedPaymentTitle(rejected: RejectedPayment): string {
  const money = `${Number(rejected.payment.amount || 0).toLocaleString('ar-EG-u-nu-latn')} ${rejected.payment.currency || 'EGP'}`;
  return `دفعة ${money} بتاريخ ${rejected.day} اترفضت${rejected.reason ? ` — السبب: ${rejected.reason}` : ''}`;
}
