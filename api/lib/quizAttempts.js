'use strict';

const { uuidv4 } = require('./id');
const { tryJson } = require('./helpers');
const { gradeQuizAttempt } = require('./quizGrading');
const { validateQuizAnswers } = require('./quizValidation');
const { completeCourse } = require('./courseCompletion');

/**
 * Persists the server-graded assessment attempt. Course completion is attempted
 * afterwards in its own transaction: an expected eligibility conflict keeps the
 * immutable attempt and is surfaced as completionPending; unexpected failures
 * are never silently swallowed.
 */
async function recordQuizAttempt({
  quiz, subscriberId, answers, tenantId, actor, completionService = completeCourse,
}, db) {
  const questions = tryJson(quiz.questions_json, []);
  const normalizedAnswers = validateQuizAnswers(questions, answers);
  const { score, passed, correctCount, total } = gradeQuizAttempt(
    questions, normalizedAnswers, quiz.passing_score
  );
  const id = uuidv4();
  await db.query(
    `INSERT INTO quiz_attempts
     (id,tenant_id,subscriber_id,quiz_id,course_id,score,passed,answers_json,taken_at)
     VALUES (?,?,?,?,?,?,?,?,NOW())`,
    [id, tenantId, subscriberId, quiz.id, quiz.course_id, score, passed ? 1 : 0,
      JSON.stringify(normalizedAnswers)]
  );

  let completion = null;
  let completionPending = false;
  if (passed) {
    try {
      completion = await completionService({
        tenantId, subscriberId, courseId: quiz.course_id, actor, requireFullProgress: true,
      });
    } catch (error) {
      if (error.statusCode !== 409) throw error;
      completionPending = true;
    }
  }
  return { id, score, passed, correctCount, total, completion, completionPending };
}

module.exports = { recordQuizAttempt };
