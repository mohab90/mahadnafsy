import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { CourseLectureItem, CourseChapterItem } from '../../types';
import { mysqlAdmin, mysqlCatalog } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;
export function useLecturesChaptersState(
  initialLectures: CourseLectureItem[],
  initialChapters: CourseChapterItem[],
  lastLocalConfigWriteRef: MutableRefObject<number>,
  track: Track,
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

  // The server's own explanation is carried through. A save rejected because a
  // recorded lecture has no video yet, or because the course id is unknown,
  // should say so rather than surface as a generic "check your connection".
  const persistError = (field: string, name?: string, err?: unknown) => {
    const reason = err instanceof Error ? err.message : err ? String(err) : undefined;
    window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field, name, reason } }));
    return false;
  };

  const addLecture = async (item: CourseLectureItem): Promise<boolean> => {
    lastLocalConfigWriteRef.current = Date.now();
    try { await mysqlAdmin.saveLecture(item as unknown as Record<string,unknown>); }
    catch (err) { return persistError('lecture', item.title, err); }
    setLectures((prev) => [item, ...prev.filter(row => row.id !== item.id)]);
    track('create', 'lecture', item.title);
    return true;
  };

  const updateLecture = async (item: CourseLectureItem): Promise<boolean> => {
    lastLocalConfigWriteRef.current = Date.now();
    try { await mysqlAdmin.saveLecture(item as unknown as Record<string,unknown>); }
    catch (err) { return persistError('lecture', item.title, err); }
    setLectures((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    track('update', 'lecture', item.title);
    return true;
  };

  const deleteLecture = async (id: string): Promise<boolean> => {
    lastLocalConfigWriteRef.current = Date.now();
    const removed = lectures.find((row) => row.id === id);
    try { await mysqlAdmin.deleteLecture(id); }
    catch (err) { return persistError('lecture', removed?.title, err); }
    setLectures((prev) => prev.filter((row) => row.id !== id));
    track('delete', 'lecture', id);
    return true;
  };

  const addChapter = async (item: CourseChapterItem): Promise<boolean> => {
    lastLocalConfigWriteRef.current = Date.now();
    try { await mysqlAdmin.saveChapter(item as unknown as Record<string,unknown>); }
    catch (err) { return persistError('chapter', item.title, err); }
    setChapters((prev) => [...prev, item]);
    track('create', 'chapter', item.title);
    return true;
  };

  const updateChapter = async (item: CourseChapterItem): Promise<boolean> => {
    lastLocalConfigWriteRef.current = Date.now();
    try { await mysqlAdmin.saveChapter(item as unknown as Record<string,unknown>); }
    catch (err) { return persistError('chapter', item.title, err); }
    setChapters((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    track('update', 'chapter', item.title);
    return true;
  };

  const deleteChapter = async (id: string): Promise<boolean> => {
    lastLocalConfigWriteRef.current = Date.now();
    const removed = chapters.find(row => row.id === id);
    try { await mysqlAdmin.deleteChapter(id); }
    catch (err) { return persistError('chapter', removed?.title, err); }
    setChapters((prev) => prev.filter((row) => row.id !== id));
    setLectures((prev) => prev.map((row) => (row.chapterId === id ? { ...row, chapterId: undefined } : row)));
    track('delete', 'chapter', id);
    return true;
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

  return {
    lectures, setLectures, addLecture, updateLecture, deleteLecture, reloadLectures, getCourseLectures,
    chapters, setChapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
  };
}
