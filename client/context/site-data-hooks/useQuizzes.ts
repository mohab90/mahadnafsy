import { useEffect, useState } from 'react';
import type { CourseQuiz, QuizAttempt, AuthUser, SubscriberItem } from '../../types';
import { mysqlCatalog, mysqlClient } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

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

  useEffect(() => {
    if (!authUser?.uid || isAdmin) return;
    let cancelled = false;
    void mysqlCatalog.listQuizzes().then((list) => {
      if (!cancelled) setCourseQuizzes(list as unknown as CourseQuiz[]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [authUser?.uid, isAdmin]);

  // ── Per-user quizAttempts loader ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.uid || isAdmin) return;
    let cancelled = false;
    mysqlClient.getMyQuizAttempts().then((list) => {
      if (cancelled) return;
      setQuizAttempts((list as unknown as QuizAttempt[]).sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin, subscribers]);

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
    track('create', 'quizAttempt', `${subscriberId} score ${result.score}%`);
    return result;
  };

  return {
    courseQuizzes, quizAttempts, submitQuizAttempt,
  };
}
