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

// A sign-in for an account that does not exist still pays for one bcrypt
// compare at the real cost, so the answer takes as long as a wrong password
// (6 ms against 310 ms told anyone which addresses had accounts).
let dummyHash = null;
async function compareDummy(password) {
  if (!dummyHash) dummyHash = hash(`dummy-${Math.random()}`);
  await compare(String(password || ''), await dummyHash);
  return false;
}

function getRounds(passwordHash) {
  return bcrypt.getRounds(passwordHash);
}

module.exports = { COST, compare, compareDummy, engine, getRounds, hash };
