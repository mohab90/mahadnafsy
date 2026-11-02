'use strict';
/**
 * The question bank behind the 30-question final test of each course (2 Nov 2026, «30 سؤال اختباري لكل كورس»).
 *
 * A bank file (api/tools/course-quiz-bank/<course slug>.json) is written the short way: every question is
 * [question, the right answer, wrong answer, wrong answer, wrong answer]. Written like that there is no habit of putting the
 * right answer first or last in the file; the position is decided here, evenly (question n puts it at n mod 4), so a test
 * of 30 has the right answer 8, 8, 7 and 7 times under the four choices and cannot be passed by always picking one.
 *
 * Produces exactly what POST /api/admin/quizzes stores (lib/quizValidation.js): question, four options, correctIndex.
 */

const QUESTIONS_PER_COURSE = 30;

function placeAnswers(row, index) {
  const [question, right, ...wrong] = row;
  const correctIndex = index % 4;
  const options = [...wrong];
  options.splice(correctIndex, 0, right);
  return { question, options, correctIndex, explanation: '' };
}

/** bank: { title, questions: [[q, right, w1, w2, w3], …] } -> { title, passingScore, questions } */
function buildQuiz(bank) {
  return {
    title: bank.title,
    passingScore: 70,
    questions: bank.questions.map(placeAnswers),
  };
}

/** What is wrong with a bank, as a list of sentences; empty when it is sound. */
function problemsWith(bank) {
  const problems = [];
  if (!bank || typeof bank.title !== 'string' || !bank.title.trim()) problems.push('no title');
  const rows = bank && Array.isArray(bank.questions) ? bank.questions : [];
  if (rows.length !== QUESTIONS_PER_COURSE) problems.push(`${rows.length} questions, not ${QUESTIONS_PER_COURSE}`);
  const seen = new Set();
  rows.forEach((row, i) => {
    const label = `question ${i + 1}`;
    if (!Array.isArray(row) || row.length !== 5) { problems.push(`${label}: not [question, right, wrong, wrong, wrong]`); return; }
    if (row.some(cell => typeof cell !== 'string' || !cell.trim())) { problems.push(`${label}: an empty cell`); return; }
    const answers = row.slice(1).map(cell => cell.trim());
    if (new Set(answers).size !== 4) problems.push(`${label}: two answers are the same`);
    if (row[0].trim().length < 12) problems.push(`${label}: too short to be a question`);
    if (seen.has(row[0].trim())) problems.push(`${label}: asked twice`);
    seen.add(row[0].trim());
  });
  return problems;
}

module.exports = { QUESTIONS_PER_COURSE, buildQuiz, placeAnswers, problemsWith };
