'use strict';
/**
 * Core logic for POST /api/me/quiz-attempts (LMS-06). Extracted out of
 * api/routes/public.js the same way lib/orderPaymentConfirmation.js was, so it
 * can be exercised with a mock connection — the route itself keeps the
 * subscriber/quiz/enrollment lookups since those decide the 404/403 shape.
 *
 * `quiz` must be the FULL row read directly from course_quizzes (questions_json
 * still carrying correctIndex) — never the stripped shape mapQuiz() produces
 * for the public listing (LMS-05).
 *
 * `db` is only used for the quiz_attempts INSERT — completeCourse() always
 * manages its own transaction (no shared `conn` is passed to it) since a quiz
 * pass and the downstream course completion are independent facts: recording
 * the attempt must not roll back just because completion isn't eligible yet.
 */
const { uuidv4 } = require('./id');
const { tryJson } = require('./helpers');
const { gradeQuizAttempt } = require('./quizGrading');
const { completeCourse } = require('./courseCompletion');

async function recordQuizAttempt({ quiz, subscriberId, answers, tenantId, actor }, db) {
  const questions = tryJson(quiz.questions_json, []);
  const { score, passed, correctCount, total } = gradeQuizAttempt(questions, answers, quiz.passing_score);

  const id = uuidv4();
  await db.query(
    `INSERT INTO quiz_attempts (id, tenant_id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at)
     VALUES (?,?,?,?,?,?,?,?,NOW())`,
    [id, tenantId, subscriberId, quiz.id, quiz.course_id, score, passed ? 1 : 0, JSON.stringify(answers)]
  );

  if (passed) {
    // Best-effort: a quiz pass doesn't guarantee every lecture is watched
    // (completeCourse() enforces that itself, LMS-07) — a rejection here just
    // means "not done yet", not a failure of the attempt that was just recorded.
    await completeCourse({ tenantId, subscriberId, courseId: quiz.course_id, actor, requireFullProgress: true }).catch(() => {});
  }

  return { id, score, passed, correctCount, total };
}

module.exports = { recordQuizAttempt };
