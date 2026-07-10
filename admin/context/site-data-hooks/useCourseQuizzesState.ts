import { useState } from 'react';
import type { CourseQuiz, QuizAttempt } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useCourseQuizzesState(
  initialCourseQuizzes: CourseQuiz[],
  initialQuizAttempts: QuizAttempt[],
  track: Track,
) {
  const [courseQuizzes, setCourseQuizzes] = useState<CourseQuiz[]>(initialCourseQuizzes);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>(initialQuizAttempts);

  const persistCourseQuizToCollection = (quiz: CourseQuiz) => {
    void mysqlAdmin.saveQuiz(quiz as unknown as Record<string,unknown>).catch(() => {});
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistQuizAttemptToCollection = (_item: QuizAttempt) => { /* PG-only */ };

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
    void mysqlAdmin.deleteQuiz(id).catch(() => {});
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

  return {
    courseQuizzes, setCourseQuizzes, addCourseQuiz, updateCourseQuiz, deleteCourseQuiz,
    quizAttempts, setQuizAttempts, addQuizAttempt, deleteQuizAttempt,
  };
}
