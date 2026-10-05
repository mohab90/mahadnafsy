'use strict';
// A named lock (GET_LOCK) that belongs to this database, not to the server.
//
// MariaDB's named locks are server-wide: a name taken in one database is taken
// in every database on the same server. Production (mahadnafsy_db) and staging
// (mahadnafsy_test) share one MariaDB, so staging holding 'mahad:wa-web' left
// production answering «خدمة الواتساب بتشتغل دلوقتي — جرّب كمان دقيقة»
// forever, and a daily job staging was running made production skip its own.
// Prefixing the database name gives each its own lock. Names are capped at 64
// characters by MariaDB, so a long one is hashed.
const crypto = require('crypto');

function scopedLockName(name) {
  const db = String(process.env.DB_NAME || 'mahad').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) || 'db';
  const full = `${db}:${name}`;
  if (full.length <= 64) return full;
  return `${db}:${crypto.createHash('sha1').update(String(name)).digest('hex')}`;
}

module.exports = { scopedLockName };
