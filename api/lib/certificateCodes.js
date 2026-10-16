'use strict';

const crypto = require('crypto');

// «كود الشهادة يكون صغير … MAHAD + 6 رموز» (16 Oct 2026): every new certificate gets
// MAHAD followed by six letters and digits — eleven characters, no dashes.
//
// The six are drawn from 31 symbols (A–Z without I, L and O, and 2–9: nothing that reads as
// another when it is copied from paper or by phone), which is about 900 million codes, so a
// collision is rare but not impossible. The columns are unique, so a collision is a rejected
// insert, and withFreshCode simply tries another code. Certificates issued before this keep
// the codes they have (MHAD-… and PSY-C-…); verification accepts both.
const PREFIX = 'MAHAD';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SUFFIX_LENGTH = 6;
const ATTEMPTS = 8;

function newCertificateCode() {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) suffix += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${PREFIX}${suffix}`;
}

const isCodeCollision = error => error && error.code === 'ER_DUP_ENTRY'
  && /certificate_code|uq_cert_code|uq_certificate_requests_code/i.test(String(error.sqlMessage || error.message || ''));

/** Runs `write(code)` with a new code, again with another when the code was already taken. */
async function withFreshCode(write) {
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      return await write(newCertificateCode());
    } catch (error) {
      if (!isCodeCollision(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = { newCertificateCode, withFreshCode, isCodeCollision, PREFIX, ALPHABET, SUFFIX_LENGTH, ATTEMPTS };
