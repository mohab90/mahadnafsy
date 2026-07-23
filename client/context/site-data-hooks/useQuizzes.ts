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

  // Grades server-side (LMS-06) — the server holds the only copy of correctIndex
  // that's ever sent over the wire (the public quiz listing strips it, LMS-05),
  // so a tampered client can no longer submit a fabricated score/passed.
  const submitQuizAttempt = async (quiz: CourseQuiz, subscriberId: string, answers: number[]) => {
    const result = await mysqlClient.submitQuizAttempt(quiz.id, answers);
    const attempt: QuizAttempt = {
      id: result.id,
      subscriberId,
      courseId: quiz.courseId,
      quizId: quiz.id,
      answers,
      score: result.score,
      passed: result.passed,
      takenAt: new Date().toISOString(),
    };
    setQuizAttempts((prev) => [attempt, ...prev]);
    persistQuizAttemptToCollection(attempt);
    track('create', 'quizAttempt', `${subscriberId} score ${result.score}%`);
    return result;
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
    quizAttempts, submitQuizAttempt, deleteQuizAttempt,
    resetQuizzes,
  };
}
