import type { Bundle, Course, DaqqiDayOfWeek, DaqqiTimeSlot } from '../../../../types';

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
  startDate: new Date().toISOString().slice(0, 10),
  timeSlot: 'مساءً' as DaqqiTimeSlot,
});

export const calcCurrentLecture = (startDate: string, postponedWeeks?: string[]): number => {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const today = new Date();
  const daysDiff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const weeksElapsed = Math.max(0, Math.floor(daysDiff / 7));
  return Math.max(1, weeksElapsed + 1 - (postponedWeeks?.length || 0));
};

export const getCurrentWeekKey = (): string => {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
};

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

export const parseDaqqiRooms = (content: Record<string, string>) => {
  try {
    const raw = content['institute.branches'];
    if (!raw) return [] as { name: string; capacity: number }[];
    const branches: { id: string; label: string; rooms?: { name: string; capacity: number }[] }[] = JSON.parse(raw);
    const daqqiBranch = branches.find(branch =>
      normalizeDaqqiBranchId(branch.id) === 'DAQQI' || (branch.label || '').includes('دق')
    );
    return daqqiBranch?.rooms || [] as { name: string; capacity: number }[];
  } catch {
    return [] as { name: string; capacity: number }[];
  }
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
