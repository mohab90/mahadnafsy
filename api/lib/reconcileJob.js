'use strict';
// Periodic money-model integrity monitor. Runs the shared reconcile checks a few
// minutes after boot and then daily, logging any violation and raising an admin
// notification on a CRITICAL one (cross-tenant money). Read-only; never mutates.
const logger = require('./logger');
const { runReconcile } = require('./reconcileChecks');

const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE = 'تنبيه سلامة البيانات المالية';

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
      const keys = criticals.map(c => c.key).sort();
      // One notification per finding per day, not per run.
      //
      // This job runs three minutes after every boot as well as daily, so each
      // deploy or restart raised another identical alert: 732 of them, 633 of
      // those unread, a sixth of every notification in the system. An alert
      // that repeats unchanged is one people learn to scroll past, which costs
      // exactly the attention it was built to buy.
      // Compared as text, not with JSON_EXTRACT: `CAST(? AS JSON)` is a parse
      // error on MariaDB, and a throw here lands in the catch below and loses
      // the alert entirely — silence being the one outcome worse than repeats.
      // The keys are sorted so the same findings always serialise the same way.
      const payload = JSON.stringify({ checks: keys });
      const [[dupe]] = await pool.query(
        `SELECT id FROM notifications
          WHERE title = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
            AND data_json = ?
          LIMIT 1`,
        [TITLE, payload],
      );
      if (dupe) {
        logger.info(`[reconcile-job] نفس ${keys.length} نتيجة اتبلّغت النهارده — مش هكررها`);
      } else {
        const summary = criticals.map(c => `${c.name} (${c.n})`).join('؛ ');
        await createNotification('system', TITLE,
          `فحص المطابقة اكتشف خللاً حرجاً: ${summary}. راجع الآن.`, { checks: keys });
      }
    } catch (e) { logger.warn('[reconcile-job] notify failed:', e.message); }
  }
}

function startReconcileMonitor(pool) {
  // First pass 3 min after boot (let migrations/warmup settle), then every 24h.
  setTimeout(() => runOnce(pool), 3 * 60 * 1000).unref?.();
  setInterval(() => runOnce(pool), DAY_MS).unref?.();
}

module.exports = { startReconcileMonitor, runOnce };
