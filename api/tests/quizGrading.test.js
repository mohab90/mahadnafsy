'use strict';
/**
 * Behavioral tests for lib/quizGrading.js#gradeQuizAttempt — the server-side
 * grader that replaced StudentQuizTab.tsx's client-only comparison (LMS-06).
 * Pure function, no DB/mocking needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeQuizAttempt } = require('../lib/quizGrading');

const questions = [
  { id: 'q1', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
  { id: 'q2', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
  { id: 'q3', question: 'Q3', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
  { id: 'q4', question: 'Q4', options: ['a', 'b', 'c', 'd'], correctIndex: 3 },
];

test('gradeQuizAttempt: scores by comparing against the server-held correctIndex, not any client-supplied value', () => {
  const result = gradeQuizAttempt(questions, [0, 1, 0, 0], 70);
  assert.equal(result.correctCount, 2);
  assert.equal(result.total, 4);
  assert.equal(result.score, 50);
  assert.equal(result.passed, false, '50% must fail a 70% passing threshold');
});

test('gradeQuizAttempt: passes exactly at the passing score threshold', () => {
  const result = gradeQuizAttempt(questions, [0, 1, 2, 0], 75);
  assert.equal(result.score, 75);
  assert.equal(result.passed, true);
});

test('gradeQuizAttempt: a perfect run scores 100 and passes', () => {
  const result = gradeQuizAttempt(questions, [0, 1, 2, 3], 100);
  assert.equal(result.score, 100);
  assert.equal(result.passed, true);
});

test('gradeQuizAttempt: unanswered questions (-1/undefined) never accidentally match a correctIndex', () => {
  const withUnanswered = [{ id: 'q1', options: ['a', 'b'], correctIndex: undefined }];
  const result = gradeQuizAttempt(withUnanswered, [undefined], 50);
  assert.equal(result.correctCount, 0, 'undefined must never equal undefined via loose comparison here');
});

test('gradeQuizAttempt: empty question set scores 0, never divides by zero', () => {
  const result = gradeQuizAttempt([], [], 70);
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.total, 0);
});
