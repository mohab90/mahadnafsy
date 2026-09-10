import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { CourseLectureItem, CourseChapterItem } from '../../types';
import { mysqlAdmin, mysqlCatalog } from '../../lib/mysqlapi';
import { fetchAllPages } from '../../../shared/fetchAllPages';

type Track = (action: string, entity: string, label: string) => void;
export function useLecturesChaptersState(
  initialLectures: CourseLectureItem[],
  initialChapters: CourseChapterItem[],
  lastLocalConfigWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [lectures, setLectures] = useState<CourseLectureItem[]>(initialLectures);
  const [chapters, setChapters] = useState<CourseChapterItem[]>(initialChapters);

  // The lectures table is the heaviest thing the admin can ask for — every
  // lecture of every course, half a megabyte of it — and five screens out of
  // roughly ninety read it. It used to be fetched on every login, by everyone,
  // including the sales rep who will never open a course.
  //
  // Now the screens that need it ask, through ensureLectures() below. This
  // stays as the unconditional refetch for after a write.
  //
  // The flat limit is gone with it. It was 2000 against 2392 published
  // lectures, and the endpoint orders by course, so the last courses in the
  // list had no lectures at all — silently, on every screen that counted them.
  const lecturesLoaded = useRef(false);
  const reloadLectures = useCallback(async () => {
    try {
      const [lRes, chRes] = await Promise.allSettled([
        fetchAllPages<unknown>((limit, offset) => mysqlCatalog.listLectures(limit, offset)),
        mysqlCatalog.listChapters(1000),
      ]);
      if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
        setLectures(lRes.value as unknown as CourseLectureItem[]);
      if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
        setChapters(chRes.value as unknown as CourseChapterItem[]);
      // Only a request the server actually answered counts as loaded. This
      // swallows its own errors, so without the flag a failed fetch is
      // indistinguishable from a successful one and would leave the screen
      // showing the seed rows for the rest of the session.
      lecturesLoaded.current = lRes.status === 'fulfilled';
    } catch { /* silent */ }
  }, []);

  // Fetch once per session, and only for a screen that actually reads the
  // rows. Concurrent callers share the one request — the courses screen and
  // its lectures panel both ask on the same mount — and a screen opened again
  // later does not refetch, because a write already updates the arrays in
  // place. A failed fetch clears the flag so the next screen retries rather
  // than inheriting an empty table.
  const lecturesRequest = useRef<Promise<void> | null>(null);
  const ensureLectures = useCallback(() => {
    if (lecturesLoaded.current) return Promise.resolve();
    if (!lecturesRequest.current) {
      lecturesRequest.current = reloadLectures().finally(() => {
        if (!lecturesLoaded.current) lecturesRequest.current = null;
      });
    }
    return lecturesRequest.current;
  }, [reloadLectures]);

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
    lectures, setLectures, addLecture, updateLecture, deleteLecture, reloadLectures, ensureLectures, getCourseLectures,
    chapters, setChapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
  };
}
