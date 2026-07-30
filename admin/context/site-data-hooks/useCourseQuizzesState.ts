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

  const saveQuiz = async (item: CourseQuiz, action: 'create' | 'update') => {
    try {
      await mysqlAdmin.saveQuiz(item as unknown as Record<string, unknown>);
      setCourseQuizzes((prev) => action === 'create'
        ? [item, ...prev.filter((quiz) => quiz.courseId !== item.courseId)]
        : prev.map((quiz) => quiz.id === item.id ? item : quiz));
      track(action, 'courseQuiz', item.title);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'courseQuiz', name: item.title },
      }));
      return false;
    }
  };

  const deleteCourseQuiz = async (id: string) => {
    try {
      await mysqlAdmin.deleteQuiz(id);
      setCourseQuizzes((prev) => prev.filter((quiz) => quiz.id !== id));
      track('delete', 'courseQuiz', id);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'courseQuiz', name: id },
      }));
      return false;
    }
  };

  return {
    courseQuizzes, setCourseQuizzes,
    addCourseQuiz: (item: CourseQuiz) => saveQuiz(item, 'create'),
    updateCourseQuiz: (item: CourseQuiz) => saveQuiz(item, 'update'),
    deleteCourseQuiz,
    quizAttempts, setQuizAttempts,
  };
}
