#!/usr/bin/env node
'use strict';
// Read-only data-integrity / money-model reconciliation checker.
// Run anytime (`npm run reconcile`) or from cron. Checks live in the shared
// lib/reconcileChecks module (also used by the periodic boot-time monitor).
require('dotenv').config();
const { pool } = require('../lib/db');
const { runReconcile } = require('../lib/reconcileChecks');

const C = { reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' };

(async () => {
  const results = await runReconcile(pool);
  let criticalFailures = 0;
  console.log(`${C.bold}── Reconciliation checks ──${C.reset}`);
  for (const r of results) {
    if (r.error) { console.log(`  ${C.dim}SKIP${C.reset}  ${r.name} ${C.dim}(${r.error.slice(0, 60)})${C.reset}`); continue; }
    if (r.n === 0) { console.log(`  ${C.green}OK  ${C.reset}  ${r.name}`); continue; }
    const tag = r.severity === 'critical' ? `${C.red}FAIL${C.reset}`
              : r.severity === 'warn' ? `${C.yellow}WARN${C.reset}`
              : `${C.dim}INFO${C.reset}`;
    console.log(`  ${tag}  ${r.name} ${C.bold}→ ${r.n} row(s)${C.reset}`);
    console.log(`        ${C.dim}${r.hint}${C.reset}`);
    if (r.severity === 'critical') criticalFailures++;
  }
  console.log('───────────────────────────');
  console.log(criticalFailures === 0
    ? `${C.green}No critical integrity violations.${C.reset}`
    : `${C.red}${criticalFailures} critical check(s) failed.${C.reset}`);
  await pool.end().catch(() => {});
  process.exit(criticalFailures > 0 ? 1 : 0);
})().catch(e => { console.error('reconcile fatal:', e.message); process.exit(2); });
