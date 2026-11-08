'use strict';
/**
 * 2 Nov 2026, «لكل كورس 30 سؤال اختباري … اختر بين القوسين». The bank behind each course's final test:
 * 30 questions, four choices, one right answer, the right answer's position even, and nothing that gives the right answer away.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { QUESTIONS_PER_COURSE, buildQuiz, problemsWith } = require('../lib/courseQuizBank');
const { normalizeQuizDefinition } = require('../lib/quizValidation');

const DIR = path.join(__dirname, '..', 'tools', 'course-quiz-bank');
const files = fs.readdirSync(DIR).filter(name => name.endsWith('.json')).sort();
const bankOf = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));

test('there is a bank for each of the 26 courses the site sells', () => {
  assert.equal(files.length, 26);
  for (const file of files) assert.match(file, /^[a-z0-9-]+\.json$/, `${file}: a course slug`);
});

test('every bank is 30 sound questions, four different choices each, none asked twice', () => {
  for (const file of files) assert.deepEqual(problemsWith(bankOf(file)), [], file);
  assert.equal(QUESTIONS_PER_COURSE, 30);
});

test('what is stored is what POST /api/admin/quizzes accepts: four options, an index 0-3, and the right answer is where the index says', () => {
  for (const file of files) {
    const bank = bankOf(file);
    const quiz = buildQuiz(bank);
    const stored = normalizeQuizDefinition({ title: quiz.title, passingScore: quiz.passingScore, questions: quiz.questions });
    assert.equal(stored.questions.length, 30, file);
    stored.questions.forEach((question, i) => {
      assert.equal(question.options[question.correctIndex], bank.questions[i][1], `${file} #${i + 1}: the right answer is at correctIndex`);
      assert.equal(new Set(question.options).size, 4, `${file} #${i + 1}`);
    });
  }
});

test('the right answer is spread evenly under the four choices, so one letter cannot pass the test', () => {
  for (const file of files) {
    const counts = [0, 0, 0, 0];
    buildQuiz(bankOf(file)).questions.forEach(question => { counts[question.correctIndex] += 1; });
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${file}: ${counts.join('/')}`);
  }
});

test('the right answer is not the longest, or the shortest, of its choices more often than a student could guess by it', () => {
  // Written naturally the right answer is the long, careful one (94% of the first draft). A student who picks the longest choice
  // passes without knowing the subject. Random would be a quarter; these limits leave room for honest variation.
  let longest = 0;
  let shortest = 0;
  let total = 0;
  for (const file of files) {
    let fileLongest = 0;
    let fileShortest = 0;
    for (const row of bankOf(file).questions) {
      const lengths = row.slice(1).map(cell => cell.length);
      const unique = predicate => lengths.filter(predicate).length === 1;
      if (lengths[0] === Math.max(...lengths) && unique(n => n === lengths[0])) fileLongest += 1;
      if (lengths[0] === Math.min(...lengths) && unique(n => n === lengths[0])) fileShortest += 1;
      total += 1;
    }
    assert.ok(fileLongest <= 18, `${file}: the right answer is the longest in ${fileLongest} of 30`);
    assert.ok(fileShortest <= 22, `${file}: the right answer is the shortest in ${fileShortest} of 30`);
    longest += fileLongest;
    shortest += fileShortest;
  }
  assert.ok(longest / total <= 0.45, `longest in ${longest} of ${total}`);
  assert.ok(shortest / total <= 0.45, `shortest in ${shortest} of ${total}`);
});


