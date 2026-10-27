'use strict';

// «مراقبة وتنبيهات» (26 Oct 2026): the server tells the owner on WhatsApp when something is going wrong, instead of nobody finding out.
//
// What the production log of 4.39 million requests showed was that nothing was watching it: on 20 Oct one browser looped and sent 270,000
// requests in a day (3.5 times the normal load) and nobody was told; 467 of 774 WhatsApp login codes failed over weeks; the only copy of the
// database sat on the server it describes. The access log says all of it afterwards, to whoever opens it.
//
// This keeps the last hour of traffic in minute buckets (bounded memory, one entry per request), and every five minutes asks six questions:
//
//   errors     the share of 5xx in the last ten minutes (the normal share is 0.02%)
//   storm      a route asked far more often than it was in the hour before — a loop in somebody's browser
//   slow       the 95th percentile of the last ten minutes
//   backup     the newest credible database backup is older than 30 hours
//   offsite    the nightly job has not copied it off the machine (deploy/mahad-db-backup.sh logs «off-site ok»)
//   outbox     WhatsApp / e-mail messages stuck or dead: login codes and password resets are among them
//
// A finding is queued as one staff_alert WhatsApp to the owner-report numbers, once per window per kind (the outbox dedupe key), and written
// to the log as an error. WhatsApp is itself one of the things that fails, so when OPS_HEARTBEAT_URL is set the watchdog also pings it every
// run: a dead-man's switch (healthchecks.io, UptimeRobot heartbeat…) that alerts from OUTSIDE when the pings stop — the one case an alert sent
// by this very server cannot cover.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const num = (name, fallback) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);
const T = {
  errorMinShare: num('OPS_ERROR_SHARE', 0.03),
  errorMinCount: num('OPS_ERROR_MIN', 8),
  stormMin: num('OPS_STORM_MIN', 1500),
  stormAbsolute: num('OPS_STORM_ABSOLUTE', 6000),
  stormTimes: num('OPS_STORM_TIMES', 6),
  slowP95Ms: num('OPS_SLOW_P95_MS', 3000),
  slowMinRequests: num('OPS_SLOW_MIN_REQUESTS', 80),
  backupMaxHours: num('OPS_BACKUP_MAX_HOURS', 30),
  outboxStuck: num('OPS_OUTBOX_STUCK', 25),
  outboxDead: num('OPS_OUTBOX_DEAD', 10),
};
// How long one kind of finding stays quiet after it was sent (hours).
const QUIET_HOURS = { errors: 2, storm: 3, slow: 3, backup: 24, offsite: 24, outbox: 3 };

const KEEP_MINUTES = 70;
const SAMPLES_PER_MINUTE = 300;
const MAX_ROUTES_PER_MINUTE = 150;
const buckets = new Map();

const minuteOf = ms => Math.floor(ms / 60000);

/** One finished request. Called from the performance monitor's hook, which already isolates failures. */
function noteRequest({ route, status, ms }, now = Date.now()) {
  const minute = minuteOf(now);
  let bucket = buckets.get(minute);
  if (!bucket) {
    bucket = { total: 0, e5: 0, routes: new Map(), samples: [] };
    buckets.set(minute, bucket);
    for (const key of buckets.keys()) if (key < minute - KEEP_MINUTES) buckets.delete(key);
  }
  bucket.total += 1;
  if (status >= 500) bucket.e5 += 1;
  let entry = bucket.routes.get(route);
  if (!entry) {
    if (bucket.routes.size >= MAX_ROUTES_PER_MINUTE) return;
    entry = { n: 0, e5: 0, slow: 0 };
    bucket.routes.set(route, entry);
  }
  entry.n += 1;
  if (status >= 500) entry.e5 += 1;
  if (ms >= T.slowP95Ms) entry.slow += 1;
  if (bucket.samples.length < SAMPLES_PER_MINUTE) bucket.samples.push(ms);
}

function windowOf(now, fromMinutesAgo, toMinutesAgo = 0) {
  const minute = minuteOf(now);
  const out = [];
  for (let back = fromMinutesAgo; back >= toMinutesAgo; back -= 1) {
    const bucket = buckets.get(minute - back);
    if (bucket) out.push(bucket);
  }
  return out;
}

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

function sumRoutes(list, field = 'n') {
  const totals = new Map();
  for (const bucket of list) for (const [route, entry] of bucket.routes) totals.set(route, (totals.get(route) || 0) + entry[field]);
  return totals;
}

const top = (map, count = 3) => [...map.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, count);

/** What the last minutes of traffic say is wrong — pure, so a test can feed it. */
function trafficFindings(now = Date.now()) {
  const findings = [];
  const last10 = windowOf(now, 9);
  const total10 = last10.reduce((sum, bucket) => sum + bucket.total, 0);
  const errors10 = last10.reduce((sum, bucket) => sum + bucket.e5, 0);
  if (errors10 >= T.errorMinCount && total10 > 0 && errors10 / total10 >= T.errorMinShare) {
    const routes = top(sumRoutes(last10, 'e5')).map(([route, n]) => `${route} (${n})`).join('، ');
    findings.push({
      key: 'errors', severity: 'high',
      title: 'أخطاء سيرفر كتيرة دلوقتي',
      body: `${errors10} خطأ (5xx) من ${total10} طلب في آخر 10 دقايق — ${(100 * errors10 / total10).toFixed(1)}% (الطبيعي أقل من 0.1%).\nأكتر الشاشات: ${routes || '—'}`,
      hint: 'ابعت الرسالة دي للمطوّر. لو بعد نشر جديد فاحتمال تحتاج رجوع للإصدار اللي قبله.',
    });
  }

  const last5 = windowOf(now, 4);
  const before = windowOf(now, 59, 5);
  const now5 = sumRoutes(last5);
  const base = sumRoutes(before);
  const windowsBefore = Math.max(1, before.length / 5);
  const storms = [];
  for (const [route, count] of now5) {
    const baseline = (base.get(route) || 0) / windowsBefore;
    const sudden = before.length >= 15 && count >= T.stormMin && count >= T.stormTimes * Math.max(baseline, 25);
    if (sudden || count >= T.stormAbsolute) storms.push([route, count, Math.round(baseline)]);
  }
  if (storms.length) {
    storms.sort((a, b) => b[1] - a[1]);
    findings.push({
      key: 'storm', severity: 'medium',
      title: 'زحمة طلبات غير عادية على السيرفر',
      body: storms.slice(0, 3).map(([route, count, baseline]) => `${route}: ${count} طلب في 5 دقايق (قبلها كان حوالي ${baseline})`).join('\n'),
      hint: 'غالباً صفحة مفتوحة عند حد وبتكرر الطلب في حلقة. المطوّر يشوف الشاشة دي.',
    });
  }

  const samples = last10.flatMap(bucket => bucket.samples);
  if (samples.length >= T.slowMinRequests) {
    const p95 = percentile(samples, 0.95);
    if (p95 >= T.slowP95Ms) {
      const slowRoutes = top(sumRoutes(last10, 'slow')).map(([route, n]) => `${route} (${n})`).join('، ');
      findings.push({
        key: 'slow', severity: 'medium',
        title: 'السيستم بطيء دلوقتي',
        body: `95% من الطلبات في آخر 10 دقايق خلصت في ${(p95 / 1000).toFixed(1)} ثانية أو أقل (الطبيعي أقل من نص ثانية).\nأبطأ الشاشات: ${slowRoutes || '—'}`,
        hint: 'ممكن ضغط على قاعدة البيانات أو استعلام تقيل. «مراقبة السيرفر» في الأدمن بتوريك الاستعلام.',
      });
    }
  }
  return findings;
}

// ── Backups ──────────────────────────────────────────────────────────────────

const BACKUP_DIR = () => process.env.MAHAD_BACKUP_DIR || '/var/backups/mahad-db';
const BACKUP_LOG = () => process.env.MAHAD_BACKUP_LOG || '/var/log/mahad-db-backup.log';
const MIN_REAL_BYTES = 1_000_000;

/** The newest dump that is big enough to be real, read from the files themselves. */
function newestBackup(dir = BACKUP_DIR()) {
  try {
    const files = fs.readdirSync(dir).filter(name => /\.sql\.gz$/.test(name)).map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, bytes: stat.size, at: stat.mtimeMs };
    }).filter(file => file.bytes >= MIN_REAL_BYTES);
    files.sort((a, b) => b.at - a.at);
    return { readable: true, newest: files[0] || null };
  } catch {
    return { readable: false, newest: null };
  }
}

/** The tail of the backup job's own log: when it last said «backup ok», «off-site ok» and ALERT. */
function offsiteState(logFile = BACKUP_LOG()) {
  try {
    const stat = fs.statSync(logFile);
    const fd = fs.openSync(logFile, 'r');
    const length = Math.min(stat.size, 96 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    fs.closeSync(fd);
    const state = { readable: true, backupOkAt: null, offsiteOkAt: null, lastAlert: null };
    for (const line of buffer.toString('utf8').split('\n')) {
      const at = Date.parse(line.slice(0, 25));
      if (/ backup ok:/.test(line)) state.backupOkAt = Number.isFinite(at) ? at : state.backupOkAt;
      else if (/ off-site ok:/.test(line)) state.offsiteOkAt = Number.isFinite(at) ? at : state.offsiteOkAt;
      else if (/ ALERT /.test(line)) state.lastAlert = line.replace(/^\S+\s+ALERT\s+/, '').slice(0, 200);
    }
    return state;
  } catch {
    return { readable: false, backupOkAt: null, offsiteOkAt: null, lastAlert: null };
  }
}

function backupFindings({ local, offsite, now = Date.now() }) {
  const findings = [];
  const maxMs = T.backupMaxHours * 3600 * 1000;
  if (local.readable) {
    if (!local.newest) {
      findings.push({
        key: 'backup', severity: 'high', title: 'مفيش نسخة احتياطية سليمة لقاعدة البيانات',
        body: 'مفيش ولا ملف نسخة احتياطية بحجم طبيعي على السيرفر.',
        hint: 'شغّل «bash /usr/local/bin/mahad-db-backup.sh» على السيرفر وشوف الخطأ في /var/log/mahad-db-backup.log.',
      });
    } else if (now - local.newest.at > maxMs) {
      findings.push({
        key: 'backup', severity: 'high', title: 'آخر نسخة احتياطية قديمة',
        body: `آخر نسخة سليمة اتاخدت من ${Math.round((now - local.newest.at) / 3600000)} ساعة (المفروض كل يوم).`,
        hint: 'شوف /var/log/mahad-db-backup.log — النسخة الليلية بتفشل.',
      });
    }
  }
  // An unreadable log says nothing either way, so it alerts about nothing.
  if (local.readable && offsite.readable && local.newest) {
    const recent = offsite.offsiteOkAt && now - offsite.offsiteOkAt <= maxMs;
    if (!recent) {
      findings.push({
        key: 'offsite', severity: 'high', title: 'النسخة الاحتياطية مش بتتنسخ بره السيرفر',
        body: `النسخ موجودة على نفس السيرفر بس — لو السيرفر ضاع، البيانات بتضيع معاه.${offsite.lastAlert ? `\nآخر رسالة من الـ job: ${offsite.lastAlert}` : ''}`,
        hint: 'لازم يتظبط نسخ خارجي مشفّر (deploy/README_AR.md ← النسخ الاحتياطي).',
      });
    }
  }
  return findings;
}

// ── The outbox ───────────────────────────────────────────────────────────────

// Dead on purpose, not a channel failing: a message type the owner keeps closed («أنواع الرسائل» — after the number bans only
// codes go out), a number that opted out, a number that does not exist. The outbox kills these on the first attempt
// (lib/outbox.js PERMANENT_REFUSAL), and counting them said «13 رسالة فشلت» with the channel connected and sending: 299 of
// the 300 «dead» rows of 27 Oct were category_disabled, and no code had failed at all.
const REFUSED_BY_DESIGN = 'category_disabled|opted_out|invalid_number|undialable_phone|إرسال هذا النوع من الرسائل موقوف';

async function outboxFindings(db, tenantId, now = Date.now()) {
  const stuckBefore = new Date(now - 30 * 60 * 1000);
  const deadSince = new Date(now - 60 * 60 * 1000);
  const [rows] = await db.query(
    `SELECT channel,
            SUM(status IN ('pending','processing') AND created_at < ?) AS stuck,
            SUM(status IN ('failed','dead') AND created_at >= ? AND COALESCE(last_error, '') NOT REGEXP '${REFUSED_BY_DESIGN}') AS dead
       FROM message_outbox
      WHERE tenant_id=? AND created_at >= ?
      GROUP BY channel`,
    [stuckBefore, deadSince, tenantId, new Date(now - 24 * 3600 * 1000)]);
  const lines = [];
  for (const row of rows) {
    const label = { whatsapp: 'واتساب', email: 'إيميل', messenger: 'ماسنجر' }[row.channel] || row.channel;
    const stuck = Number(row.stuck) || 0;
    const dead = Number(row.dead) || 0;
    if (stuck >= T.outboxStuck) lines.push(`${label}: ${stuck} رسالة واقفة بقالها أكتر من 30 دقيقة`);
    if (dead >= T.outboxDead) lines.push(`${label}: ${dead} رسالة فشلت نهائياً في آخر ساعة`);
  }
  if (!lines.length) return [];
  return [{
    key: 'outbox', severity: 'medium', title: 'رسايل مش بتتبعت',
    body: `${lines.join('\n')}\nأكواد الدخول وإعادة تعيين كلمة المرور بتتبعت مباشرة ومش بتعدي من الطابور ده.`,
    hint: 'راجع قناة الواتساب أو إعدادات البريد في «التكاملات».',
  }];
}

// ── Telling the owner ────────────────────────────────────────────────────────

function compose(finding) {
  return [`${finding.severity === 'high' ? '🚨' : '⚠️'} *${finding.title}*`, finding.body, finding.hint ? `\n${finding.hint}` : ''].filter(Boolean).join('\n');
}

const windowKey = (key, now) => Math.floor(now / (QUIET_HOURS[key] * 3600 * 1000));

async function queueAlerts({ findings, tenantId, db, logger, now = Date.now() }) {
  if (!findings.length) return 0;
  for (const finding of findings) logger?.error?.(`[ops-watchdog] ${finding.key}: ${finding.title} — ${String(finding.body).replace(/\n/g, ' | ')}`);
  const { ownerReportSettings } = require('./ownerDailyReport');
  const { toDialable } = require('./phoneNumber');
  const outbox = require('./outbox');
  const { phones } = await ownerReportSettings(tenantId, db);
  if (!phones.length) {
    logger?.warn?.('[ops-watchdog] findings, but no owner-report number is saved to tell');
    return 0;
  }
  let queued = 0;
  for (const finding of findings) {
    const message = compose(finding);
    for (const phone of phones) {
      const dialable = toDialable(phone);
      if (!dialable) continue;
      const digest = crypto.createHash('sha1').update(`${finding.key}:${dialable}`).digest('hex').slice(0, 16);
      const id = await outbox.enqueue({
        channel: 'whatsapp', recipient: dialable, tenantId,
        dedupeKey: `ops:${digest}:${windowKey(finding.key, now)}`, refType: 'ops_alert', refId: finding.key,
        payload: { message, category: 'staff_alert' },
      }, db);
      if (id) queued += 1;
    }
  }
  return queued;
}

/** The dead-man's switch: an outside service that raises the alarm when these pings stop. */
async function heartbeat({ env = process.env, fetchImpl = global.fetch, logger } = {}) {
  const url = String(env.OPS_HEARTBEAT_URL || '').trim();
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch (error) {
    logger?.warn?.('[ops-watchdog] heartbeat failed', error.message);
    return false;
  }
}

let lastRun = { at: null, findings: [], queued: 0 };

/** One watchdog pass: every question, every finding told once per window. */
async function runOpsWatchdog({ pool, logger, tenantId = process.env.DEFAULT_TENANT_ID || 'tenant-default', now = Date.now() } = {}) {
  const findings = [
    ...trafficFindings(now),
    ...backupFindings({ local: newestBackup(), offsite: offsiteState(), now }),
    ...await outboxFindings(pool, tenantId, now).catch(error => { logger?.warn?.('[ops-watchdog] outbox check failed', error.message); return []; }),
  ];
  const queued = await queueAlerts({ findings, tenantId, db: pool, logger, now });
  await heartbeat({ logger });
  lastRun = { at: new Date(now).toISOString(), findings: findings.map(({ key, title, body }) => ({ key, title, body })), queued };
  return lastRun;
}

const status = () => ({ ...lastRun, thresholds: T, quietHours: QUIET_HOURS, heartbeatConfigured: /^https:\/\//i.test(String(process.env.OPS_HEARTBEAT_URL || '')) });

module.exports = {
  T, QUIET_HOURS, noteRequest, trafficFindings, backupFindings, newestBackup, offsiteState, outboxFindings, compose, queueAlerts, heartbeat,
  runOpsWatchdog, status, _buckets: buckets,
};
