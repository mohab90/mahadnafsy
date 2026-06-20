'use strict';
// ── Email helpers ─────────────────────────────────────────────────────────────
const nodemailer = require('nodemailer');

const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.hostinger.com',
  port:   parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'info@mahadnafsy.com',
    pass: process.env.SMTP_PASS || '',
  },
});

function htmlEmail(title, bodyHtml) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#f5f5f5; font-family:'Segoe UI',Tahoma,Arial,sans-serif; direction:rtl; }
  .wrap { max-width:600px; margin:30px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.10); }
  .header { background:linear-gradient(135deg,#c0392b 0%,#922b21 100%); padding:36px 40px 28px; text-align:center; }
  .logo-circle { width:80px; height:80px; margin:0 auto 16px; background:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,.15); overflow:hidden; }
  .logo-circle img { width:68px; height:68px; object-fit:contain; }
  .header h1 { color:#fff; font-size:20px; font-weight:800; letter-spacing:-.3px; margin-bottom:4px; }
  .header p { color:rgba(255,255,255,.80); font-size:13px; }
  .divider { height:4px; background:linear-gradient(90deg,#c0392b,#e74c3c,#c0392b); }
  .body { padding:36px 40px; color:#333; line-height:1.8; font-size:15px; }
  .footer { background:#fafafa; padding:20px 40px; text-align:center; color:#aaa; font-size:12px; border-top:1px solid #eee; }
  .footer a { color:#c0392b; text-decoration:none; }
  .btn { display:inline-block; background:linear-gradient(135deg,#c0392b,#922b21); color:#fff !important; padding:13px 32px; border-radius:10px; text-decoration:none; font-weight:700; margin:18px 0; font-size:15px; }
  .otp-box { font-size:40px; font-weight:900; letter-spacing:12px; color:#c0392b; text-align:center; padding:24px 20px; background:linear-gradient(135deg,#fdf2f2,#fdeaea); border:2px solid #f5b7b1; border-radius:12px; margin:24px 0; font-family:monospace; }
  table.details { width:100%; border-collapse:collapse; margin:16px 0; }
  table.details td { padding:10px 14px; border-bottom:1px solid #f0f0f0; }
  table.details td:first-child { color:#999; width:40%; font-size:13px; }
  table.details td:last-child { font-weight:600; color:#222; }
  .badge { display:inline-block; background:#fdf2f2; color:#c0392b; border:1px solid #f5b7b1; border-radius:20px; padding:3px 12px; font-size:12px; font-weight:700; }
</style></head>
<body><div class="wrap">
  <div class="header">
    <div class="logo-circle">
      <img src="https://mahadnafsy.com/logo.png" alt="معهد الدراسات النفسية" onerror="this.style.display='none';this.parentNode.innerHTML='<span style=&quot;font-size:28px&quot;>🌿</span>'" />
    </div>
    <h1>معهد الدراسات النفسية</h1>
    <p>mahadnafsy.com</p>
  </div>
  <div class="divider"></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">
    هذا البريد أُرسل تلقائياً — يُرجى عدم الرد عليه<br>
    © ${new Date().getFullYear()} <a href="https://mahadnafsy.com">معهد الدراسات النفسية</a> — جميع الحقوق محفوظة
  </div>
</div></body></html>`;
}

async function sendEmail(to, subject, bodyHtml) {
  await mailer.sendMail({
    from: `"معهد الدراسات النفسية" <${process.env.SMTP_USER || 'info@mahadnafsy.com'}>`,
    to, subject,
    html: htmlEmail(subject, bodyHtml),
  });
  // throws on failure — callers should catch and handle
}

module.exports = { mailer, htmlEmail, sendEmail };
