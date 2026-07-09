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
  addQuizAttempt: (attempt: QuizAttempt) => void;
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
  addQuizAttempt,
}: Props) {
  if (!subscriber) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
        <CheckCircle size={36} className="mx-auto mb-3 text-gray-200" />
        <p className="text-gray-500">اشترك في كورس لأداء الاختبارات</p>
      </div>
    );
  }

  const activeQuizData = quizModal ? courseQuizzes.find(quiz => quiz.id === quizModal.quizId) : null;

  const handleSubmitQuiz = () => {
    if (!activeQuizData || !subscriber) return;
    let correct = 0;
    activeQuizData.questions.forEach((question, index) => {
      if (quizAnswers[index] === question.correctIndex) correct++;
    });
    const score = Math.round((correct / activeQuizData.questions.length) * 100);
    const passed = score >= activeQuizData.passingScore;
    setQuizScore(score);
    setQuizSubmitted(true);
    addQuizAttempt({
      id: `qa-${Date.now()}`,
      subscriberId: subscriber.id,
      courseId: activeQuizData.courseId,
      quizId: activeQuizData.id,
      answers: quizAnswers,
      score,
      passed,
      takenAt: new Date().toISOString(),
    });
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
            const quiz = courseQuizzes.find(item => item.courseId === String(course.id));
            const attempts = quizAttempts.filter(attempt => attempt.courseId === String(course.id) && attempt.subscriberId === subscriber.id);
            const bestAttempt = attempts.length > 0 ? attempts.reduce((best, attempt) => attempt.score > best.score ? attempt : best) : null;

            return (
              <div key={course.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-start gap-3">
                  {course.thumbnail && <img src={course.thumbnail} alt="" loading="lazy" decoding="async" className="h-12 w-12 flex-shrink-0 rounded-xl object-cover" />}
                  <div>
                    <p className="text-sm font-bold leading-snug text-gray-800">{course.title}</p>
                    {quiz && <p className="mt-0.5 text-xs text-gray-400">{quiz.questions.length} سؤال - النجاح {quiz.passingScore}%</p>}
                  </div>
                </div>

                {bestAttempt && (
                  <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${bestAttempt.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    {bestAttempt.passed ? 'ناجح' : 'راسب'} - أفضل نتيجة: {bestAttempt.score}%
                    <span className="mr-auto font-normal text-gray-500">{attempts.length} محاولة</span>
                  </div>
                )}

                {quiz ? (
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
                ) : (
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
                    onClick={handleSubmitQuiz}
                    disabled={quizAnswers.some(answer => answer === -1)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3.5 text-base font-bold text-white transition hover:bg-primary-700 disabled:opacity-50"
                  >
                    <CheckCircle size={18} /> إرسال الإجابات
                  </button>
                  {quizAnswers.some(answer => answer === -1) && (
                    <p className="text-center text-xs text-gray-400">أجب على جميع الأسئلة قبل الإرسال</p>
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
