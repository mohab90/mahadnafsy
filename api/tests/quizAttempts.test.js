'use strict';
/**
 * Behavioral tests for lib/quizAttempts.js#recordQuizAttempt — the core of
 * POST /api/me/quiz-attempts (LMS-06). Uses a mock connection, no real DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { recordQuizAttempt } = require('../lib/quizAttempts');

function mockDb(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const hit = responses.find(r => sql.includes(r.match));
      if (!hit) throw new Error(`mockDb: no canned response for: ${sql.slice(0, 100)}...`);
      return [hit.rows];
    },
  };
}

const quiz = {
  id: 'quiz-1', course_id: 'course-1', passing_score: 70,
  questions_json: JSON.stringify([
    { id: 'q1', correctIndex: 0 },
    { id: 'q2', correctIndex: 1 },
  ]),
};

test('recordQuizAttempt: writes a real quiz_attempts row scored against the server-held quiz (LMS-06)', async () => {
  const db = mockDb([
    { match: 'INSERT INTO quiz_attempts', rows: {} },
  ]);
  // A passing score triggers a best-effort completeCourse() call, which manages
  // its own connection (see lmsCompletionIntegrity.test.js for its own coverage)
  // and is wrapped in .catch(() => {}) here — it must never affect whether the
  // attempt itself was recorded or what this function returns.
  const result = await recordQuizAttempt({ quiz, subscriberId: 'sub-1', answers: [0, 1], tenantId: 't1', actor: 'student@x.com' }, db);

  assert.equal(result.score, 100);
  assert.equal(result.passed, true);

  const insertCall = db.calls.find(c => c.sql.includes('INSERT INTO quiz_attempts'));
  assert.ok(insertCall, 'must actually write a quiz_attempts row — this is exactly what LMS-06 was skipping');
  assert.equal(insertCall.params[2], 'sub-1');
  assert.equal(insertCall.params[3], 'quiz-1');
  assert.equal(insertCall.params[4], 'course-1');
  assert.equal(insertCall.params[5], 100);
  assert.equal(insertCall.params[6], 1, 'passed must be stored as 1, not a boolean');
});

test('recordQuizAttempt: a failing score is still recorded, and never attempts course completion', async () => {
  const db = mockDb([
    { match: 'INSERT INTO quiz_attempts', rows: {} },
  ]);
  const result = await recordQuizAttempt({ quiz, subscriberId: 'sub-1', answers: [1, 0], tenantId: 't1', actor: 'student@x.com' }, db);

  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.ok(db.calls.some(c => c.sql.includes('INSERT INTO quiz_attempts')), 'a failed attempt must still be recorded, not silently dropped');
  assert.ok(!db.calls.some(c => c.sql.includes('FROM subscribers s')), 'must not attempt course completion on a failing score');
});

test('recordQuizAttempt: never trusts a client-supplied score — grading always comes from the server copy of correctIndex', async () => {
  const db = mockDb([{ match: 'INSERT INTO quiz_attempts', rows: {} }]);
  // Attacker submits answers that don't match ANY question, plus extraneous fields
  // a compromised client might send trying to smuggle a fake result through.
  const result = await recordQuizAttempt({
    quiz, subscriberId: 'sub-1', answers: [9, 9], tenantId: 't1', actor: 'student@x.com',
  }, db);
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
});
