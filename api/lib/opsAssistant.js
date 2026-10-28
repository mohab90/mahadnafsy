'use strict';

// «السيستم يقدر يصلح نفسه ويبقى ذكي» (27 Oct 2026): what the ops watchdog (lib/opsWatchdog.js) does after it has found something.
//
//   1. Fix what is safe to fix by itself. A short list, each one reversible or harmless, written down here and nowhere else — the model
//      never chooses an action, it only reads. Today: messages that died of a passing fault (a timeout, a 429, a provider 5xx) on a
//      channel that is sending again are put back in the queue, once each.
//   2. Say what it thinks is wrong. The key the institute set in «إعدادات AI» (Gemini, or whichever it chose) reads the finding and the
//      evidence — error texts with every address, number and key masked — and answers in two or three lines: the likely cause and the one
//      thing the owner should do. It is a hint beside the facts, never the facts: it is told to say «مش متأكد» rather than invent a cause.
//
// What it never does: change code, a setting, a secret or a customer's data, send anything to a customer, or run anything the model wrote.
// Without a key, with the assistant switched off (tenant setting `ops_assistant`), or when the model fails, the alert goes out as before.

const { getTenantSetting } = require('./tenantSettings');
const { generateAdminAi, resolveAiConfig, sanitizeProviderText } = require('./adminAi');

const SECTION = 'ops_assistant';
const DEFAULTS = { enabled: true, diagnose: true, autoFix: true, dailyCalls: 30 };

// A fault that passes by itself. Anything about the number, the account, the token or a closed message type is not in this list and is
// excluded below even when a timeout is mentioned beside it.
const TRANSIENT = 'ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|timed? ?out|HTTP 429|HTTP 5[0-9]{2}|rate.?limit|temporar';
const NEVER_RETRY = 'category_disabled|opted_out|invalid_number|undialable_phone|not_configured|auth|token|expired|invalid|blocked|banned|daily_limit|535|No recipients';
const REQUEUE_WINDOW_HOURS = 3;
const REQUEUE_LIMIT = 50;
const requeued = new Set();   // ids put back by this process: a row that dies again is left for a person, not looped

const calls = new Map();      // tenant → { day, n }
const diagnoses = new Map();  // finding key → { window, text }

async function assistantSettings(tenantId, db, readSetting = getTenantSetting) {
  const saved = await readSetting(SECTION, { tenantId, fallback: {}, db }).catch(() => ({}));
  return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// ── Fixes ────────────────────────────────────────────────────────────────────

/**
 * Dead messages of the last few hours whose error was a passing one, on a channel that has sent something in the last twenty minutes:
 * back to `pending`, attempts reset. Sign-in codes (category otp) are never put back — a code is worth minutes, and the person has asked
 * for another by now. Each row is put back once per process.
 */
async function requeueTransientDead({ db, tenantId, now = Date.now(), dryRun = false, isCategoryOpen = null }) {
  const [healthy] = await db.query(
    `SELECT DISTINCT channel FROM message_outbox WHERE tenant_id=? AND status='sent' AND sent_at >= ?`,
    [tenantId, new Date(now - 20 * 60 * 1000)]);
  const channels = healthy.map(row => row.channel);
  if (!channels.length) return { count: 0, reason: 'no_channel_sending' };
  const [rows] = await db.query(
    `SELECT id, channel, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.category')) AS category
       FROM message_outbox
      WHERE tenant_id=? AND status='dead' AND created_at >= ? AND channel IN (?)
        AND last_error REGEXP ? AND last_error NOT REGEXP ?
      ORDER BY created_at ASC LIMIT ?`,
    [tenantId, new Date(now - REQUEUE_WINDOW_HOURS * 3600 * 1000), channels, TRANSIENT, NEVER_RETRY, REQUEUE_LIMIT]);
  const ids = [];
  for (const row of rows) {
    if (requeued.has(row.id) || String(row.category || '') === 'otp') continue;
    if (row.channel === 'whatsapp' && isCategoryOpen && !await isCategoryOpen(row.category, tenantId)) continue;
    ids.push(row.id);
  }
  if (!ids.length) return { count: 0, reason: 'nothing_to_put_back' };
  if (dryRun) return { count: ids.length, dryRun: true };
  const [result] = await db.query(
    `UPDATE message_outbox
        SET status='pending', attempts=0, last_error=NULL, next_attempt_at=NOW(), locked_at=NULL, locked_by=NULL
      WHERE tenant_id=? AND status='dead' AND id IN (?)`,
    [tenantId, ids]);
  ids.forEach(id => requeued.add(id));
  if (requeued.size > 5000) requeued.clear();
  return { count: Number(result?.affectedRows) || 0 };
}

const FIXES = [
  { key: 'outbox', name: 'requeue_transient', label: 'رجّعت للطابور رسايل فشلت لعطل مؤقت والقناة رجعت تبعت', run: requeueTransientDead },
];

// ── Evidence and diagnosis ───────────────────────────────────────────────────

const mask = text => sanitizeProviderText(String(text || '').replace(/\d{6,}/g, '#'), 160);

async function evidenceFor(finding, { db, tenantId, now }) {
  const lines = [];
  try {
    if (finding.key === 'outbox' || finding.key === 'otp') {
      const [errors] = await db.query(
        `SELECT channel, status, LEFT(COALESCE(last_error, ''), 160) AS err, COUNT(*) AS n FROM message_outbox
          WHERE tenant_id=? AND status IN ('failed','dead') AND created_at >= ? AND COALESCE(last_error, '') NOT REGEXP 'category_disabled|opted_out|invalid_number'
          GROUP BY channel, status, err ORDER BY n DESC LIMIT 6`,
        [tenantId, new Date(now - 60 * 60 * 1000)]);
      for (const row of errors) lines.push(`${row.n} × ${row.channel}/${row.status}: ${mask(row.err)}`);
      const [channels] = await db.query(
        `SELECT kind, provider, status, last_error FROM messaging_channels WHERE tenant_id=? AND is_active=1 LIMIT 6`, [tenantId]);
      for (const row of channels) lines.push(`قناة ${row.kind}/${row.provider}: ${row.status}${row.last_error ? ` — ${mask(row.last_error)}` : ''}`);
    }
  } catch { /* the finding alone is enough */ }
  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  'أنت مهندس تشغيل لنظام معهد تعليمي. هتقرأ تنبيه من مراقب السيستم ومعاه أدلة (نصوص أخطاء مخفية فيها الأرقام والإيميلات).',
  'اكتب بالعامية المصرية المبسطة، في سطرين أو تلاتة بالكتير: أرجح سبب مبني على الأدلة بس، وبعدين خطوة واحدة محددة يعملها صاحب المعهد.',
  'ممنوع تخترع سبب مش موجود في الأدلة. لو مش متأكد قول «مش متأكد» واذكر أيه اللي ناقص عشان تتأكد.',
  'ممنوع تقترح تعديل كود أو حذف بيانات أو أي حاجة خطرة، وممنوع تذكر مفاتيح أو أرقام.',
].join('\n');

const dayOf = now => new Date(now).toISOString().slice(0, 10);

/** Two or three lines from the model, or null: no key, switched off, over the day's cap, or the model failed. */
async function diagnose({ finding, evidence, tenantId, db, now = Date.now(), settings, fetchImpl, logger, readSetting = getTenantSetting }) {
  if (!settings.diagnose) return null;
  const aiSettings = await readSetting('settings', { tenantId, fallback: {}, db }).catch(() => ({}));
  const config = resolveAiConfig(aiSettings, 'admin');
  if (!config) return null;
  const today = dayOf(now);
  const used = calls.get(tenantId);
  if (used?.day === today && used.n >= settings.dailyCalls) return null;
  calls.set(tenantId, { day: today, n: used?.day === today ? used.n + 1 : 1 });
  try {
    const text = await generateAdminAi({ ...config, temperature: 0.2 }, {
      systemPrompt: SYSTEM_PROMPT, maxTokens: 400,
      messages: [{ role: 'user', content: `التنبيه: ${finding.title}\n${finding.body}\n\nالأدلة:\n${evidence || '(مفيش أدلة إضافية)'}` }],
    }, fetchImpl);
    return String(text || '').replace(/\s+\n/g, '\n').trim().slice(0, 700) || null;
  } catch (error) {
    logger?.warn?.('[ops-assistant] diagnosis failed', error.message);
    return null;
  }
}

/**
 * Takes the watchdog's findings and returns them with `fixed` (what was put right) and `diagnosis` (the model's reading) where there is
 * one. A finding keeps one diagnosis per quiet window, so a problem that lasts all day is read once, not every five minutes.
 */
async function assist({ findings, tenantId, db, logger, now = Date.now(), quietHours = {}, fetchImpl, isCategoryOpen, readSetting = getTenantSetting }) {
  if (!findings.length) return findings;
  const settings = await assistantSettings(tenantId, db, readSetting);
  if (!settings.enabled) return findings;
  for (const finding of findings) {
    try {
      if (settings.autoFix) {
        const done = [];
        for (const fix of FIXES.filter(item => item.key === finding.key)) {
          const result = await fix.run({ db, tenantId, now, isCategoryOpen });
          if (result.count > 0) { done.push(`${fix.label}: ${result.count}`); logger?.info?.('[ops-assistant] fixed', { fix: fix.name, count: result.count }); }
        }
        if (done.length) finding.fixed = done.join(' | ');
      }
      const window = Math.floor(now / ((quietHours[finding.key] || 3) * 3600 * 1000));
      const kept = diagnoses.get(finding.key);
      if (kept?.window === window) { if (kept.text) finding.diagnosis = kept.text; continue; }
      const text = await diagnose({ finding, evidence: await evidenceFor(finding, { db, tenantId, now }), tenantId, db, now, settings, fetchImpl, logger, readSetting });
      diagnoses.set(finding.key, { window, text });
      if (text) finding.diagnosis = text;
    } catch (error) {
      logger?.warn?.('[ops-assistant] skipped a finding', error.message);
    }
  }
  return findings;
}

module.exports = {
  DEFAULTS, FIXES, TRANSIENT, NEVER_RETRY, assist, assistantSettings, diagnose, evidenceFor, requeueTransientDead,
  _reset: () => { calls.clear(); diagnoses.clear(); requeued.clear(); },
};
