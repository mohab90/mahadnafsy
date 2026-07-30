'use strict';

const jwt = require('jsonwebtoken');
const { resolveSecret } = require('./secretResolver');

function pendingTokenIdentity(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(String(token), resolveSecret('JWT_SECRET'));
    if (payload?.purpose !== 'totp_pending') return null;
    return payload.uid || payload.email || null;
  } catch {
    return null;
  }
}

module.exports = { pendingTokenIdentity };
