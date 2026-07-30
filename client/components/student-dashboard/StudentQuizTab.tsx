import { useState } from 'react';
import { CheckCircle, X } from 'lucide-react';

import type { Course, CourseQuiz, QuizAttempt, SubscriberItem } from '../../types';

type QuizModalState = {
  courseId: string;
  quizId: string;
} | null;

type Props = {
  subscriber: SubscriberItem | undefined;
  enrolledCourses: Course[];
  courseQuizzes: CourseQuiz[];
  quizAttempts: QuizAttempt[];
  quizModal: QuizModalState;
  quizAnswers: number[];
  quizSubmitted: boolean;
  quizScore: number;
  setQuizModal: (value: QuizModalState) => void;
  setQuizAnswers: (value: number[]) => void;
  setQuizSubmitted: (value: boolean) => void;
  setQuizScore: (value: number) => void;
  submitQuizAttempt: (quiz: CourseQuiz, subscriberId: string, answers: number[]) => Promise<{ score: number; passed: boolean }>;
};

export function StudentQuizTab({
  subscriber,
  enrolledCourses,
  courseQuizzes,
  quizAttempts,
  quizModal,
  quizAnswers,
  quizSubmitted,
  quizScore,
  setQuizModal,
  setQuizAnswers,
  setQuizSubmitted,
  setQuizScore,
  submitQuizAttempt,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  if (!subscriber) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
        <CheckCircle size={36} className="mx-auto mb-3 text-gray-200" />
        <p className="text-gray-500">اشترك في كورس لأداء الاختبارات</p>
      </div>
    );
  }

  const activeQuizData = quizModal ? courseQuizzes.find(quiz => quiz.id === quizModal.quizId) : null;

  const handleSubmitQuiz = async () => {
    if (!activeQuizData || !subscriber) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      // Grading happens on the server against its own copy of correctIndex
      // (LMS-06) — the quiz data here never carries it (LMS-05), so there is
      // nothing to compute or trust client-side.
      const result = await submitQuizAttempt(activeQuizData, subscriber.id, quizAnswers);
      setQuizScore(result.score);
      setQuizSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'تعذر إرسال الإجابات');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <h3 className="flex items-center gap-2 text-base font-extrabold text-gray-800">
        <CheckCircle size={18} className="text-primary-600" /> اختباراتي
      </h3>

      {enrolledCourses.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
          <p className="text-gray-400">اشترك في كورس لأداء الاختبارات</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {enrolledCourses.map(course => {
            const quizzes = courseQuizzes.filter(item => item.courseId === String(course.id));

            return (
              <div key={course.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-start gap-3">
                  {course.thumbnail && <img src={course.thumbnail} alt="" className="h-12 w-12 flex-shrink-0 rounded-xl object-cover" />}
                  <div>
                    <p className="text-sm font-bold leading-snug text-gray-800">{course.title}</p>
                    {quizzes.length > 0 && <p className="mt-0.5 text-xs text-gray-400">{quizzes.length} اختبار</p>}
                  </div>
                </div>

                {quizzes.length ? quizzes.map(quiz => {
                  const attempts = quizAttempts.filter(attempt =>
                    attempt.quizId === quiz.id && attempt.subscriberId === subscriber.id);
                  const bestAttempt = attempts.length
                    ? attempts.reduce((best, attempt) => attempt.score > best.score ? attempt : best)
                    : null;
                  return (
                    <div key={quiz.id} className="mt-3 rounded-xl border border-gray-100 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-gray-700">{quiz.title}</p>
                          <p className="text-[11px] text-gray-400">{quiz.questions.length} سؤال - النجاح {quiz.passingScore}%</p>
                        </div>
                        {bestAttempt && (
                          <span className={`rounded-lg px-2 py-1 text-[11px] font-bold ${bestAttempt.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                            {bestAttempt.score}% · {attempts.length} محاولة
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setQuizModal({ courseId: String(course.id), quizId: quiz.id });
                          setQuizAnswers(new Array(quiz.questions.length).fill(-1));
                          setQuizSubmitted(false);
                          setQuizScore(0);
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700"
                      >
                        <CheckCircle size={15} /> {bestAttempt ? 'إعادة الاختبار' : 'ابدأ الاختبار'}
                      </button>
                    </div>
                  );
                }) : (
                  <div className="rounded-xl bg-gray-50 py-2 text-center text-xs text-gray-400">لا يوجد اختبار لهذا الكورس بعد</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {quizModal && activeQuizData && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" dir="rtl">
          <div className="my-8 w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-3xl bg-gradient-to-r from-primary-700 to-primary-900 px-6 py-5 text-white">
              <div>
                <p className="text-base font-extrabold">{activeQuizData.title}</p>
                <p className="mt-0.5 text-xs text-primary-200">{activeQuizData.questions.length} سؤال - النجاح {activeQuizData.passingScore}%</p>
              </div>
              <button onClick={() => setQuizModal(null)} className="text-white/60 hover:text-white"><X size={22} /></button>
            </div>

            <div className="p-6">
              {quizSubmitted ? (
                <div className="space-y-4 py-8 text-center">
                  <div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-4xl font-extrabold ${quizScore >= activeQuizData.passingScore ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {quizScore}%
                  </div>
                  <p className={`text-xl font-extrabold ${quizScore >= activeQuizData.passingScore ? 'text-green-700' : 'text-red-600'}`}>
                    {quizScore >= activeQuizData.passingScore ? 'تهانينا! اجتزت الاختبار' : 'لم تتجاوز الاختبار - حاول مرة أخرى'}
                  </p>
                  <p className="text-sm text-gray-500">حصلت على {quizScore}% - الحد الأدنى للنجاح {activeQuizData.passingScore}%</p>
                  <div className="flex justify-center gap-3">
                    <button onClick={() => setQuizModal(null)} className="rounded-xl bg-gray-100 px-6 py-2.5 font-bold text-gray-700">إغلاق</button>
                    <button onClick={() => { setQuizAnswers(new Array(activeQuizData.questions.length).fill(-1)); setQuizSubmitted(false); }} className="rounded-xl bg-primary-600 px-6 py-2.5 font-bold text-white transition hover:bg-primary-700">إعادة المحاولة</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {activeQuizData.questions.map((question, index) => (
                    <div key={question.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <p className="mb-3 text-sm font-bold text-gray-800">{index + 1}. {question.question}</p>
                      <div className="space-y-2">
                        {question.options.map((option, optionIndex) => (
                          <button
                            key={optionIndex}
                            onClick={() => {
                              const nextAnswers = [...quizAnswers];
                              nextAnswers[index] = optionIndex;
                              setQuizAnswers(nextAnswers);
                            }}
                            className={[
                              'w-full rounded-xl border px-4 py-2.5 text-right text-sm font-medium transition',
                              quizAnswers[index] === optionIndex
                                ? 'border-primary-600 bg-primary-600 text-white'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-primary-400',
                            ].join(' ')}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => { void handleSubmitQuiz(); }}
                    disabled={submitting || quizAnswers.some(answer => answer === -1)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3.5 text-base font-bold text-white transition hover:bg-primary-700 disabled:opacity-50"
                  >
                    <CheckCircle size={18} /> {submitting ? 'جارٍ الإرسال...' : 'إرسال الإجابات'}
                  </button>
                  {quizAnswers.some(answer => answer === -1) && (
                    <p className="text-center text-xs text-gray-400">أجب على جميع الأسئلة قبل الإرسال</p>
                  )}
                  {submitError && (
                    <p className="text-center text-xs text-red-500">{submitError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
