'use strict';

const listEnv = (name, normalize = value => value) => (process.env[name] || '')
  .split(',')
  .map(value => normalize(value.trim()))
  .filter(Boolean);

const PLATFORM_ADMIN_EMAILS = listEnv('PLATFORM_ADMIN_EMAILS', value => value.toLowerCase());
const PLATFORM_ADMIN_UIDS = listEnv('PLATFORM_ADMIN_UIDS');

function isPlatformAdminIdentity(user, allowlist = {}) {
  const emails = allowlist.emails || PLATFORM_ADMIN_EMAILS;
  const uids = allowlist.uids || PLATFORM_ADMIN_UIDS;
  return emails.includes(String(user?.email || '').trim().toLowerCase())
    || uids.includes(String(user?.uid || '').trim());
}

module.exports = { listEnv, PLATFORM_ADMIN_EMAILS, PLATFORM_ADMIN_UIDS, isPlatformAdminIdentity };
