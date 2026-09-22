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
  let answeredCount = 0;
  for (let i = 0; i < total; i++) {
    const given = Number(answers?.[i]);
    if (Number.isFinite(given) && given >= 0) answeredCount++;
    if (given === Number(questions[i].correctIndex)) correct++;
  }
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  // A quiz whose passing score is 0 or unset used to pass an attempt that
  // answered nothing: `0 >= 0`. An empty submission is not a pass — it is an
  // attempt that answered nothing, and a quiz with questions has to be
  // attempted. The floor stays whatever the quiz asks for above that.
  const required = Number(passingScore) || 0;
  const answeredSomething = total === 0 || answeredCount > 0;
  const passed = answeredSomething && score >= required;
  return { score, passed, correctCount: correct, total, answeredCount };
}

module.exports = { gradeQuizAttempt };
