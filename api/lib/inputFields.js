'use strict';

// Reading the fields a client sent, and refusing the wrong type instead of
// coercing it. String() on an object stored «[object Object]», Number('abc')
// reached MySQL as NaN and came back as a 500, and a negative price was saved
// and shown on the site. Each reader throws a FieldError carrying an Arabic
// message the route answers with as a 400.

class FieldError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'FieldError';
    this.field = field;
    this.status = 400;
  }
}

const blank = value => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * A short text field. Numbers are accepted as text (a phone typed as digits);
 * objects, arrays and booleans are refused. Returns '' when absent.
 */
function textValue(value, { field, label = field, max = 1000, required = false } = {}) {
  if (blank(value)) {
    if (required) throw new FieldError(field, `${label} مطلوب.`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new FieldError(field, `${label} لازم يكون نص.`);
  }
  const text = String(value).trim();
  if (text.length > max) throw new FieldError(field, `${label} أطول من ${max} حرف.`);
  return text;
}

/**
 * A number field. Numeric strings are accepted ('150'); anything else that is
 * not a finite number is refused, as is a value outside [min, max]. Returns
 * `fallback` when absent.
 */
function numberValue(value, { field, label = field, min = -Infinity, max = Infinity, integer = false, required = false, fallback = null } = {}) {
  if (blank(value)) {
    if (required) throw new FieldError(field, `${label} مطلوب.`);
    return fallback;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new FieldError(field, `${label} لازم يكون رقم.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new FieldError(field, `${label} لازم يكون رقم.`);
  if (integer && !Number.isInteger(number)) throw new FieldError(field, `${label} لازم يكون رقم صحيح.`);
  if (number < min) throw new FieldError(field, min === 0 ? `${label} لا يمكن أن يكون بالسالب.` : `${label} لازم يكون ${min} أو أكثر.`);
  if (number > max) throw new FieldError(field, `${label} لازم يكون ${max} أو أقل.`);
  return number;
}

/**
 * Middleware for a public form: each named field, when sent, must be a string,
 * number or boolean. An object or a list where a name or a phone belongs was
 * stored as «[object Object]», or reached MySQL as `key` = 'value' and failed
 * there with a 500.
 */
function scalarFields(...fields) {
  return (req, res, next) => {
    const body = req.body;
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      return res.status(400).json({ error: 'البيانات المرسلة غير صحيحة.', code: 'INVALID_BODY' });
    }
    for (const field of fields) {
      const value = body?.[field];
      if (value !== undefined && value !== null && typeof value === 'object') {
        return res.status(400).json({ error: `الحقل ${field} لازم يكون نص أو رقم.`, field, code: 'INVALID_FIELD' });
      }
    }
    return next();
  };
}

/** Answers a FieldError as a 400; returns false for anything else. */
function sendFieldError(res, error) {
  if (!(error instanceof FieldError)) return false;
  res.status(400).json({ error: error.message, field: error.field, code: 'INVALID_FIELD' });
  return true;
}

module.exports = { FieldError, textValue, numberValue, scalarFields, sendFieldError };
