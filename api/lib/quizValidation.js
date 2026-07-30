'use strict';

const asBoundedText = (value, field, max) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) {
    const error = new Error(`${field} must contain 1-${max} characters`);
    error.statusCode = 400;
    throw error;
  }
  return text;
};

function normalizeQuizDefinition(input = {}) {
  const title = asBoundedText(input.title, 'title', 500);
  const passingScore = Number(input.passing_score ?? input.passingScore ?? 70);
  if (!Number.isFinite(passingScore) || passingScore < 1 || passingScore > 100) {
    const error = new Error('passingScore must be between 1 and 100');
    error.statusCode = 400;
    throw error;
  }
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 100) {
    const error = new Error('questions must contain 1-100 items');
    error.statusCode = 400;
    throw error;
  }
  const questions = input.questions.map((question, index) => {
    if (!Array.isArray(question?.options) || question.options.length !== 4) {
      const error = new Error(`questions[${index}].options must contain exactly 4 items`);
      error.statusCode = 400;
      throw error;
    }
    const correctIndex = Number(question.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      const error = new Error(`questions[${index}].correctIndex must be an integer from 0 to 3`);
      error.statusCode = 400;
      throw error;
    }
    return {
      ...question,
      question: asBoundedText(question.question, `questions[${index}].question`, 2000),
      options: question.options.map((option, optionIndex) =>
        asBoundedText(option, `questions[${index}].options[${optionIndex}]`, 1000)),
      correctIndex,
      explanation: String(question.explanation ?? '').trim().slice(0, 4000),
    };
  });
  return { title, passingScore, questions };
}

function validateQuizAnswers(questions, answers) {
  if (!Array.isArray(questions) || !questions.length) {
    const error = new Error('Quiz has no valid questions');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    const error = new Error(`answers must contain exactly ${questions.length} items`);
    error.statusCode = 400;
    throw error;
  }
  return answers.map((answer, index) => {
    const value = Number(answer);
    const optionCount = Array.isArray(questions[index]?.options) ? questions[index].options.length : 0;
    if (!Number.isInteger(value) || value < 0 || value >= optionCount) {
      const error = new Error(`answers[${index}] is not a valid option`);
      error.statusCode = 400;
      throw error;
    }
    return value;
  });
}

module.exports = { normalizeQuizDefinition, validateQuizAnswers };
