import { useCallback, useState } from 'react';
import type { CourseLectureItem, CourseChapterItem } from '../../types';
import { mysqlCatalog } from '../../lib/mysqlapi';

/** Lectures + chapters: course curriculum content, fetched together with the catalog. */
export function useCourseCurriculum(
  initialLectures: CourseLectureItem[],
  initialChapters: CourseChapterItem[],
) {
  const [lectures, setLectures] = useState<CourseLectureItem[]>(initialLectures);
  const [chapters, setChapters] = useState<CourseChapterItem[]>(initialChapters);

  // Reload lectures + chapters from API (called when VideoPlayer opens without lectures loaded)
  const reloadLectures = useCallback(async () => {
    try {
      const [lRes, chRes] = await Promise.allSettled([
        mysqlCatalog.listLectures(2000),
        mysqlCatalog.listChapters(1000),
      ]);
      if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
        setLectures(lRes.value as unknown as CourseLectureItem[]);
      if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
        setChapters(chRes.value as unknown as CourseChapterItem[]);
    } catch { /* silent */ }
  }, []);

  const getCourseChapters = (courseId: string) =>
    chapters.filter((row) => row.courseId === courseId).sort((a, b) => a.order - b.order);

  const getCourseLectures = (courseId: string) => {
    const courseChapters = chapters.filter((c) => c.courseId === courseId);
    return lectures
      .filter((row) => row.courseId === courseId)
      .sort((a, b) => {
        // Sort by chapter order first, then by lecture order within the chapter.
        // This ensures limited-access slicing (first N videos) is always from the
        // beginning of the course, not interleaved across chapters.
        const chA = courseChapters.find((c) => c.id === a.chapterId)?.order ?? Infinity;
        const chB = courseChapters.find((c) => c.id === b.chapterId)?.order ?? Infinity;
        if (chA !== chB) return chA - chB;
        return a.order - b.order;
      });
  };

  return {
    lectures, setLectures, chapters, setChapters,
    getCourseChapters, getCourseLectures, reloadLectures,
  };
}
