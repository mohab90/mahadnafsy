import type { Bundle, CommunicationRecord, Course, DaqqiDayOfWeek, DaqqiRound, DaqqiRoundAttendee, DaqqiTimeSlot, SubscriberItem } from '../../../../types';
import { cairoDateOnly, cairoWeekStart } from '../../../../../shared/cairoDate';

export type DaqqiDraftType = {
  courseId: string;
  instructorId: string;
  receptionId: string;
  roomId: string;
  dayOfWeek: DaqqiDayOfWeek;
  startDate: string;
  timeSlot: DaqqiTimeSlot;
};

export const blankDaqqiDraft = (): DaqqiDraftType => ({
  courseId: '',
  instructorId: '',
  receptionId: '',
  roomId: '',
  dayOfWeek: 'الأحد' as DaqqiDayOfWeek,
  startDate: cairoDateOnly(),
  timeSlot: 'مساءً' as DaqqiTimeSlot,
});

export const calcCurrentLecture = (startDate: string, postponedWeeks?: string[]): number => {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const today = new Date(cairoDateOnly());
  const daysDiff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const weeksElapsed = Math.max(0, Math.floor(daysDiff / 7));
  return Math.max(1, weeksElapsed + 1 - (postponedWeeks?.length || 0));
};

// This week's Monday in Cairo, the key a postponed week is stored under. Built
// on the instant and formatted in UTC, it named Sunday between midnight and
// 02:00 or 03:00, so a week postponed then was filed under a key nothing read.
export const getCurrentWeekKey = (): string => cairoWeekStart(1);

export const normalizeDaqqiBranchId = (value?: string | null) =>
  String(value || '').toUpperCase().replace(/[-\s]/g, '_');

export const parseDaqqiBranchIds = (content: Record<string, string>) => {
  const ids = new Set<string>(['daqqi', 'DAQQI']);
  try {
    const raw = content['institute.branches'];
    if (raw) {
      const branches: { id: string; label: string }[] = JSON.parse(raw);
      branches.forEach(branch => {
        if (normalizeDaqqiBranchId(branch.id) === 'DAQQI' || (branch.label || '').includes('دق')) {
          ids.add(branch.id);
        }
      });
    }
  } catch {
    // Keep default DAQQI ids when admin branch settings are malformed.
  }
  return ids;
};



export const isEnrolledInCourse = (bundles: Bundle[], enrolledIds: string[], courseId: string): boolean => {
  if (enrolledIds.includes(courseId)) return true;
  return enrolledIds.some(enrolledId => {
    if (!enrolledId.startsWith('bundle:')) return false;
    const bundle = bundles.find(item => item.id === enrolledId.replace('bundle:', ''));
    return bundle?.courses.some(course => course.id === courseId) ?? false;
  });
};

/**
 * Rounds in the order a desk wants them: the client's own courses first, open
 * rounds before finished ones, and the soonest start within each.
 */
export function orderRoundsForClient(rounds: DaqqiRound[], clientCourseIds: string[] = []): DaqqiRound[] {
  const own = new Set(clientCourseIds);
  const rank = (round: DaqqiRound) => (own.has(round.courseId) ? 0 : 2) + ((round.status || 'new') === 'finished' ? 1 : 0);
  return [...rounds].sort((a, b) => rank(a) - rank(b)
    || String(a.startDate || '9999').localeCompare(String(b.startDate || '9999'))
    || String(a.code).localeCompare(String(b.code)));
}

/** «R-012 — د. أحمد — الأحد مساءً»: one line for a round, for places that have only a line. */
export function roundLabel(round: DaqqiRound, courses: Course[] = []): string {
  const found = courses.find(c => c.id === round.courseId);
  const course = found?.titleAr || found?.title || round.courseId || '';
  return [round.code, course, round.instructorName, `${round.dayOfWeek} ${round.timeSlot}`].filter(Boolean).join(' — ');
}

/** The courses of these rounds the client holds — a course of their own or one inside a track. */
export const courseIdsHeldIn = (rounds: Pick<DaqqiRound, 'courseId'>[], bundles: Bundle[], enrolledIds: string[]): string[] =>
  [...new Set(rounds.map(round => round.courseId))].filter(courseId => isEnrolledInCourse(bundles, enrolledIds, courseId));

export type HousingDecision = { kind: 'already' } | { kind: 'move'; from: DaqqiRound } | { kind: 'add' };

/**
 * What seating this client in this round means. A client already in it is told so;
 * one in another open round of the SAME course is being moved, not given a second
 * seat; anyone else — including a client in rounds of other courses — is added.
 * The clients screen used to move a client out of whatever round they were in,
 * whatever its course, so housing a client in a second course took them out of the first.
 */
export function housingDecision(rounds: DaqqiRound[], subscriberId: string, target: DaqqiRound): HousingDecision {
  if (target.attendees.some(a => a.subscriberId === subscriberId)) return { kind: 'already' };
  const from = rounds.find(round => round.id !== target.id && round.courseId === target.courseId
    && (round.status || 'new') !== 'finished' && round.attendees.some(a => a.subscriberId === subscriberId));
  return from ? { kind: 'move', from } : { kind: 'add' };
}

export const enrolledLabels = (courses: Course[], bundles: Bundle[], enrolledIds: string[]): string[] =>
  enrolledIds.map(courseId => {
    if (courseId.startsWith('bundle:')) {
      const bundle = bundles.find(item => item.id === courseId.replace('bundle:', ''));
      return bundle ? `مسار: ${bundle.title}` : null;
    }
    const course = courses.find(item => item.id === courseId);
    return course ? (course.titleAr || course.title) : null;
  }).filter(Boolean) as string[];

/**
 * What one client has paid and still owes toward the round they sit in.
 *
 * «في عملاء بتظهر دافعه 0 وهيا دافعه فلوس»: the figure is what came in as payments,
 * plus what they paid before the system, plus collected money that named no course
 * when this is their only one — and the price is the one they agreed (their course's
 * or their track's), the catalogue's only when none was. The round row, the list
 * under it and the strip above all read it from here so they cannot disagree.
 */
export function attendeeMoney(attendee: Pick<DaqqiRoundAttendee, 'amountPaid' | 'amountPrior' | 'amountUnlinkedApplied' | 'agreedPrice'>, catalogue: number) {
  const collected = Number(attendee.amountPaid) || 0;
  const prior = Number(attendee.amountPrior) || 0;
  const applied = Number(attendee.amountUnlinkedApplied) || 0;
  const paid = collected + prior + applied;
  const agreed = Number(attendee.agreedPrice) || 0;
  const price = agreed > 0 ? agreed : catalogue;
  return { collected, prior, applied, paid, price, remaining: price > 0 ? Math.max(0, price - paid) : 0 };
}

/** The client's latest contact — what the list already holds, and what was logged since. */
export function lastContactOf(
  subscriber: Pick<SubscriberItem, 'communications'> | undefined,
  logged: CommunicationRecord[] = [],
): CommunicationRecord | null {
  const all = [...(subscriber?.communications || []), ...logged];
  if (all.length === 0) return null;
  return all.reduce((latest, entry) => (String(entry.date) > String(latest.date) ? entry : latest));
}

/** One round's money, client by client — a client who overpaid does not cancel another's balance. */
export function roundMoney(round: Pick<DaqqiRound, 'attendees'>, catalogue: number) {
  return round.attendees.reduce((sum, attendee) => {
    const money = attendeeMoney(attendee, catalogue);
    return {
      collected: sum.collected + money.collected,
      prior: sum.prior + money.prior,
      applied: sum.applied + money.applied,
      paid: sum.paid + money.paid,
      expected: sum.expected + money.price,
      remaining: sum.remaining + money.remaining,
    };
  }, { collected: 0, prior: 0, applied: 0, paid: 0, expected: 0, remaining: 0 });
}

type OverviewRound = Pick<DaqqiRound, 'courseId' | 'status' | 'attendees' | 'postponedWeeks' | 'heldWeeks'>;
type OverviewClient = { id: string; enrolledCourseIds?: string[] };

/**
 * The branch in numbers, for the strip above the schedule: who is placed, who
 * has booked a course with an open round and sits in none — each person once,
 * however many rounds their course runs in — what this week's lectures did,
 * and the money the open rounds hold. «المتبقي» is counted as each row counts
 * it: the course's price for everyone in the round, less what they paid.
 */
export function daqqiOverview({ rounds, clients, bundles, priceOf, weekKey }: {
  rounds: OverviewRound[];
  clients: OverviewClient[];
  bundles: Bundle[];
  priceOf: (courseId: string) => number;
  weekKey: string;
}) {
  const statusOf = (round: OverviewRound) => round.status || 'new';
  const open = rounds.filter(round => statusOf(round) !== 'finished');
  const active = rounds.filter(round => statusOf(round) === 'active');
  const placed = new Set(open.flatMap(round => round.attendees.map(a => a.subscriberId)));
  // Per course: a client who sat a finished round of a course is not waiting
  // for it, and one placed in another course's round may still be waiting for this one.
  const seatedIn = new Map<string, Set<string>>();
  for (const round of rounds) {
    const seated = seatedIn.get(round.courseId) || new Set<string>();
    round.attendees.forEach(a => seated.add(a.subscriberId));
    seatedIn.set(round.courseId, seated);
  }
  const openCourses = [...new Set(open.map(round => round.courseId))];
  const waiting = clients.filter(client => openCourses.some(courseId => !seatedIn.get(courseId)?.has(client.id)
    && isEnrolledInCourse(bundles, client.enrolledCourseIds || [], courseId))).length;
  const held = active.filter(round => (round.heldWeeks || []).includes(weekKey)).length;
  const postponed = active.filter(round => (round.postponedWeeks || []).includes(weekKey)).length;
  let collected = 0, prior = 0, remaining = 0;
  // A client who holds a track sits in each of its courses' rounds with the track's
  // money on every one: counted once per track, not once per round.
  const counted = new Set<string>();
  for (const round of open) {
    for (const attendee of round.attendees) {
      const key = `${attendee.subscriberId}|${attendee.trackId || round.courseId}`;
      if (counted.has(key)) continue;
      counted.add(key);
      const money = attendeeMoney(attendee, priceOf(round.courseId));
      collected += money.collected;
      // Paid before the system is owed no more, though it is not collected in the period.
      prior += money.prior + money.applied;
      remaining += money.remaining;
    }
  }
  return {
    clients: clients.length,
    placed: placed.size,
    waiting,
    rounds: { active: active.length, fresh: open.length - active.length, finished: rounds.length - open.length },
    week: { held, postponed, unanswered: active.length - held - postponed },
    collected,
    prior,
    remaining,
  };
}

export const courseBundles = (bundles: Bundle[], courseId: string) =>
  bundles.filter(bundle => bundle.courses.some(course => course.id === courseId));
