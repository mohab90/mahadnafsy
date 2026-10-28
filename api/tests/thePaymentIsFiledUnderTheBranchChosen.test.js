'use strict';

// The branch on the payment is the branch the desk chose.
//
// «الفرع *» is asked for on every booking and was then ignored: the payment was
// filed under whatever branch the client's own row carried, so money taken at
// the Dokki desk from a client who had signed up online was recorded as online.
// Every branch figure downstream — the vault, the branch P&L, الدقي محاسبة —
// reads that column, so the choice on screen changed nothing anywhere.
//
// What it may not become is a way around the scope: resolveFinancialScope
// already refuses a branch outside the reader's own, and that check runs on
// the same value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The branch chosen is the branch stored, none named is the client's, a made-up
// one is refused and a branch-bound desk cannot file elsewhere — over HTTP in
// tests/integration/deskPaymentsAndOrders.integration.test.js. Left here: the
// dialog sends the branch it asked for.

test('the branch the desk is asked for is the one that reaches the API', () => {
  const root = path.join(__dirname, '..', '..');
  const helper = fs.readFileSync(path.join(root, 'admin/lib/createClientWithPayment.ts'), 'utf8');
  assert.match(helper, /branch,\s*\n\s*\},\s*\}\);/s, 'the payment body must carry the branch');
  assert.ok(helper.includes('const branch ='), 'the dialog\'s branch has to be resolved before the call');
});
