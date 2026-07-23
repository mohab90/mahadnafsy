'use strict';
/**
 * Server-side quiz grading (LMS-06). Before this, StudentQuizTab.tsx compared
 * the student's picked option against question.correctIndex entirely in the
 * browser and never sent the result to the server — the correct answers were
 * also served to any unauthenticated visitor (LMS-05), and even a genuine
 * passing attempt never reached quiz_attempts unless an admin manually typed
 * it in via POST /api/admin/quiz-attempts. Pure function, no DB.
 */

// answers[i] is the option index the student picked for questions[i] (or -1/undefined
// if unanswered). Never trust a client-supplied score/passed — this recomputes both
// from the server's own copy of the quiz (which still has correctIndex).
function gradeQuizAttempt(questions, answers, passingScore) {
  const total = questions.length;
  let correct = 0;
  for (let i = 0; i < total; i++) {
    if (Number(answers?.[i]) === Number(questions[i].correctIndex)) correct++;
  }
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  const passed = score >= (Number(passingScore) || 0);
  return { score, passed, correctCount: correct, total };
}

module.exports = { gradeQuizAttempt };
