'use strict';
// Periodic money-model integrity monitor. Runs the shared reconcile checks a few
// minutes after boot and then daily, logging any violation and raising an admin
// notification on a CRITICAL one (cross-tenant money). Read-only; never mutates.
const logger = require('./logger');
const { runReconcile } = require('./reconcileChecks');

const DAY_MS = 24 * 60 * 60 * 1000;

async function runOnce(pool) {
  let results;
  try { results = await runReconcile(pool); }
  catch (e) { logger.warn('[reconcile-job] run failed:', e.message); return; }

  const violations = results.filter(r => !r.error && r.n > 0);
  const criticals = violations.filter(r => r.severity === 'critical');

  if (violations.length === 0) { logger.info('[reconcile-job] integrity OK — no violations'); return; }
  for (const v of violations) {
    const lvl = v.severity === 'critical' ? 'error' : 'warn';
    logger[lvl](`[reconcile-job] ${v.severity.toUpperCase()} ${v.key}: ${v.n} row(s) — ${v.name}`);
  }
  if (criticals.length > 0) {
    try {
      const { createNotification } = require('./notification');
      const summary = criticals.map(c => `${c.name} (${c.n})`).join('؛ ');
      await createNotification('system', 'تنبيه سلامة البيانات المالية',
        `فحص المطابقة اكتشف خللاً حرجاً: ${summary}. راجع الآن.`, { checks: criticals.map(c => c.key) });
    } catch (e) { logger.warn('[reconcile-job] notify failed:', e.message); }
  }
}

function startReconcileMonitor(pool) {
  // First pass 3 min after boot (let migrations/warmup settle), then every 24h.
  setTimeout(() => runOnce(pool), 3 * 60 * 1000).unref?.();
  setInterval(() => runOnce(pool), DAY_MS).unref?.();
}

module.exports = { startReconcileMonitor, runOnce };
