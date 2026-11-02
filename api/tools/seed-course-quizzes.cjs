#!/usr/bin/env node
'use strict';

/**
 * The 30-question final test of every course (2 Nov 2026, «30 سؤال اختباري لكل كورس»): one quiz per course, four choices a
 * question, written in api/tools/course-quiz-bank/<course slug>.json and shaped by lib/courseQuizBank.js.
 *
 *   node tools/seed-course-quizzes.cjs                        # the plan: which course gets a quiz, which already has others. Writes nothing.
 *   node tools/seed-course-quizzes.cjs --apply                # creates the quizzes (or refreshes the ones this tool made)
 *   node tools/seed-course-quizzes.cjs --apply --slug=cbt     # one course
 *   node tools/seed-course-quizzes.cjs --apply --required     # ALSO make passing it a condition of completing the course
 *
 * Not «required for completion» unless asked: a course's students already finishing it would otherwise be asked to pass a quiz
 * they never knew about, and a certificate that is issued on completion would wait on it. Turn it on from the quizzes screen
 * (or here) when the owner has read the questions.
 *
 * Each quiz has a fixed id derived from the course's slug, so running it again refreshes that quiz and never adds a second one,
 * and it never touches a quiz someone wrote by hand. A course the bank has a file for and the database has no course for is
 * listed and skipped. Reads the .env beside it.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { buildQuiz, problemsWith } = require('../lib/courseQuizBank');

const APPLY = process.argv.includes('--apply');
const REQUIRED = process.argv.includes('--required');
const arg = name => (process.argv.find(item => item.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
const ONLY = arg('slug');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const BANK = path.join(__dirname, 'course-quiz-bank');

// A stable uuid-shaped id from the slug: the same course always gets the same quiz id.
const quizId = slug => {
  const hex = crypto.createHash('sha1').update(`course-quiz-bank:${slug}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

(async () => {
  const files = fs.readdirSync(BANK).filter(name => name.endsWith('.json') && (!ONLY || name === `${ONLY}.json`)).sort();
  if (!files.length) { console.log('no bank file matches'); return; }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  let created = 0;
  let refreshed = 0;
  let skipped = 0;
  for (const file of files) {
    const slug = file.replace(/\.json$/, '');
    const bank = JSON.parse(fs.readFileSync(path.join(BANK, file), 'utf8'));
    const problems = problemsWith(bank);
    if (problems.length) { console.log(`✘ ${slug}: bank is not sound — ${problems.join('; ')}`); skipped += 1; continue; }
    const [[course]] = await db.query('SELECT id, title FROM courses WHERE tenant_id=? AND slug=? AND deleted_at IS NULL LIMIT 1', [TENANT, slug]);
    if (!course) { console.log(`- ${slug}: no such course in this database, skipped`); skipped += 1; continue; }
    const id = quizId(slug);
    const [others] = await db.query('SELECT id FROM course_quizzes WHERE tenant_id=? AND course_id=? AND id<>?', [TENANT, course.id, id]);
    const [[mine]] = await db.query('SELECT id FROM course_quizzes WHERE tenant_id=? AND id=?', [TENANT, id]);
    const quiz = buildQuiz(bank);
    console.log(`${mine ? '↻ refresh' : '+ create '} ${slug}: «${course.title.trim()}» — ${quiz.questions.length} questions${others.length ? `, beside ${others.length} quiz(zes) already on the course` : ''}`);
    if (!APPLY) continue;
    await db.query(
      `INSERT INTO course_quizzes (id, tenant_id, course_id, title, questions_json, passing_score, required_for_completion, generated_by_ai)
       VALUES (?,?,?,?,?,?,?,0)
       ON DUPLICATE KEY UPDATE title=VALUES(title), questions_json=VALUES(questions_json), passing_score=VALUES(passing_score),
         required_for_completion=VALUES(required_for_completion), updated_at=CURRENT_TIMESTAMP`,
      [id, TENANT, course.id, quiz.title, JSON.stringify(quiz.questions), quiz.passingScore, REQUIRED ? 1 : 0]);
    if (mine) refreshed += 1; else created += 1;
  }
  console.log(APPLY
    ? `\ncreated ${created}, refreshed ${refreshed}, skipped ${skipped}${REQUIRED ? '; passing is required for completion' : '; not required for completion'}`
    : `\nplan only — nothing was written (${files.length} bank file(s), ${skipped} skipped). Add --apply to write.`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
