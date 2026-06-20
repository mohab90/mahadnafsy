'use strict';
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/api/admin/inbox', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, channel, contact_name, contact_id, contact_avatar, last_message, last_message_at,
       unread_count, status, assigned_to_staff_id, assigned_to_staff_name, tags, messages,
       linked_lead_id, linked_subscriber_id, created_at
       FROM inbox_conversations ORDER BY last_message_at DESC LIMIT 500`
    );
    res.json(rows.map(r => ({ ...r, tags: tryJson(r.tags, []), messages: tryJson(r.messages, []) })));
  } catch (e) {
    console.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/inbox', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = req.body;
    const id = c.id || uuidv4();
    await pool.query(
      `INSERT INTO inbox_conversations (id, channel, contact_name, contact_id, contact_avatar,
         last_message, last_message_at, unread_count, status, assigned_to_staff_id,
         assigned_to_staff_name, tags, messages, linked_lead_id, linked_subscriber_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         last_message=VALUES(last_message), last_message_at=VALUES(last_message_at),
         unread_count=VALUES(unread_count), status=VALUES(status),
         assigned_to_staff_id=VALUES(assigned_to_staff_id),
         assigned_to_staff_name=VALUES(assigned_to_staff_name),
         tags=VALUES(tags), messages=VALUES(messages)`,
      [
        id, c.channel || 'whatsapp', c.contactName || c.contact_name || '',
        c.contactId || c.contact_id || '', c.contactAvatar || null,
        c.lastMessage || c.last_message || '', c.lastMessageAt || c.last_message_at || '',
        c.unreadCount || 0, c.status || 'open',
        c.assignedToStaffId || c.assigned_to_staff_id || null,
        c.assignedToStaffName || c.assigned_to_staff_name || null,
        JSON.stringify(c.tags || []), JSON.stringify(c.messages || []),
        c.linkedLeadId || null, c.linkedSubscriberId || null,
        c.createdAt || new Date().toISOString(),
      ]
    );
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/inbox/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM inbox_conversations WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
