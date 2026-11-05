#!/usr/bin/env node
'use strict';

/**
 * Which registered routes nobody called — from what the API itself counted (table route_usage, lib/routeUsage.js). READ-ONLY.
 *
 *   node tools/route-usage-report.cjs            # the last 30 days
 *   node tools/route-usage-report.cjs --days=60
 *
 * A route is listed only if there is NO row for it in the period, and the report says how many days the table covers: with less than the period it has not seen
 * enough to say, and the list is a long way from «safe to delete». Webhooks, public links, scheduled and emergency routes are listed apart — nobody on the panel
 * calls them, which is not the same as nobody calling them. Nothing is deleted by this tool.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DAYS = Number((process.argv.find(arg => arg.startsWith('--days=')) || '--days=30').slice('--days='.length)) || 30;
const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const OUTSIDE = /^\/api\/(webhooks|public|seo|promo|qr|openapi|security\/csp-report|auth\/whatsapp|nps\/respond|me\/waitlist)|\/(respond|webhook)\b/;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out); else if (file.endsWith('.js')) out.push(file);
  }
  return out;
};

(async () => {
  const registered = new Map();
  for (const file of walk(ROUTES_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g)) {
      registered.set(`${match[1].toUpperCase()} ${match[2]}`, path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/'));
    }
  }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [[coverage]] = await db.query('SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(DISTINCT day) AS days FROM route_usage');
  const [used] = await db.query('SELECT DISTINCT method, route FROM route_usage WHERE day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)', [DAYS]);
  await db.end();
  const seen = new Set(used.map(row => `${row.method} ${row.route}`));
  const never = [...registered].filter(([key]) => !seen.has(key));
  const apart = never.filter(([key]) => OUTSIDE.test(key.split(' ')[1]));
  const candidates = never.filter(([key]) => !OUTSIDE.test(key.split(' ')[1]));
  console.log(`routes registered ......... ${registered.size}`);
  console.log(`called in the last ${DAYS} days .. ${seen.size}`);
  console.log(`the table covers .......... ${coverage.days || 0} day(s) (${coverage.first_day ? String(coverage.first_day).slice(0, 10) : '—'} → ${coverage.last_day ? String(coverage.last_day).slice(0, 10) : '—'})`);
  if (Number(coverage.days || 0) < DAYS) console.log(`\n!! less than ${DAYS} days are counted: the lists below are what has not been called SO FAR, not what is safe to delete.`);
  console.log(`\nnot called, outside the panel (webhooks, public, links — keep): ${apart.length}`);
  console.log(`not called, panel routes (candidates to review): ${candidates.length}\n`);
  const byFile = {};
  for (const [key, file] of candidates) (byFile[file] ||= []).push(key);
  for (const [file, list] of Object.entries(byFile).sort()) { console.log(file); list.forEach(key => console.log('   ' + key)); }
})().catch(error => { console.error(error.message); process.exit(1); });
