#!/usr/bin/env node
'use strict';

/**
 * How fast the system is on the real data — run on the server, read-only.
 *
 * Load tests on seeded data said where the code could be slow; this says where
 * it is. Three sources, none of which needs a login or touches a row:
 *
 *   1. The API's own request log. Every request is already logged with its
 *      path and how long it took (lib/httpApp.js → journald). Grouped by route
 *      with ids folded, that is a ranking of the slowest screens as people
 *      actually used them.
 *   2. MariaDB's slow query log, written to the mysql.slow_log table while it
 *      is on. `start` turns it on (queries over 0.3 s), `stop` turns it off;
 *      in between, a normal working day fills it. The report groups the
 *      statements by shape and shows EXPLAIN for the worst reads.
 *   3. The size of every table, from information_schema.
 *
 *   node tools/perf-report.cjs start                 # turn the slow log on
 *   node tools/perf-report.cjs                       # report (last 24 h of requests)
 *   node tools/perf-report.cjs --since "3 days ago"  # a longer window
 *   node tools/perf-report.cjs --log-file api.log    # requests from a file instead of journald
 *   node tools/perf-report.cjs stop                  # turn the slow log off
 *
 * Turning the slow log on needs a database account that may SET GLOBAL. The
 * app's account usually may not; when it is refused the tool prints the two
 * lines to run as root (`sudo mysql`) instead.
 *
 * The report is printed and saved as perf-report-YYYY-MM-DD.md next to the API.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SLOW_SECONDS = 0.3;
const SERVICE = process.env.MAHAD_API_SERVICE || 'mahad-api';

/** /api/admin/leads/3f2a…/notes/17 → /api/admin/leads/:id/notes/:id */
function routeKey(urlPath) {
  return String(urlPath || '').split('?')[0].split('/').map(segment => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
    if (/^[A-Za-z0-9_-]{20,}$/.test(segment) && /\d/.test(segment)) return ':id';
    if (/@/.test(segment) || /^\+?\d[\d\s-]{6,}$/.test(segment)) return ':id';
    if (/^(rv|lead|sub|cust|pay|ord|tenant)-[\w-]+$/i.test(segment)) return ':id';
    return segment;
  }).join('/');
}

/** One SQL statement's shape: literals and IN-lists folded, whitespace squeezed. */
function sqlShape(sql) {
  return String(sql || '')
    .replace(/'(?:[^'\\]|\\.)*'/g, '?')
    .replace(/"(?:[^"\\]|\\.)*"/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(\s*,\s*\?)*\s*\)/g, '(?+)')
    .replace(/\s+/g, ' ')
    .trim();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** JSON request lines → per-route timing, slowest first. */
function summarizeRequests(lines) {
  const byRoute = new Map();
  let read = 0;
  for (const line of lines) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    let entry;
    try { entry = JSON.parse(line.slice(start)); } catch { continue; }
    // Outside production the logger prints «[INFO] <ts> http {…}», the meta alone.
    if (entry.msg === undefined && /\shttp \{/.test(line)) entry.msg = 'http';
    if (entry.msg !== 'http' || !Number.isFinite(Number(entry.ms)) || !entry.path) continue;
    read += 1;
    const key = `${entry.method || 'GET'} ${routeKey(entry.path)}`;
    const row = byRoute.get(key) || { key, ms: [], errors: 0 };
    row.ms.push(Number(entry.ms));
    if (Number(entry.status) >= 500) row.errors += 1;
    byRoute.set(key, row);
  }
  const routes = [...byRoute.values()].map(row => {
    const sorted = row.ms.sort((a, b) => a - b);
    return {
      route: row.key,
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1],
      totalSec: Math.round(sorted.reduce((s, v) => s + v, 0) / 100) / 10,
      errors: row.errors,
    };
  });
  return { read, routes };
}

function requestLines({ logFile, since }) {
  if (logFile) return fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  try {
    return execFileSync('journalctl', ['-u', SERVICE, '--since', since, '-o', 'cat', '--no-pager'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }).split('\n');
  } catch (error) {
    return { error: `journalctl -u ${SERVICE}: ${error.message.split('\n')[0]}` };
  }
}

const fmtMs = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const cell = text => String(text).replace(/\|/g, '\\|');

async function slowLogReport(pool, dbName, out) {
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT sql_text, TIME_TO_SEC(query_time) AS secs, rows_examined, rows_sent
         FROM mysql.slow_log WHERE db = ? ORDER BY start_time DESC LIMIT 20000`, [dbName]);
  } catch (error) {
    out.push(`> ما قدرتش أقرا mysql.slow_log (${error.code || error.message}). اديله صلاحية القراءة مرة واحدة:`,
      `> \`sudo mysql -e "GRANT SELECT ON mysql.slow_log TO '${process.env.DB_USER}'@'localhost'"\``);
    return;
  }
  if (!rows.length) {
    out.push('> سجل الاستعلامات البطيئة فاضي. يا إما ما اتشغّلش (`start`)، يا إما مفيش استعلام أبطأ من '
      + `${SLOW_SECONDS} ثانية — وده كويس.`);
    return;
  }
  const byShape = new Map();
  for (const row of rows) {
    const text = Buffer.isBuffer(row.sql_text) ? row.sql_text.toString('utf8') : String(row.sql_text || '');
    const shape = sqlShape(text);
    const entry = byShape.get(shape) || { shape, sample: text, count: 0, total: 0, max: 0, examined: 0 };
    entry.count += 1;
    entry.total += Number(row.secs) || 0;
    entry.max = Math.max(entry.max, Number(row.secs) || 0);
    entry.examined = Math.max(entry.examined, Number(row.rows_examined) || 0);
    byShape.set(shape, entry);
  }
  const worst = [...byShape.values()].sort((a, b) => b.total - a.total).slice(0, 20);
  out.push(`${rows.length} استعلام بطيء، ${byShape.size} شكل مختلف. أكتر 20 واخدين وقت:`, '');
  out.push('| # | مرات | إجمالي | أبطأ مرة | أكتر صفوف اتقرت | الاستعلام |', '|---|---|---|---|---|---|');
  worst.forEach((w, i) => out.push(
    `| ${i + 1} | ${w.count} | ${w.total.toFixed(1)} s | ${w.max.toFixed(2)} s | ${w.examined.toLocaleString('en')} | \`${cell(w.shape.slice(0, 160))}\` |`));
  out.push('', '### خطة التنفيذ (EXPLAIN) لأبطأ 8 قراءات', '');
  let explained = 0;
  for (const w of worst) {
    if (explained >= 8) break;
    if (!/^\s*(SELECT|WITH)\b/i.test(w.sample)) continue;
    explained += 1;
    try {
      const [plan] = await pool.query(`EXPLAIN ${w.sample}`);
      out.push(`**#${worst.indexOf(w) + 1}**`, '', '| table | type | key | rows | Extra |', '|---|---|---|---|---|');
      for (const p of plan) out.push(`| ${p.table || ''} | ${p.type || ''} | ${p.key || '—'} | ${p.rows ?? ''} | ${cell(p.Extra || '')} |`);
      out.push('');
    } catch (error) {
      out.push(`**#${worst.indexOf(w) + 1}**: EXPLAIN اترفض (${error.code || error.message})`, '');
    }
  }
}

async function main(argv) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const action = ['start', 'stop'].includes(argv[0]) ? argv[0] : 'report';
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    connectionLimit: 2, multipleStatements: false,
  });
  const dbName = process.env.DB_NAME;
  try {
    if (action !== 'report') {
      const on = action === 'start';
      const statements = on
        ? ["SET GLOBAL log_output = 'TABLE'", `SET GLOBAL long_query_time = ${SLOW_SECONDS}`, 'SET GLOBAL slow_query_log = 1']
        : ['SET GLOBAL slow_query_log = 0'];
      try {
        for (const sql of statements) await pool.query(sql);
        console.log(on
          ? `سجل الاستعلامات البطيئة اشتغل (أبطأ من ${SLOW_SECONDS} ثانية). سيبه يوم شغل عادي وبعدين شغّل: node tools/perf-report.cjs`
          : 'سجل الاستعلامات البطيئة اتقفل.');
      } catch (error) {
        console.log(`حساب قاعدة البيانات بتاع السيستم ما ينفعش يغيّر الإعداد ده (${error.code}). شغّل ده بدلها:`);
        console.log(`  sudo mysql -e "${statements.join('; ')}"`);
      }
      return;
    }

    const since = flag('--since') || '24 hours ago';
    const out = [`# تقرير الأداء — ${new Date().toISOString().slice(0, 10)}`, ''];

    out.push(`## أبطأ الشاشات (طلبات الـAPI، ${flag('--log-file') ? flag('--log-file') : since})`, '');
    const lines = requestLines({ logFile: flag('--log-file'), since });
    if (lines.error) out.push(`> ${lines.error}`);
    else {
      const { read, routes } = summarizeRequests(lines);
      out.push(`${read.toLocaleString('en')} طلب. الترتيب بأبطأ 5% من المرات (p95)، للمسارات اللي اتطلبت 5 مرات أو أكتر:`, '');
      out.push('| المسار | مرات | المعتاد (p50) | p95 | أبطأ مرة | أخطاء 5xx |', '|---|---|---|---|---|---|');
      for (const r of routes.filter(r => r.count >= 5).sort((a, b) => b.p95 - a.p95).slice(0, 25)) {
        out.push(`| \`${cell(r.route)}\` | ${r.count} | ${fmtMs(r.p50)} | ${fmtMs(r.p95)} | ${fmtMs(r.max)} | ${r.errors || ''} |`);
      }
      out.push('', 'أكتر مسارات واخدة وقت من السيرفر في المجموع:', '');
      for (const r of [...routes].sort((a, b) => b.totalSec - a.totalSec).slice(0, 10)) {
        out.push(`- \`${r.route}\`: ${r.totalSec} ثانية في ${r.count} طلب`);
      }
    }

    out.push('', `## أبطأ الاستعلامات (MariaDB، أبطأ من ${SLOW_SECONDS} ثانية)`, '');
    await slowLogReport(pool, dbName, out);

    out.push('', '## أكبر الجداول', '', '| الجدول | صفوف (تقريبي) | بيانات | فهارس |', '|---|---|---|---|');
    const [tables] = await pool.query(
      `SELECT table_name AS name, table_rows AS row_count, data_length AS data_bytes, index_length AS index_bytes
         FROM information_schema.tables WHERE table_schema = ? ORDER BY data_length + index_length DESC LIMIT 20`, [dbName]);
    const mb = bytes => `${(Number(bytes) / 1048576).toFixed(1)} MB`;
    for (const t of tables) out.push(`| ${t.name} | ${Number(t.row_count).toLocaleString('en')} | ${mb(t.data_bytes)} | ${mb(t.index_bytes)} |`);

    const report = out.join('\n') + '\n';
    const file = path.join(__dirname, '..', `perf-report-${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(file, report);
    console.log(report);
    console.log(`اتحفظ في ${file} — ابعته.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { routeKey, sqlShape, summarizeRequests, percentile };
