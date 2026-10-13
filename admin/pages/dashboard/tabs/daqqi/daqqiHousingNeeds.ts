import type { Bundle, DaqqiRound, SubscriberItem } from '../../../../types';
import { isEnrolledInCourse } from './daqqiScheduleUtils';

/**
 * Housing (التسكين) is per COURSE, not per client.
 *
 * «في الدقي عند التسكين للعميل اللي حاجز اكتر من كورس لما بنسكن كورس العميل كله
 * بيتسكن ودا غلط لو لسه في كورسات تانية محتاجة تسكين» (13 Oct 2026). A client who
 * booked two courses and was seated in one round counted as "housed": the clients
 * screen marked them 🏠 مسكن, the «غير مسكن» filter dropped them, and the list a round
 * is filled from (`assignedSubIds`: anyone in ANY round) left them out — so the second
 * course was never seated. Now a client is housed for a course when they sit in a round of
 * that course, and still needs housing while a course they hold that has a round has none.
 */
export type HousingNeed = {
  /** The courses of the rounds the client sits in. */
  housedCourseIds: string[];
  /** The codes of those rounds. */
  roundCodes: string[];
  /** Courses the client holds that have a round, and in none of whose rounds they sit. */
  missingCourseIds: string[];
};

type RoundSeats = Pick<DaqqiRound, 'id' | 'code' | 'courseId' | 'attendees'>;

/** Does the client sit in a round of THIS course? */
export const isHousedForCourse = (rounds: Pick<DaqqiRound, 'courseId' | 'attendees'>[], subscriberId: string, courseId: string): boolean =>
  rounds.some(round => round.courseId === courseId && (round.attendees ?? []).some(attendee => attendee.subscriberId === subscriberId));

export function housingNeedOf(rounds: RoundSeats[], bundles: Bundle[], subscriber: Pick<SubscriberItem, 'id' | 'enrolledCourseIds'>): HousingNeed {
  const housed = new Set<string>();
  const codes: string[] = [];
  for (const round of rounds) {
    if ((round.attendees ?? []).some(attendee => attendee.subscriberId === subscriber.id)) {
      housed.add(round.courseId);
      codes.push(round.code || String(round.id).slice(0, 6));
    }
  }
  const enrolled = subscriber.enrolledCourseIds || [];
  const withRounds = [...new Set(rounds.map(round => round.courseId))];
  return {
    housedCourseIds: [...housed],
    roundCodes: codes,
    missingCourseIds: withRounds.filter(courseId => !housed.has(courseId) && isEnrolledInCourse(bundles, enrolled, courseId)),
  };
}

/** Seated in a round for every course of theirs that has one. */
export const isFullyHoused = (need: HousingNeed): boolean => need.housedCourseIds.length > 0 && need.missingCourseIds.length === 0;

/** Not seated at all, or still missing a course. */
export const needsHousing = (need: HousingNeed): boolean => need.housedCourseIds.length === 0 || need.missingCourseIds.length > 0;
