'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../lib/db');

test('runtime schema DDL is blocked outside migration mode', async () => {
  const oldAllow = process.env.ALLOW_RUNTIME_SCHEMA_DDL;
  const oldMigration = process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE;
  delete process.env.ALLOW_RUNTIME_SCHEMA_DDL;
  delete process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE;
  try {
    const [result] = await pool.query('ALTER TABLE definitely_not_a_real_table ADD COLUMN x INT');
    assert.equal(result.schemaDdlSkipped, true);
  } finally {
    if (oldAllow == null) delete process.env.ALLOW_RUNTIME_SCHEMA_DDL;
    else process.env.ALLOW_RUNTIME_SCHEMA_DDL = oldAllow;
    if (oldMigration == null) delete process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE;
    else process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE = oldMigration;
  }
});
