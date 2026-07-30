'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { pool } = require('../lib/db');
const { createAttendanceQr } = require('../lib/attendanceQr');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

// GET /api/admin/subscribers/:id/qr
router.get('/api/admin/subscribers/:id/qr', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const { id } = req.params;
    const [[subscriber]] = await pool.query(
      'SELECT id,client_code,name FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [id, req.tenantId]
    );
    if (!subscriber) return res.status(404).send('العميل غير موجود');
    const QRCode = require('qrcode');
    const qrToken = createAttendanceQr({ tenantId: req.tenantId, subscriberId: subscriber.id });
    const qrDataUrl = await QRCode.toDataURL(qrToken, { width: 300, margin: 2 });
    const displayName = escapeHtml(subscriber.name || 'الطالب');
    const displayCode = escapeHtml(subscriber.client_code || subscriber.id);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>بطاقة الطالب - ${id}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f8fafc; margin: 0; }
          .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; border: 2px solid #e2e8f0; }
          .card h2 { color: #1e293b; margin-top: 0; }
          img { max-width: 100%; height: auto; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 20px; }
          button { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 16px; margin-top: 10px; }
          button:hover { background: #2563eb; }
          @media print {
            body { background: white; }
            .card { box-shadow: none; border: none; padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>بطاقة حضور ${displayName}</h2>
          <img src="${qrDataUrl}" alt="QR Code">
          <p style="color:#64748b;font-family:monospace;font-size:1.2rem;">${displayCode}</p>
          <button onclick="window.print()">طباعة البطاقة</button>
        </div>
      </body>
      </html>
    `);
  } catch (e) {
    res.status(500).send('حدث خطأ داخلي في الخادم');
  }
});

module.exports = router;
