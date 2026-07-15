'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdminOrStaff } = require('../middleware/auth');

// GET /api/admin/subscribers/:id/qr
router.get('/api/admin/subscribers/:id/qr', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const QRCode = require('qrcode');
    const qrDataUrl = await QRCode.toDataURL(id, { width: 300, margin: 2 });
    
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
          <h2>بطاقة حضور الطالب</h2>
          <img src="${qrDataUrl}" alt="QR Code">
          <p style="color:#64748b;font-family:monospace;font-size:1.2rem;">${id}</p>
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
