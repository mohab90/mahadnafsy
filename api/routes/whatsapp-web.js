'use strict';
/**
 * The «واتساب» tab: a rep links their own WhatsApp by QR, reads their chats and
 * sends from the system (lib/whatsappWeb.js). Every rep sees only their own
 * session and chats; the message counts are theirs, or everyone's for a
 * manager who sees all data.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'whatsapp-web-route' });
const { pool } = require('../lib/db');
const wa = require('../lib/whatsappWeb');
const { requireAuth, requireAdminOrStaff, requireChannel } = require('../middleware/auth');
const { resolveDataScope } = require('../constants/permissions');
const { cairoToday, addDaysToDateOnly, cairoDayStartUtc } = require('../lib/dates');

const guard = [requireAuth, requireAdminOrStaff, requireChannel('whatsapp')];
const me = req => req.staffRecord?.id || req.user?.uid;
const tenant = req => req.tenantId;

function fail(res, error, where) {
  if (error instanceof wa.WaWebError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/api/staff/whatsapp-web/state', ...guard, async (req, res) => {
  try {
    const state = await wa.getState(tenant(req), me(req));
    res.json({ ...state, sentToday: await wa.sentToday(tenant(req), me(req)), dailyLimit: wa.DAILY_LIMIT });
  } catch (error) { fail(res, error, '[wa-web state]'); }
});

router.post('/api/staff/whatsapp-web/connect', ...guard, async (req, res) => {
  try { res.json(await wa.connect(tenant(req), me(req))); } catch (error) { fail(res, error, '[wa-web connect]'); }
});

router.post('/api/staff/whatsapp-web/logout', ...guard, async (req, res) => {
  try { await wa.logout(tenant(req), me(req)); res.json({ ok: true }); } catch (error) { fail(res, error, '[wa-web logout]'); }
});

router.get('/api/staff/whatsapp-web/chats', ...guard, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const params = [tenant(req), me(req)];
    let where = '';
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      const digits = q.replace(/\D/g, '');
      where = ` AND (c.name LIKE ? OR l.name LIKE ? OR s.name LIKE ?${digits.length >= 3 ? ' OR c.phone LIKE ?' : ''})`;
      params.push(like, like, like);
      if (digits.length >= 3) params.push(`%${digits}%`);
    }
    const [rows] = await pool.query(
      `SELECT c.jid, c.phone, c.name, c.last_message AS lastMessage, c.last_at AS lastAt, c.unread,
              c.lead_id AS leadId, c.subscriber_id AS subscriberId,
              COALESCE(s.name, l.name) AS crmName, COALESCE(l.client_code, s.client_code) AS clientCode
         FROM wa_web_chats c
         LEFT JOIN leads l ON l.tenant_id = c.tenant_id AND l.id = c.lead_id
         LEFT JOIN subscribers s ON s.tenant_id = c.tenant_id AND s.id = c.subscriber_id
        WHERE c.tenant_id=? AND c.staff_id=?${where}
        ORDER BY c.last_at DESC LIMIT ${limit}`, params);
    res.json({ chats: rows });
  } catch (error) { fail(res, error, '[wa-web chats]'); }
});

router.get('/api/staff/whatsapp-web/messages', ...guard, async (req, res) => {
  try {
    const jid = String(req.query.jid || '');
    if (!jid) return res.status(400).json({ error: 'jid is required' });
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const params = [tenant(req), me(req), jid];
    let older = '';
    if (before && !Number.isNaN(before.getTime())) { older = ' AND sent_at < ?'; params.push(before); }
    const [rows] = await pool.query(
      `SELECT id, wa_id AS waId, from_me AS fromMe, sent_by_system AS sentBySystem, body, kind, sent_at AS sentAt
         FROM wa_web_messages WHERE tenant_id=? AND staff_id=? AND jid=?${older}
        ORDER BY sent_at DESC, id DESC LIMIT 80`, params);
    // Opening a chat reads it, and is when its number is matched to the CRM.
    await pool.query('UPDATE wa_web_chats SET unread=0 WHERE tenant_id=? AND staff_id=? AND jid=?', [tenant(req), me(req), jid]);
    const { matchChat } = require('../lib/whatsappWebStore');
    const match = await matchChat(tenant(req), me(req), jid);
    res.json({ messages: rows.reverse().map(r => ({ ...r, fromMe: Boolean(r.fromMe), sentBySystem: Boolean(r.sentBySystem) })), ...match });
  } catch (error) { fail(res, error, '[wa-web messages]'); }
});

router.post('/api/staff/whatsapp-web/send', ...guard, async (req, res) => {
  try {
    const { jid, phone, text } = req.body || {};
    res.json({ ok: true, message: await wa.sendText(tenant(req), me(req), { jid, phone, text }) });
  } catch (error) { fail(res, error, '[wa-web send]'); }
});

/**
 * Messages per rep and day. sentBySystem = typed in this tab (what the tab
 * counts); sentFromPhone = what the rep sent from the phone itself; received.
 * At most 31 days.
 */
router.get('/api/staff/whatsapp-web/stats', ...guard, async (req, res) => {
  try {
    const today = cairoToday();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : addDaysToDateOnly(today, -6);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : today;
    if (from > to || addDaysToDateOnly(from, 31) < to) return res.status(400).json({ error: 'اختار فترة لحد 31 يوم' });
    const everyone = resolveDataScope(req.staffRecord, { isSuperAdmin: req.isSuperAdmin }) === 'all';
    // Stored in UTC; a day here is a Cairo day. Counted per UTC hour in the
    // database and folded into Cairo days below.
    const params = [tenant(req), cairoDayStartUtc(from), cairoDayStartUtc(addDaysToDateOnly(to, 1))];
    if (!everyone) params.push(me(req));
    const [hours] = await pool.query(
      `SELECT m.staff_id AS staffId, DATE_FORMAT(m.sent_at, '%Y-%m-%dT%H:00:00Z') AS hour,
              SUM(m.from_me = 1 AND m.sent_by_system = 1) AS sentBySystem,
              SUM(m.from_me = 1 AND m.sent_by_system = 0) AS sentFromPhone,
              SUM(m.from_me = 0) AS received
         FROM wa_web_messages m
        WHERE m.tenant_id=? AND m.sent_at >= ? AND m.sent_at < ?${everyone ? '' : ' AND m.staff_id=?'}
        GROUP BY m.staff_id, hour`, params);
    const byDay = new Map();
    for (const h of hours) {
      const day = cairoToday(new Date(h.hour));
      const key = `${h.staffId}|${day}`;
      const row = byDay.get(key) || { staffId: h.staffId, day, sentBySystem: 0, sentFromPhone: 0, received: 0 };
      row.sentBySystem += Number(h.sentBySystem); row.sentFromPhone += Number(h.sentFromPhone); row.received += Number(h.received);
      byDay.set(key, row);
    }
    const staffIds = [...new Set(hours.map(h => h.staffId))];
    const [names] = staffIds.length
      ? await pool.query('SELECT id, name FROM staff WHERE tenant_id=? AND id IN (?)', [tenant(req), staffIds])
      : [[]];
    const nameOf = new Map(names.map(n => [n.id, n.name]));
    const rows = [...byDay.values()]
      .map(row => ({ ...row, staffName: nameOf.get(row.staffId) || null }))
      .sort((a, b) => b.day.localeCompare(a.day) || b.sentBySystem - a.sentBySystem);
    const [sessions] = await pool.query(
      `SELECT w.staff_id AS staffId, st.name AS staffName, w.status, w.phone, w.last_seen_at AS lastSeenAt
         FROM wa_web_sessions w LEFT JOIN staff st ON st.tenant_id = w.tenant_id AND st.id = w.staff_id
        WHERE w.tenant_id=?${everyone ? '' : ' AND w.staff_id=?'}`, everyone ? [tenant(req)] : [tenant(req), me(req)]);
    res.json({
      from, to, everyone,
      rows,
      sessions,
    });
  } catch (error) { fail(res, error, '[wa-web stats]'); }
});

module.exports = router;
