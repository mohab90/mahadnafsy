'use strict';

const jwt = require('jsonwebtoken');
const { resolveSecret } = require('./secretResolver');

function pendingTokenIdentity(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(String(token), resolveSecret('JWT_SECRET'), { algorithms: ['HS256'] });
    if (payload?.purpose !== 'login_email_code') return null;
    return payload.uid || payload.email || null;
  } catch {
    return null;
  }
}

module.exports = { pendingTokenIdentity };
