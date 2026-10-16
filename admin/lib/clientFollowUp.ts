import { cairoDateOnly, cairoDay, cairoDaysAhead } from '../../shared/cairoDate';
import type { SubscriberItem } from '../types';

// «المتابعات محتاجة تكون أقوى … لما بعمل فلتر للمتابعات النهاردة فى عملاء الاونلاين مش بتظهر»
// (14 Oct 2026). One definition of «a client is due for a follow-up», used by the table's
// badge, the filter and the counts above it, so what the filter says is what the row shows.
//
// A client is due for two reasons: the next contact the team set when it last spoke to
// them (the latest communication's «المتابعة القادمة»), and an installment that has fallen
// due. The more urgent of the two decides the status.

export type FollowStatus = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';
export type FollowReason = 'contact' | 'installment';

export interface FollowUp {
  /** The earliest date the client is due, YYYY-MM-DD. */
  date: string | null;
  status: FollowStatus;
  reasons: FollowReason[];
  contactDate: string | null;
  installmentDate: string | null;
}

// A picked day arrives as YYYY-MM-DD; a stored instant is read on Cairo's clock.
const dayOf = (value?: string | null): string | null => {
  const text = String(value || '').trim();
  if (!text) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : cairoDay(text);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

/** The next contact the team set: the field on the client, else the latest communication's. */
export function contactFollowUpOf(row: Pick<SubscriberItem, 'nextFollowUpDate' | 'communications'>): string | null {
  const comms = row.communications || [];
  const last = comms.length ? [...comms].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null;
  return dayOf(row.nextFollowUpDate) || dayOf(last?.nextFollowUp);
}

/** The earliest unpaid installment's due date. */
export function installmentDueOf(row: Pick<SubscriberItem, 'installmentPlans'>): string | null {
  let first: string | null = null;
  for (const plan of row.installmentPlans || []) {
    for (const entry of plan.entries || []) {
      const due = entry.paidAt ? null : dayOf(entry.dueDate);
      if (due && (!first || due < first)) first = due;
    }
  }
  return first;
}

export function statusOfDate(date: string | null, today = cairoDateOnly()): FollowStatus {
  if (!date) return 'none';
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  if (date === cairoDaysAhead(1)) return 'tomorrow';
  if (date <= cairoDaysAhead(7)) return 'week';
  return 'later';
}

export function followUpOf(row: SubscriberItem, today = cairoDateOnly()): FollowUp {
  const contactDate = contactFollowUpOf(row);
  const installmentDate = installmentDueOf(row);
  const reasons: FollowReason[] = [];
  // Only a due or overdue installment is a follow-up; one next month is not.
  const installmentDue = installmentDate && installmentDate <= today ? installmentDate : null;
  if (contactDate) reasons.push('contact');
  if (installmentDue) reasons.push('installment');
  const dates = [contactDate, installmentDue].filter((d): d is string => Boolean(d)).sort();
  const date = dates[0] || null;
  return { date, status: statusOfDate(date, today), reasons, contactDate, installmentDate: installmentDue };
}

export type FollowFilter = '' | 'due' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'none';

export const FOLLOW_FILTERS: Array<[FollowFilter, string]> = [
  ['', 'كل المتابعات'],
  ['due', '🔔 مستحقة (متأخرة + النهاردة)'],
  ['overdue', '🔴 متأخرة'],
  ['today', '🟡 النهاردة'],
  ['tomorrow', '📅 بكرة'],
  ['week', '🗓 الأسبوع ده'],
  ['none', 'بدون متابعة'],
];

export function matchesFollowFilter(follow: FollowUp, filter: FollowFilter): boolean {
  switch (filter) {
    case '': return true;
    case 'due': return follow.status === 'overdue' || follow.status === 'today';
    case 'week': return follow.status === 'today' || follow.status === 'tomorrow' || follow.status === 'week';
    case 'none': return follow.status === 'none';
    default: return follow.status === filter;
  }
}
