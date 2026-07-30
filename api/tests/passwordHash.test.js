'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const bcryptjs = require('bcryptjs');
const passwordHash = require('../lib/passwordHash');

test('password adapter verifies existing bcryptjs hashes without lowering cost', async () => {
  const legacyHash = await bcryptjs.hash('Compatible#2026', passwordHash.COST);

  assert.equal(await passwordHash.compare('Compatible#2026', legacyHash), true);
  assert.equal(await passwordHash.compare('wrong', legacyHash), false);
  assert.equal(passwordHash.getRounds(legacyHash), passwordHash.COST);
});

test('password adapter creates cost-12 hashes', async () => {
  const hash = await passwordHash.hash('Strong#2026');

  assert.equal(await passwordHash.compare('Strong#2026', hash), true);
  assert.equal(passwordHash.getRounds(hash), passwordHash.COST);
});
