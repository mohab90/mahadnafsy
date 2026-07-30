'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_SECRET_BYTES = 64 * 1024;

function resolveSecret(name, env = process.env) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(name)) throw new Error('Invalid secret name');
  const direct = String(env[name] || '').trim();
  const fileValue = String(env[`${name}_FILE`] || '').trim();
  if (direct && fileValue) throw new Error(`${name} and ${name}_FILE cannot both be configured`);
  if (!fileValue) return direct;
  if (!path.isAbsolute(fileValue)) throw new Error(`${name}_FILE must be an absolute path`);
  const stat = fs.statSync(fileValue);
  if (!stat.isFile()) throw new Error(`${name}_FILE must reference a regular file`);
  if (stat.size <= 0 || stat.size > MAX_SECRET_BYTES) throw new Error(`${name}_FILE has an invalid size`);
  const secret = fs.readFileSync(fileValue, 'utf8').trim();
  if (!secret) throw new Error(`${name}_FILE is empty`);
  return secret;
}

module.exports = { MAX_SECRET_BYTES, resolveSecret };
