import { useEffect, useState } from 'react';

// Each course's rating from its own students (GET /api/public/course-ratings,
// api/lib/courseRatings.js): a rating counts while the rater holds the course.
// One request per page load, shared by every card on the page.

export type CourseRating = { avg: number; count: number };
type Ratings = Record<string, CourseRating>;

let cached: Promise<Ratings> | null = null;
const fetchRatings = (): Promise<Ratings> => {
  if (!cached) {
    cached = fetch('/api/public/course-ratings')
      .then(r => (r.ok ? r.json() : {}))
      .then((d: { ratings?: Ratings }) => (d && typeof d.ratings === 'object' && d.ratings ? d.ratings : {}))
      .catch(() => ({} as Ratings));
  }
  return cached;
};

/** One course's verified rating, or null while loading or when it has none. */
export function useCourseRating(courseId: string | undefined | null): CourseRating | null {
  const [ratings, setRatings] = useState<Ratings>({});
  useEffect(() => {
    let alive = true;
    void fetchRatings().then(r => { if (alive) setRatings(r); });
    return () => { alive = false; };
  }, []);
  const rating = courseId ? ratings[courseId] : undefined;
  return rating && rating.count > 0 ? rating : null;
}
