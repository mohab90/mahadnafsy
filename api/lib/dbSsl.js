'use strict';

const fs = require('node:fs');

function getDbSslConfig(env = process.env) {
  const mode = String(env.DB_SSL_MODE || 'disabled').toLowerCase().replace('_', '-');
  if (mode === 'disabled') return undefined;
  if (!['required', 'verify-ca'].includes(mode)) {
    throw new Error('DB_SSL_MODE must be disabled, required, or verify-ca');
  }
  const ca = env.DB_SSL_CA_PATH ? fs.readFileSync(env.DB_SSL_CA_PATH, 'utf8') : undefined;
  if (mode === 'verify-ca' && !ca) throw new Error('DB_SSL_CA_PATH is required for verify-ca');
  return { rejectUnauthorized: mode === 'verify-ca', ...(ca ? { ca } : {}) };
}

module.exports = { getDbSslConfig };
