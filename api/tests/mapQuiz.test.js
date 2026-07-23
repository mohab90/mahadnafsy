'use strict';
/**
 * Behavioral tests for lib/mappers.js#mapQuiz — the normalizer that splits the
 * public quiz listing from the admin one (LMS-05). Before this, GET /api/quizzes
 * returned raw DB rows (course_id/questions_json/passing_score snake_case,
 * questions_json still a JSON string) straight through res.json(rows) with no
 * auth at all — correctIndex included — to any visitor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapQuiz } = require('../lib/mappers');

const row = {
  id: 'quiz-1', course_id: 'course-1', title: 'Quiz One',
  questions_json: JSON.stringify([
    { id: 'q1', question: 'What is 2+2?', options: ['3', '4', '5', '6'], correctIndex: 1, explanation: 'Because 2+2=4' },
  ]),
  passing_score: 70, generated_by_ai: 1, source_material: 'notes.txt',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
};

test('mapQuiz: public shape (default) strips correctIndex and explanation from every question', () => {
  const quiz = mapQuiz(row);
  assert.equal(quiz.courseId, 'course-1', 'must normalize course_id to camelCase courseId');
  assert.equal(quiz.passingScore, 70);
  assert.equal(quiz.generatedByAI, true);
  assert.equal(quiz.questions.length, 1);
  assert.ok(!('correctIndex' in quiz.questions[0]), 'correctIndex must not leak to an unauthenticated caller (LMS-05)');
  assert.ok(!('explanation' in quiz.questions[0]), 'explanation can imply the answer, must also be stripped');
  assert.equal(quiz.questions[0].question, 'What is 2+2?', 'question text and options must still be present so students can take the quiz');
  assert.deepEqual(quiz.questions[0].options, ['3', '4', '5', '6']);
});

test('mapQuiz: admin shape (includeAnswers) keeps correctIndex so the editor can display/edit it', () => {
  const quiz = mapQuiz(row, { includeAnswers: true });
  assert.equal(quiz.questions[0].correctIndex, 1);
  assert.equal(quiz.questions[0].explanation, 'Because 2+2=4');
});

test('mapQuiz: a malformed questions_json degrades to an empty list instead of throwing', () => {
  const quiz = mapQuiz({ ...row, questions_json: 'not json' });
  assert.deepEqual(quiz.questions, []);
});
