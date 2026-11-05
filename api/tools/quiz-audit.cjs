#!/usr/bin/env node
'use strict';

/**
 * Which quizzes cannot actually be taken? READ-ONLY.
 *
 *   node tools/quiz-audit.cjs
 *
 * A student's quiz is graded by the server against the quiz's own questions (lib/quizValidation.js): a quiz with no questions, one whose questions could not be read,
 * or a question that does not have four non-empty options and a correct answer among them answers «Quiz has no valid questions» (409) when a student submits — the
 * student sees the quiz and cannot pass it. This lists each such quiz with its course and why, and the courses that have no quiz at all, so the team knows what to fix
 * in «الاختبارات». It writes nothing.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function problemsOf(questionsJson) {
  let questions;
  try { questions = JSON.parse(questionsJson || '[]'); } catch { return ['questions could not be read (invalid JSON)']; }
  if (!Array.isArray(questions) || questions.length === 0) return ['no questions'];
  const problems = [];
  questions.forEach((question, index) => {
    const n = index + 1;
    if (!String(question?.question || '').trim()) problems.push(`question ${n}: empty text`);
    const options = Array.isArray(question?.options) ? question.options : [];
    if (options.length !== 4) problems.push(`question ${n}: ${options.length} options (needs 4)`);
    else if (options.some(option => !String(option ?? '').trim())) problems.push(`question ${n}: an empty option`);
    const correct = Number(question?.correctIndex);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) problems.push(`question ${n}: no valid correct answer`);
  });
  return problems;
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [quizzes] = await db.query(
    `SELECT q.id, q.tenant_id, q.title, q.course_id, q.questions_json, c.title AS course_title, c.is_published
       FROM course_quizzes q LEFT JOIN courses c ON c.id = q.course_id AND c.tenant_id = q.tenant_id ORDER BY c.title, q.title`);
  const bad = [];
  let questionCount = 0;
  for (const quiz of quizzes) {
    const problems = problemsOf(quiz.questions_json);
    try { const parsed = JSON.parse(quiz.questions_json || '[]'); if (Array.isArray(parsed)) questionCount += parsed.length; } catch { /* counted as a problem */ }
    if (problems.length) bad.push({ quiz, problems });
  }
  const [withoutQuiz] = await db.query(
    `SELECT c.id, c.title FROM courses c WHERE c.is_published = 1 AND c.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM course_quizzes q WHERE q.course_id = c.id AND q.tenant_id = c.tenant_id) ORDER BY c.title`);
  console.log(`quizzes: ${quizzes.length}, questions in them: ${questionCount}, quizzes a student cannot pass: ${bad.length}, published courses with no quiz: ${withoutQuiz.length}`);
  for (const { quiz, problems } of bad) {
    console.log(`\n  ✗ «${quiz.title}» — course «${quiz.course_title || quiz.course_id}»${Number(quiz.is_published) ? '' : ' (unpublished)'}  [${quiz.id}]`);
    problems.slice(0, 6).forEach(problem => console.log(`      - ${problem}`));
    if (problems.length > 6) console.log(`      … and ${problems.length - 6} more`);
  }
  if (withoutQuiz.length) {
    console.log('\npublished courses with no quiz:');
    withoutQuiz.forEach(course => console.log(`  - ${course.title} [${course.id}]`));
  }
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
