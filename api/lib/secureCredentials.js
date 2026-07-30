'use strict';

const crypto = require('crypto');

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTemporaryPassword(length = 12) {
  return Array.from(
    { length },
    () => PASSWORD_CHARS[crypto.randomInt(0, PASSWORD_CHARS.length)]
  ).join('');
}

function generateNumericCode() {
  return String(crypto.randomInt(100000, 1000000));
}

module.exports = { generateTemporaryPassword, generateNumericCode };
