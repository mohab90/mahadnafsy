import type { Bundle, Course, DaqqiDayOfWeek, DaqqiTimeSlot } from '../../../../types';
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

export const courseBundles = (bundles: Bundle[], courseId: string) =>
  bundles.filter(bundle => bundle.courses.some(course => course.id === courseId));
