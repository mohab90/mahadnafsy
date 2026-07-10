import { useCallback, useRef, useState } from 'react';
import type { CourseLectureItem, CourseChapterItem } from '../../types';
import { mysqlCatalog, mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistLectureToCollection = (_lecture: CourseLectureItem) => { /* PG-only — no Firestore write */ };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistChapterToCollection = (_chapter: CourseChapterItem) => { /* PG-only — no Firestore write */ };

/** Lectures + chapters: course curriculum content, fetched together with the catalog. */
export function useCourseCurriculum(
  initialLectures: CourseLectureItem[],
  initialChapters: CourseChapterItem[],
  track: Track,
) {
  const [lectures, setLectures] = useState<CourseLectureItem[]>(initialLectures);
  const [chapters, setChapters] = useState<CourseChapterItem[]>(initialChapters);
  const lastLocalConfigWriteRef = useRef(0);

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

  const addLecture = (item: CourseLectureItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => [item, ...prev]);
    persistLectureToCollection(item);
    void mysqlAdmin.saveLecture(item as unknown as Record<string, unknown>);
    track('create', 'lecture', item.title);
  };

  const updateLecture = (item: CourseLectureItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistLectureToCollection(item);
    void mysqlAdmin.saveLecture(item as unknown as Record<string, unknown>);
    track('update', 'lecture', item.title);
  };

  const deleteLecture = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteLecture(id);
    track('delete', 'lecture', id);
  };

  const addChapter = (item: CourseChapterItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => [...prev, item]);
    persistChapterToCollection(item);
    void mysqlAdmin.saveChapter(item as unknown as Record<string, unknown>);
    track('create', 'chapter', item.title);
  };

  const updateChapter = (item: CourseChapterItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistChapterToCollection(item);
    void mysqlAdmin.saveChapter(item as unknown as Record<string, unknown>);
    track('update', 'chapter', item.title);
  };

  const deleteChapter = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteChapter(id);
    // Unlink lectures belonging to deleted chapter and persist updated lectures
    setLectures((prev) => {
      const updated = prev.map((row) => (row.chapterId === id ? { ...row, chapterId: undefined } : row));
      updated.filter(r => r.chapterId === undefined && prev.find(p => p.id === r.id)?.chapterId === id)
        .forEach(r => persistLectureToCollection(r));
      return updated;
    });
    track('delete', 'chapter', id);
  };

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

  const resetCurriculum = (defaultLectures: CourseLectureItem[]) => {
    setLectures(defaultLectures);
    setChapters([]);
  };

  return {
    lectures, setLectures, chapters, setChapters,
    addLecture, updateLecture, deleteLecture,
    addChapter, updateChapter, deleteChapter,
    getCourseChapters, getCourseLectures, reloadLectures, resetCurriculum,
  };
}
