'use strict';
/**
 * A JSON column (LONGTEXT with CHECK json_valid) comes back from MariaDB 10.11 through mysql2 already parsed — an array or an object, not text —
 * and as text on a server that does not parse it. tryJson read only text: handed the parsed value it threw inside JSON.parse and answered its
 * fallback, so on such a server an appraisal's evidence read as empty («Evidence is required before appraisal submission» for one that had it)
 * and its KPI list as []. Found while converting hrWorkflowIntegrity's appraisal pins to a behaviour test on the MariaDB 10.11 lab.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tryJson } = require('../lib/helpers');

test('tryJson reads text, and takes an already parsed value as it is', () => {
  assert.deepEqual(tryJson('[{"a":1}]', []), [{ a: 1 }]);
  assert.deepEqual(tryJson([{ a: 1 }], []), [{ a: 1 }], 'a parsed array is the answer, not the fallback');
  assert.deepEqual(tryJson({ b: 2 }, {}), { b: 2 });
});

test('tryJson still answers the fallback for nothing and for text that is not JSON', () => {
  assert.deepEqual(tryJson(null, []), []);
  assert.deepEqual(tryJson('', {}), {});
  assert.deepEqual(tryJson('not json', []), []);
});
