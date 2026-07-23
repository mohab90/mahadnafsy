'use strict';

const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../lib/token');

const ipKeyGenerator = rateLimit.ipKeyGenerator || ((ip) => ip || 'unknown');

const tooMany = (message) => (_req, res) => res.status(429).json({ error: message });

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/admin/server-status',
  handler: tooMany('طلبات كثيرة جداً، انتظر دقيقة وحاول مرة أخرى'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    return `${req.tenantId || 'tenant-default'}:${email || 'anonymous'}:${ipKeyGenerator(req.ip)}`;
  },
  validate: { ip: false },
  handler: tooMany('محاولات كثيرة، انتظر 15 دقيقة وحاول مرة أخرى'),
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  validate: { ip: false },
  handler: tooMany('محاولات OTP كثيرة، انتظر 10 دقائق'),
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany('محاولات كثيرة، انتظر ساعة وحاول مرة أخرى'),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany('عدد تسجيلات كثير، انتظر ساعة وحاول مرة أخرى'),
  skip: (req) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) return false;
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      return payload && (payload.role === 'admin' || payload.role === 'superadmin');
    } catch {
      return false;
    }
  },
});

const paymobLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany('طلبات دفع كثيرة، حاول بعد دقيقة'),
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany('طلبات كثيرة، انتظر دقيقة وحاول مرة أخرى'),
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany('عدد كبير من الرسائل، انتظر ساعة وحاول مرة أخرى'),
});

const whatsappSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip),
  validate: { ip: false },
  handler: tooMany('رسائل واتساب كثيرة، الحد الأقصى 30 رسالة في الدقيقة'),
});

// Connector tests can trigger paid/external provider calls. Keep this much
// tighter than the general admin limiter and bind it to tenant + authenticated user.
const connectorDiagnosticLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.tenantId || 'tenant-default'}:${req.user?.uid || req.user?.email || ipKeyGenerator(req.ip)}`,
  validate: { ip: false },
  handler: tooMany('تم تجاوز حد اختبارات الربط. انتظر 10 دقائق وحاول مرة أخرى.'),
});

// Bulk actions (mass assign/create/send) and data exports are far more expensive per
// request than an ordinary admin GET/POST, but previously shared the same generic
// 400/min-per-IP adminLimiter as everything else under /api/admin (NOT-04) — a single
// admin session could fire dozens of exports or bulk sends well within that ceiling.
const bulkOperationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.tenantId || 'tenant-default'}:${req.user?.uid || req.user?.email || ipKeyGenerator(req.ip)}`,
  validate: { ip: false },
  handler: tooMany('عدد كبير من العمليات الجماعية/التصدير، انتظر قليلاً وحاول مرة أخرى'),
});

const communityPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.tenantId || 'tenant-default'}:${req.user?.uid || req.user?.email || ipKeyGenerator(req.ip)}`,
  validate: { ip: false },
  handler: tooMany('عدد كبير من المشاركات، انتظر قليلاً وحاول مرة أخرى'),
});

module.exports = {
  adminLimiter,
  loginLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  paymobLimiter,
  publicLimiter,
  contactLimiter,
  whatsappSendLimiter,
  connectorDiagnosticLimiter,
  communityPostLimiter,
  bulkOperationLimiter,
};
