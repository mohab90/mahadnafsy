/**
 * «مش عارف تبدأ منين؟» on the home page: the visitor picks an interest and is
 * shown the course most people in that interest take. Both the interests and
 * the recommendation come from the real course list — nothing is typed twice,
 * so a course the institute adds or reprices shows up here by itself.
 */
export type GoalCourse = {
  id: string;
  category?: string;
  students?: number;
  price?: Partial<Record<'EGP' | 'SAR' | 'USD', number>>;
};

export type Goal = { id: string; label: string; hint: string; count: number };

export const GOAL_TEXT: Record<string, { label: string; hint: string }> = {
  Therapy: { label: 'العلاج النفسي', hint: 'أدوات علاجية وتطبيق مع الحالات' },
  Diagnosis: { label: 'التشخيص والتقييم', hint: 'أدوات القياس وبناء التقييم' },
  Child: { label: 'الطفل والمراهق', hint: 'سلوك الطفل والتعامل مع الأسرة' },
  General: { label: 'أبدأ من الأساس', hint: 'أساسيات ومهارات عامة في المجال' },
};

const sellable = (course: GoalCourse): boolean =>
  Object.values(course.price || {}).some(value => Number(value) > 0);

const byDemand = (a: GoalCourse, b: GoalCourse): number =>
  (Number(b.students) || 0) - (Number(a.students) || 0) || String(a.id).localeCompare(String(b.id));

/** The interests worth offering: the categories with the most sellable courses (at most `max`). */
export function goalsFromCourses(courses: GoalCourse[], max = 3): Goal[] {
  const tally = new Map<string, number>();
  for (const course of courses) {
    if (!sellable(course) || !GOAL_TEXT[course.category || '']) continue;
    tally.set(course.category as string, (tally.get(course.category as string) || 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([id, count]) => ({ id, count, ...GOAL_TEXT[id] }));
}

/** The course most people take in this interest, or null when there is none. */
export function recommendedCourse<T extends GoalCourse>(courses: T[], goalId: string): T | null {
  const pool = courses.filter(course => course.category === goalId && sellable(course)).sort(byDemand);
  return pool[0] || null;
}
