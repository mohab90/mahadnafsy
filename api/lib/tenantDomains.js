'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { domainToASCII } = require('node:url');

const RECORD_PREFIX = 'mahad-verification=';

function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase().replace(/\.$/, '');
  if (value.includes('://')) {
    try { value = new URL(value).hostname.toLowerCase().replace(/\.$/, ''); }
    catch { throw new Error('Invalid domain'); }
  }
  const ascii = domainToASCII(value);
  const labels = ascii.split('.');
  if (
    !ascii || ascii.length > 253 || net.isIP(ascii) || labels.length < 2
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || ascii === 'localhost' || ascii.endsWith('.localhost')
  ) {
    throw new Error('Invalid public domain');
  }
  return ascii;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createDomainChallenge(domain) {
  const normalized = normalizeDomain(domain);
  const token = crypto.randomBytes(24).toString('hex');
  return {
    domain: normalized,
    token,
    tokenHash: tokenHash(token),
    recordName: `_mahad-verify.${normalized}`,
    recordValue: `${RECORD_PREFIX}${token}`,
  };
}

async function verifyDnsOwnership(domain, expectedHash, resolveTxt = dns.resolveTxt) {
  const recordName = `_mahad-verify.${normalizeDomain(domain)}`;
  let records;
  try {
    records = await resolveTxt(recordName);
  } catch (error) {
    if (['ENODATA', 'ENOTFOUND', 'SERVFAIL', 'ETIMEOUT'].includes(error.code)) return false;
    throw error;
  }
  return records
    .map(parts => parts.join(''))
    .filter(value => value.startsWith(RECORD_PREFIX))
    .some(value => crypto.timingSafeEqual(
      Buffer.from(tokenHash(value.slice(RECORD_PREFIX.length)), 'hex'),
      Buffer.from(expectedHash, 'hex')
    ));
}

module.exports = {
  RECORD_PREFIX,
  createDomainChallenge,
  normalizeDomain,
  tokenHash,
  verifyDnsOwnership,
};
