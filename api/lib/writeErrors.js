'use strict';
/**
 * The answer a screen gets when a write is refused.
 *
 * Route handlers end with `res.status(500).json({ error: 'Internal server
 * error' })`, and the screens print that string. That is right for a real
 * fault — an internal error should not describe itself to a browser — but it
 * was also the answer to conditions the person at the keyboard could have
 * fixed in seconds. It is how «تعذر إنشاء الموظف» came to mean a taken email,
 * a blank name and a genuine bug alike, and why nobody could tell which of
 * five gates had refused them.
 *
 * MySQL names those conditions precisely. Only the ones a user causes are
 * translated; anything else stays a 500 and stays quiet about itself.
 *
 * Deliberately free of db, auth and logger imports, so a test can exercise the
 * mapping without standing up the server.
 */

const USER_CORRECTABLE = Object.freeze({
  ER_DUP_ENTRY: [409, 'فيه سجل بنفس البيانات دي بالفعل', 'DUPLICATE'],
  ER_NO_REFERENCED_ROW: [409, 'واحد من الحقول المرتبطة مش موجود — راجع الموظف أو الفرع المختار', 'MISSING_REFERENCE'],
  ER_NO_REFERENCED_ROW_2: [409, 'واحد من الحقول المرتبطة مش موجود — راجع الموظف أو الفرع المختار', 'MISSING_REFERENCE'],
  ER_ROW_IS_REFERENCED: [409, 'مش ممكن الحذف: فيه سجلات مرتبطة بالبند ده', 'STILL_REFERENCED'],
  ER_ROW_IS_REFERENCED_2: [409, 'مش ممكن الحذف: فيه سجلات مرتبطة بالبند ده', 'STILL_REFERENCED'],
  ER_BAD_NULL_ERROR: [400, 'فيه حقل مطلوب مسيب فاضي', 'MISSING_FIELD'],
  ER_DATA_TOO_LONG: [400, 'قيمة أطول من المسموح في واحد من الحقول', 'VALUE_TOO_LONG'],
  ER_TRUNCATED_WRONG_VALUE: [400, 'قيمة مش مقبولة في واحد من الحقول — راجع التواريخ والأرقام', 'INVALID_VALUE'],
  ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [400, 'قيمة مش مقبولة في واحد من الحقول — راجع التواريخ والأرقام', 'INVALID_VALUE'],
  WARN_DATA_TRUNCATED: [400, 'قيمة مش مقبولة في واحد من الحقول — راجع التواريخ والأرقام', 'INVALID_VALUE'],
});

/** The response for an error, or null when it is not the user's to fix. */
function describeWriteError(error) {
  const mapped = error && USER_CORRECTABLE[error.code];
  if (!mapped) return null;
  const [status, message, code] = mapped;
  return { status, body: { error: message, code } };
}

/**
 * Send it. Falls through to the generic 500 for anything unrecognised, so a
 * real fault is still not described to the browser.
 */
function sendWriteError(res, error) {
  const described = describeWriteError(error);
  if (described) return res.status(described.status).json(described.body);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { describeWriteError, sendWriteError, USER_CORRECTABLE };
