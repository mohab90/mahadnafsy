'use strict';
// Which clients show a part of a track beside its whole, or were booked in smaller tracks and now carry a bigger one: READ-ONLY.
//
// The owner, 13 Nov 2026: «مينفعش يظهر مسارين لنفس العميل … مينفعش تعرض جزء من الكل … مينفعش انت تروح محولهم لمسار العلاج الكامل». The screens now show one track
// per set of courses (lib/heldTracks.js) and track naming no longer joins booked tracks (lib/trackNaming.js); this lists what was already joined before that, so the
// owner can review it. It changes nothing.
//
//   (1) both_tracks   the client carries two tracks and one is inside the other (on his enrolments, his payments, his saved prices or money paid before the system)
//   (2) booked_small  he was booked (a payment names it) in smaller tracks, and his enrolments now carry a bigger track nobody booked him in; `named_by_system`
//                     is the date of the «track_named» entry in his history, when the system did it
//
// Only SELECT / SHOW statements are sent, the session is READ ONLY, and it will not start without explicit DB_* variables (it reads no .env, so it can never pick up a
// stale or production login by accident):
//
//   DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=... node tools/held-tracks-audit.cjs [--json] [--tenant <id>]
//
// Exit code: 0 = nothing found, 1 = clients found, 2 = could not run.

const { heldTracks } = require('../lib/heldTracks');

function requireDbEnv(env) {
  const missing = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'].filter(key => !env[key]);
  if (env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD');
  if (missing.length) throw new Error(`refusing to run without explicit database settings; missing: ${missing.join(', ')}`);
  return { host: env.DB_HOST, port: parseInt(env.DB_PORT, 10), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME };
}

function assertReadOnly(sql) {
  const text = String(sql).trim().replace(/;+\s*$/, '');
  if (text.includes(';')) throw new Error('refusing a multi-statement query');
  if (!/^(SELECT|SHOW|SET\s+SESSION\s+TRANSACTION\s+READ\s+ONLY)\b/i.test(text)) throw new Error(`refusing a non-SELECT statement: ${text.slice(0, 40)}`);
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|RENAME|CALL|LOCK|OUTFILE|DUMPFILE)\b/i.test(text)) throw new Error(`refusing a statement with a write keyword: ${text.slice(0, 40)}`);
  return text;
}

// The driver hands a date back at local midnight: read its local calendar day, not the UTC one.
const day = value => {
  if (!value) return null;
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * The clients to review, from the rows as they are stored. Pure: the tests feed it rows.
 * @param tracks    Map(trackId → { title, courses: string[] })
 * @param clients   Map(subscriberId → { code, name, enrolmentTracks: Set, bookedTracks: Map(trackId → firstBookingDate), moneyTracks: Set, namedBySystem: date|null })
 */
function findClients(tracks, clients) {
  const courses = new Map([...tracks].map(([id, track]) => [id, track.courses]));
  const titleOf = id => tracks.get(id)?.title || id;
  const found = [];
  for (const [subscriberId, client] of clients) {
    const recorded = new Set([...client.enrolmentTracks, ...client.bookedTracks.keys(), ...client.moneyTracks]);
    const { parts } = heldTracks({ tracks: courses, recorded, held: [] });
    if (parts.size) {
      found.push({
        kind: 'both_tracks', subscriberId, code: client.code, name: client.name,
        tracks: [...parts].map(([part, whole]) => ({ part: titleOf(part), whole: titleOf(whole) })),
        bookings: [...client.bookedTracks].map(([id, date]) => ({ track: titleOf(id), date: day(date) })),
      });
    }
    // booked in smaller ones, carrying a bigger one nobody booked
    const unbookedCarried = [...client.enrolmentTracks].filter(id => !client.bookedTracks.has(id) && !client.moneyTracks.has(id) && courses.has(id));
    const joined = unbookedCarried.filter(id => [...client.bookedTracks.keys()].some(booked => booked !== id && courses.has(booked)
      && courses.get(booked).every(course => courses.get(id).includes(course)) && courses.get(id).length > courses.get(booked).length));
    if (joined.length) {
      found.push({
        kind: 'booked_small', subscriberId, code: client.code, name: client.name,
        carries: joined.map(titleOf),
        bookings: [...client.bookedTracks].map(([id, date]) => ({ track: titleOf(id), date: day(date) })),
        named_by_system: day(client.namedBySystem),
      });
    }
  }
  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const tenant = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
  let conf;
  try { conf = requireDbEnv(process.env); } catch (error) { console.error(error.message); return 2; }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ ...conf, connectTimeout: 20000 });
  const run = async (sql, params = []) => { const [rows] = await conn.query(assertReadOnly(sql), params); return rows; };
  const scope = tenant ? ' AND tenant_id = ?' : '';
  const scoped = tenant ? [tenant] : [];
  try {
    await run('SET SESSION TRANSACTION READ ONLY');
    console.error(`[held-tracks-audit] ${conf.user}@${conf.host}:${conf.port}/${conf.database} - SELECT only`);
    const tracks = new Map();
    for (const row of await run(`SELECT b.id, b.title, bc.course_id FROM bundles b JOIN bundle_courses bc ON bc.bundle_id = b.id AND bc.tenant_id = b.tenant_id WHERE b.deleted_at IS NULL${tenant ? ' AND b.tenant_id = ?' : ''}`, scoped)) {
      const track = tracks.get(String(row.id)) || { title: row.title, courses: [] };
      track.courses.push(String(row.course_id));
      tracks.set(String(row.id), track);
    }
    const clients = new Map();
    const of = (id, row = {}) => {
      if (!clients.has(id)) clients.set(id, { code: row.client_code || null, name: row.name || null, enrolmentTracks: new Set(), bookedTracks: new Map(), moneyTracks: new Set(), namedBySystem: null });
      return clients.get(id);
    };
    for (const row of await run(`SELECT subscriber_id, bundle_id FROM enrollments WHERE status = 'active' AND bundle_id IS NOT NULL${scope}`, scoped)) of(row.subscriber_id).enrolmentTracks.add(String(row.bundle_id));
    for (const row of await run(`SELECT subscriber_id, bundle_id, MIN(date) AS first_date FROM payments WHERE deleted_at IS NULL AND bundle_id IS NOT NULL${scope} GROUP BY subscriber_id, bundle_id`, scoped)) of(row.subscriber_id).bookedTracks.set(String(row.bundle_id), row.first_date);
    for (const row of await run(`SELECT subscriber_id, SUBSTRING(item_key, 8) AS bundle_id FROM client_item_money WHERE item_key LIKE 'bundle:%'${scope}`, scoped)) of(row.subscriber_id).moneyTracks.add(String(row.bundle_id));
    for (const row of await run(`SELECT entity_id, MAX(at) AS at FROM activity_logs WHERE action = 'track_named' AND entity = 'subscriber'${scope} GROUP BY entity_id`, scoped)) if (clients.has(row.entity_id)) clients.get(row.entity_id).namedBySystem = row.at;
    const ids = [...clients.keys()];
    for (let i = 0; i < ids.length; i += 1000) {
      for (const row of await run('SELECT id, client_code, name FROM subscribers WHERE id IN (?)', [ids.slice(i, i + 1000)])) Object.assign(of(row.id), { code: row.client_code, name: row.name });
    }
    const found = findClients(tracks, clients);
    if (json) console.log(JSON.stringify(found, null, 2));
    else {
      for (const entry of found) {
        const what = entry.kind === 'both_tracks'
          ? entry.tracks.map(pair => `«${pair.part}» beside «${pair.whole}»`).join(' ; ')
          : `booked small, carries «${entry.carries.join('», «')}»${entry.named_by_system ? ` (named by the system ${entry.named_by_system})` : ''}`;
        console.log(`${entry.kind}\t${entry.code || ''}\t${entry.name || ''}\t${what}\tbookings: ${entry.bookings.map(booking => `${booking.track} ${booking.date}`).join(', ') || '-'}`);
      }
      console.error(`[held-tracks-audit] ${found.length} finding(s) over ${clients.size} client(s) holding a track`);
    }
    return found.length ? 1 : 0;
  } finally { await conn.end(); }
}

module.exports = { assertReadOnly, findClients, requireDbEnv };

if (require.main === module) {
  main().then(code => process.exit(code), error => { console.error('[held-tracks-audit] failed:', error.message); process.exit(2); });
}
