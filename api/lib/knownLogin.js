'use strict';

// «This browser has signed in to this account before.» Set when a password is
// right, and read by the login limiters (middleware/rateLimits.js): fifteen
// wrong passwords for an account used to lock it for fifteen minutes even for
// its owner with the right password, from anyone who shared their network.
// A browser that has proven the password before is not counted with strangers.
// It still has a limit of its own, so a stolen cookie is not unlimited guesses.
//
// The cookie holds keyed tags, not the identifier: HMAC(tenant, identifier).

const crypto = require('crypto');
const { resolveSecret } = require('./secretResolver');

const COOKIE = 'mahadKnownLogin';
const MAX_TAGS = 5;
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const identifierKey = value => String(value || '').toLowerCase().replace(/\s+/g, '');

function tagFor(tenantId, identifier) {
  const key = identifierKey(identifier);
  if (!key) return null;
  const secret = resolveSecret('SESSION_BINDING_SECRET') || resolveSecret('JWT_SECRET');
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`known-login\0${tenantId || ''}\0${key}`).digest('base64url').slice(0, 22);
}

function carriedTags(req) {
  const raw = String(req?.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_.-]+)`))?.[1];
  return raw ? raw.split('.').filter(Boolean).slice(0, MAX_TAGS) : [];
}

/** True when this browser signed in before to the account named in the login body. */
function isKnownLogin(req) {
  const identifier = req?.body?.email;
  if (typeof identifier !== 'string') return false;
  const tag = tagFor(req.tenantId, identifier);
  if (!tag) return false;
  const expected = Buffer.from(tag);
  return carriedTags(req).some(candidate => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

/** Remember, on the response, that this browser knows the password for `identifier`. */
function rememberKnownLogin(req, res, identifier) {
  const tag = tagFor(req.tenantId, identifier);
  if (!tag || typeof res?.append !== 'function') return;
  const tags = [tag, ...carriedTags(req).filter(existing => existing !== tag)].slice(0, MAX_TAGS);
  res.append('Set-Cookie', `${COOKIE}=${tags.join('.')}; HttpOnly; Path=/api/auth; Max-Age=${MAX_AGE_SECONDS}; SameSite=None; Secure`);
}

module.exports = { isKnownLogin, rememberKnownLogin, KNOWN_LOGIN_COOKIE: COOKIE };
