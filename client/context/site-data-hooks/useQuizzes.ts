import { useEffect, useState } from 'react';
import type { CourseQuiz, QuizAttempt, AuthUser, SubscriberItem } from '../../types';
import { mysqlClient } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistCourseQuizToCollection = (_quiz: CourseQuiz) => { /* PG-only — no Firestore write */ };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistQuizAttemptToCollection = (_item: QuizAttempt) => { /* PG-only */ };

export function useQuizzes(
  initialCourseQuizzes: CourseQuiz[],
  initialQuizAttempts: QuizAttempt[],
  authUser: AuthUser | null | undefined,
  isAdmin: boolean,
  subscribers: SubscriberItem[],
  track: Track,
) {
  const [courseQuizzes, setCourseQuizzes] = useState<CourseQuiz[]>(initialCourseQuizzes);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>(initialQuizAttempts);

  // ── Per-user quizAttempts loader ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.uid || isAdmin) return;
    let cancelled = false;
    const sub = subscribers.find(s => s.email?.toLowerCase().trim() === (authUser.email || '').toLowerCase().trim());
    const sid = sub?.id ?? authUser.uid;
    mysqlClient.getMyQuizAttempts(sid).then((list) => {
      if (cancelled) return;
      setQuizAttempts((list as unknown as QuizAttempt[]).sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin, subscribers]);

  const addCourseQuiz = (item: CourseQuiz) => {
    setCourseQuizzes((prev) => [item, ...prev.filter((q) => q.courseId !== item.courseId)]);
    persistCourseQuizToCollection(item);
    track('create', 'courseQuiz', item.title);
  };

  const updateCourseQuiz = (item: CourseQuiz) => {
    setCourseQuizzes((prev) => prev.map((q) => (q.id === item.id ? item : q)));
    persistCourseQuizToCollection(item);
    track('update', 'courseQuiz', item.title);
  };

  const deleteCourseQuiz = (id: string) => {
    setCourseQuizzes((prev) => prev.filter((q) => q.id !== id));
    track('delete', 'courseQuiz', id);
  };

  const addQuizAttempt = (item: QuizAttempt) => {
    setQuizAttempts((prev) => [item, ...prev]);
    persistQuizAttemptToCollection(item);
    track('create', 'quizAttempt', `${item.subscriberId} score ${item.score}%`);
  };

  const deleteQuizAttempt = (id: string) => {
    setQuizAttempts((prev) => prev.filter((a) => a.id !== id));
    track('delete', 'quizAttempt', id);
  };

  const resetQuizzes = () => {
    setCourseQuizzes([]);
    setQuizAttempts([]);
  };

  return {
    courseQuizzes, addCourseQuiz, updateCourseQuiz, deleteCourseQuiz,
    quizAttempts, addQuizAttempt, deleteQuizAttempt,
    resetQuizzes,
  };
}
