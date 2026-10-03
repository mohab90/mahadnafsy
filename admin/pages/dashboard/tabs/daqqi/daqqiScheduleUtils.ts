import type { Bundle, Course, DaqqiDayOfWeek, DaqqiRound, DaqqiTimeSlot } from '../../../../types';
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

export const enrolledLabels = (courses: Course[], bundles: Bundle[], enrolledIds: string[]): string[] =>
  enrolledIds.map(courseId => {
    if (courseId.startsWith('bundle:')) {
      const bundle = bundles.find(item => item.id === courseId.replace('bundle:', ''));
      return bundle ? `مسار: ${bundle.title}` : null;
    }
    const course = courses.find(item => item.id === courseId);
    return course ? (course.titleAr || course.title) : null;
  }).filter(Boolean) as string[];

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
  let collected = 0, remaining = 0;
  for (const round of open) {
    const paid = round.attendees.reduce((sum, a) => sum + (Number(a.amountPaid) || 0), 0);
    collected += paid;
    // Paid before the system is owed no more, though it is not collected in the period.
    const prior = round.attendees.reduce((sum, a) => sum + (Number(a.amountPrior) || 0), 0);
    remaining += Math.max(0, priceOf(round.courseId) * round.attendees.length - paid - prior);
  }
  return {
    clients: clients.length,
    placed: placed.size,
    waiting,
    rounds: { active: active.length, fresh: open.length - active.length, finished: rounds.length - open.length },
    week: { held, postponed, unanswered: active.length - held - postponed },
    collected,
    remaining,
  };
}

export const courseBundles = (bundles: Bundle[], courseId: string) =>
  bundles.filter(bundle => bundle.courses.some(course => course.id === courseId));
