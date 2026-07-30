'use strict';

let bcrypt;
let engine = 'bcrypt-native';

try {
  bcrypt = require('bcrypt');
} catch {
  bcrypt = require('bcryptjs');
  engine = 'bcryptjs-fallback';
}

const COST = 12;

function hash(password, rounds = COST) {
  return bcrypt.hash(password, rounds);
}

function compare(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function getRounds(passwordHash) {
  return bcrypt.getRounds(passwordHash);
}

module.exports = { COST, compare, engine, getRounds, hash };
