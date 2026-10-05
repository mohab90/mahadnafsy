'use strict';

// Each rep's own WhatsApp, linked to the system the way WhatsApp Web is: the
// system shows a QR code, the rep scans it from the phone (الإعدادات ←
// الأجهزة المرتبطة ← ربط جهاز), and from then on the system is one of that
// phone's linked devices — it receives the rep's chats and sends as them.
//
// Built on Baileys, the open-source WhatsApp Web client. It is not Meta's
// business API: WhatsApp can restrict a number that behaves like a bulk
// sender, so sends here are paced and capped per rep (WA_WEB_DAILY_LIMIT).
//
// One process holds every live connection. A phone allows one session per
// linked device, and two API processes (a release overlapping the old one)
// would each open it and keep knocking the other off. The process that holds
// the database lock 'mahad:wa-web' owns the sessions; another one answers
// "busy" until the lock frees and it takes over.
//
// The link keys are files under WA_WEB_DATA_DIR, outside the release directory
// so a deploy does not unlink everyone. What the screens show is in the
// database (lib/whatsappWebStore.js, migration 242).

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const baseLogger = require('./logger').child({ module: 'whatsapp-web' });
const { pool } = require('./db');
const store = require('./whatsappWebStore');
const { cairoDayStartUtc } = require('./dates');

const DATA_DIR = process.env.WA_WEB_DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/var/lib/mahad-api/wa-web' : path.join(__dirname, '..', '.data', 'wa-web'));
const DAILY_LIMIT = Math.max(1, Number(process.env.WA_WEB_DAILY_LIMIT || 1000));
const MIN_GAP_MS = Math.max(0, Number(process.env.WA_WEB_MIN_GAP_MS || 1500));
const HISTORY_DAYS = Math.max(1, Number(process.env.WA_WEB_HISTORY_DAYS || 30));
// Per database (lib/lockName.js): staging on the same MariaDB held the server-wide
// name and production never got its WhatsApp sessions.
const OWNER_LOCK = require('./lockName').scopedLockName('mahad:wa-web');

const sessions = new Map();
let baileys = null;
let ownerConn = null;
let ownerTimer = null;

const keyOf = (tenantId, staffId) => `${tenantId}:${staffId}`;
const safe = value => String(value).replace(/[^A-Za-z0-9_-]/g, '_');
const authDir = (tenantId, staffId) => path.join(DATA_DIR, safe(tenantId), safe(staffId));

class WaWebError extends Error {
  constructor(statusCode, message, code) { super(message); this.statusCode = statusCode; this.code = code; }
}

async function lib() {
  if (!baileys) baileys = await import('@whiskeysockets/baileys');
  return baileys;
}

// Baileys logs through a pino-shaped object; its chatter stays at debug.
function quietLogger(bindings = {}) {
  const log = level => (obj, msg) => {
    if (level === 'error' || level === 'fatal') baseLogger.debug('[baileys]', msg || '', { ...bindings, level });
  };
  return {
    level: 'warn',
    trace: log('trace'), debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error'), fatal: log('fatal'),
    child: more => quietLogger({ ...bindings, ...more }),
  };
}

async function saveState(tenantId, staffId, fields) {
  const columns = Object.keys(fields);
  await pool.query(
    `INSERT INTO wa_web_sessions (tenant_id, staff_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${columns.map(c => `${c}=VALUES(${c})`).join(', ')}`,
    [tenantId, staffId, ...columns.map(c => fields[c])]).catch(error => baseLogger.warn('[wa-web] state not saved', error.message));
}

function isOwner() { return Boolean(ownerConn); }

/** Take the lock that makes this process the one holding the connections. */
async function claimOwnership() {
  if (ownerConn) return true;
  let conn;
  try {
    conn = await pool.getConnection();
    const [[row]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [OWNER_LOCK]);
    if (Number(row?.got) !== 1) { conn.release(); return false; }
    ownerConn = conn;
    // The lock dies with the connection; a dropped connection means another
    // process may now hold it, so this one stops acting as the owner.
    conn.connection?.on?.('error', () => { ownerConn = null; });
    return true;
  } catch (error) {
    if (conn && conn !== ownerConn) conn.release();
    baseLogger.warn('[wa-web] ownership check failed', error.message);
    return false;
  }
}

/** Start owning the sessions when possible, and reconnect the linked ones. */
function startWhatsappWeb() {
  if (process.env.WA_WEB_DISABLED === '1' || ownerTimer) return;
  const attempt = async () => {
    if (ownerConn) {
      // Kept busy so the server's idle timeout never closes it and the lock with it.
      await ownerConn.query('SELECT 1').catch(() => {
        baseLogger.warn('[wa-web] lost the sessions lock');
        try { ownerConn.destroy(); } catch { /* already gone */ }
        ownerConn = null;
        // Another process may take the lock now; two connections to one phone
        // knock each other off, so this one closes its own.
        for (const session of sessions.values()) { try { session.sock?.end?.(undefined); } catch { /* closing */ } }
        sessions.clear();
      });
      return;
    }
    if (!(await claimOwnership())) return;
    baseLogger.info('[wa-web] this process holds the WhatsApp sessions');
    const [rows] = await pool.query("SELECT tenant_id, staff_id FROM wa_web_sessions WHERE status IN ('connected','linking')")
      .catch(() => [[]]);
    for (const [index, row] of rows.entries()) {
      if (!fs.existsSync(path.join(authDir(row.tenant_id, row.staff_id), 'creds.json'))) {
        await saveState(row.tenant_id, row.staff_id, { status: 'disconnected' });
        continue;
      }
      // Staggered: forty phones reconnecting in the same second look like an attack.
      setTimeout(() => connect(row.tenant_id, row.staff_id).catch(error =>
        baseLogger.warn('[wa-web] reconnect failed', { staffId: row.staff_id, error: error.message })), index * 1500);
    }
  };
  attempt();
  ownerTimer = setInterval(attempt, 30000);
  ownerTimer.unref?.();
}

function requireOwner() {
  if (!isOwner()) throw new WaWebError(503, 'خدمة الواتساب بتشتغل دلوقتي — جرّب كمان دقيقة', 'WA_WEB_BUSY');
}

/**
 * Open (or reopen) a rep's session. Without saved link keys this produces a
 * QR code for the rep to scan; with them it reconnects silently.
 */
async function connect(tenantId, staffId) {
  requireOwner();
  const key = keyOf(tenantId, staffId);
  const existing = sessions.get(key);
  if (existing && ['connecting', 'linking', 'connected'].includes(existing.status)) return publicState(existing);

  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await lib();
  const dir = authDir(tenantId, staffId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const session = existing || { tenantId, staffId, retries: 0 };
  Object.assign(session, { status: 'connecting', qr: null, qrAt: null, lastError: null, lastSendAt: 0 });
  sessions.set(key, session);

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: quietLogger({ staffId }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  session.sock = sock;
  const current = () => sessions.get(key) === session && session.sock === sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async update => {
    if (!current()) return;
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      session.status = 'linking';
      session.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 }).catch(() => null);
      session.qrAt = Date.now();
      await saveState(tenantId, staffId, { status: 'linking' });
    }
    if (connection === 'open') {
      session.status = 'connected';
      session.qr = null;
      session.retries = 0;
      const id = String(sock.user?.id || '');
      session.phone = id.split(/[:@]/)[0] || null;
      session.name = sock.user?.name || sock.user?.verifiedName || null;
      await saveState(tenantId, staffId, {
        status: 'connected', phone: session.phone, wa_name: session.name, linked_at: new Date(), last_seen_at: new Date(), last_error: null,
      });
      baseLogger.info('[wa-web] linked', { staffId, phone: session.phone });
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const linked = Boolean(state.creds?.registered || state.creds?.me);
      session.sock = null;
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        // Unlinked from the phone (or the keys are spoiled): forget them so the
        // next connect starts a fresh QR instead of failing forever.
        fs.rmSync(dir, { recursive: true, force: true });
        session.status = 'logged_out';
        await saveState(tenantId, staffId, { status: 'logged_out', last_error: 'unlinked from the phone' });
        return;
      }
      if (!linked) {
        // The QR codes ran out with nobody scanning: wait for the rep to ask again.
        session.status = 'disconnected';
        session.qr = null;
        await saveState(tenantId, staffId, { status: 'disconnected' });
        return;
      }
      // A linked session dropped (network, a restart WhatsApp asks for right
      // after linking): reconnect, backing off up to a minute.
      session.status = 'reconnecting';
      session.retries += 1;
      const delay = code === DisconnectReason.restartRequired ? 500 : Math.min(60000, 2000 * 2 ** Math.min(session.retries, 5));
      setTimeout(() => {
        if (sessions.get(key) !== session || session.status !== 'reconnecting' || !isOwner()) return;
        connect(tenantId, staffId).catch(error => baseLogger.warn('[wa-web] reconnect failed', { staffId, error: error.message }));
      }, delay).unref?.();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!current()) return;
    try {
      const live = type === 'notify';
      const parsed = (messages || []).map(store.parseWaMessage).filter(Boolean);
      const fresh = await store.recordMessages(tenantId, staffId, parsed, { countUnread: live });
      if (live) {
        for (const row of fresh) {
          const match = await store.matchChat(tenantId, staffId, row.jid);
          await store.logToCrm(tenantId, staffId, row, match);
        }
        await saveState(tenantId, staffId, { last_seen_at: new Date() });
      }
    } catch (error) { baseLogger.warn('[wa-web] messages not stored', { staffId, error: error.message }); }
  });

  sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
    if (!current()) return;
    try {
      const since = Date.now() - HISTORY_DAYS * 86400000;
      const parsed = (messages || []).map(store.parseWaMessage).filter(row => row && row.sentAt.getTime() >= since);
      await store.recordMessages(tenantId, staffId, parsed, { countUnread: false });
      await store.recordContactNames(tenantId, staffId, contacts);
    } catch (error) { baseLogger.warn('[wa-web] history not stored', { staffId, error: error.message }); }
  });

  sock.ev.on('contacts.upsert', contacts => { if (current()) store.recordContactNames(tenantId, staffId, contacts).catch(() => {}); });

  return publicState(session);
}

function publicState(session) {
  return {
    status: session.status,
    qr: session.status === 'linking' ? session.qr : null,
    phone: session.phone || null,
    name: session.name || null,
    lastError: session.lastError || null,
  };
}

/** What the tab shows at the top: linked, waiting for a scan, or not linked. */
async function getState(tenantId, staffId) {
  const live = sessions.get(keyOf(tenantId, staffId));
  if (live && isOwner()) return publicState(live);
  const [[row]] = await pool.query(
    'SELECT status, phone, wa_name, last_error FROM wa_web_sessions WHERE tenant_id=? AND staff_id=?', [tenantId, staffId]);
  // A row saying "connected" with no live session here means it is still
  // reconnecting (or another process holds it) — not linked from the rep's view yet.
  const status = !row ? 'disconnected' : row.status === 'connected' ? 'reconnecting' : row.status;
  return { status, qr: null, phone: row?.phone || null, name: row?.wa_name || null, lastError: row?.last_error || null };
}

async function logout(tenantId, staffId) {
  requireOwner();
  const key = keyOf(tenantId, staffId);
  const session = sessions.get(key);
  sessions.delete(key);
  if (session?.sock) {
    await session.sock.logout().catch(() => {});
    session.sock.end?.(undefined);
  }
  fs.rmSync(authDir(tenantId, staffId), { recursive: true, force: true });
  await saveState(tenantId, staffId, { status: 'logged_out', last_error: null });
}

async function sentToday(tenantId, staffId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM wa_web_messages
      WHERE tenant_id=? AND sent_by_system=1 AND sent_at >= ? AND staff_id=?`, [tenantId, cairoDayStartUtc(), staffId]);
  return Number(row?.n || 0);
}

/**
 * Send a text from the rep's own WhatsApp to a chat or a phone number,
 * record it, and put it on the lead's or client's timeline.
 */
async function sendText(tenantId, staffId, { jid, phone, text }) {
  requireOwner();
  const body = String(text || '').trim();
  if (!body) throw new WaWebError(400, 'اكتب الرسالة الأول');
  if (body.length > 4000) throw new WaWebError(400, 'الرسالة طويلة جداً');
  const session = sessions.get(keyOf(tenantId, staffId));
  if (!session?.sock || session.status !== 'connected') {
    throw new WaWebError(409, 'الواتساب بتاعك مش مربوط — اربطه من الكود الأول', 'WA_WEB_NOT_LINKED');
  }
  const to = jid ? String(jid) : store.jidForPhone(phone);
  if (!to || !/@(s\.whatsapp\.net|lid)$/.test(to)) throw new WaWebError(400, 'الرقم مش صالح للإرسال');

  if ((await sentToday(tenantId, staffId)) >= DAILY_LIMIT) {
    throw new WaWebError(429, `وصلت للحد اليومي (${DAILY_LIMIT} رسالة) — ده لحماية رقمك من الحظر`, 'WA_WEB_DAILY_LIMIT');
  }
  // Paced per rep: a burst of identical messages is what gets a number banned.
  const wait = session.lastSendAt + MIN_GAP_MS - Date.now();
  session.lastSendAt = Math.max(Date.now(), session.lastSendAt + MIN_GAP_MS);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));

  if (!jid) {
    // A number typed by hand: check it is on WhatsApp before sending into the void.
    const [found] = await session.sock.onWhatsApp(to).catch(() => []);
    if (found && found.exists === false) throw new WaWebError(404, 'الرقم ده مش عليه واتساب');
  }
  const sent = await session.sock.sendMessage(to, { text: body });
  const row = store.parseWaMessage({ ...sent, key: { ...(sent?.key || {}), remoteJid: sent?.key?.remoteJid || to, fromMe: true } })
    || { jid: to, phone: store.phoneOfJid(to), waId: String(sent?.key?.id || `local-${Date.now()}`), fromMe: true, body, kind: 'text', sentAt: new Date() };
  await store.recordMessages(tenantId, staffId, [row], { sentBySystem: true, countUnread: false });
  // The phone may have echoed the message back before this line ran, in which
  // case it was stored as sent from the phone; it was sent from here.
  await pool.query('UPDATE wa_web_messages SET sent_by_system=1 WHERE tenant_id=? AND staff_id=? AND wa_id=?',
    [tenantId, staffId, row.waId]);
  const match = await store.matchChat(tenantId, staffId, row.jid);
  await store.logToCrm(tenantId, staffId, row, match);
  return { ...row, ...match, sentToday: await sentToday(tenantId, staffId), dailyLimit: DAILY_LIMIT };
}

// Tests stand in a fake phone connection; nothing in the app calls these.
const _testing = {
  attach(tenantId, staffId, sock) {
    ownerConn = ownerConn || { query: async () => [[]], destroy() {} };
    sessions.set(keyOf(tenantId, staffId), { tenantId, staffId, sock, status: 'connected', lastSendAt: 0, retries: 0 });
  },
  reset() { sessions.clear(); ownerConn = null; },
};

module.exports = {
  WaWebError, startWhatsappWeb, connect, getState, logout, sendText, sentToday, isOwner, DAILY_LIMIT, _testing,
};
