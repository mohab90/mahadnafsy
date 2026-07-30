'use strict';

const rateLimit = require('express-rate-limit');
const { distributedRateLimitStore } = require('../lib/rateLimitStore');
const { pendingTokenIdentity } = require('../lib/pendingTokenIdentity');

const ipKeyGenerator = rateLimit.ipKeyGenerator || (ip => ip || 'unknown');
const safe = value => String(value || 'anonymous').toLowerCase().replace(/[^a-z0-9@._:/-]/g, '').slice(0, 160) || 'anonymous';
const normalizedAction = req => {
  const path = `${req.baseUrl || ''}${req.route?.path || req.path || ''}`
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[a-z0-9_-]{24,}(?=\/|$)/gi, '/:token');
  return safe(`${req.method}:${path}`);
};
const tenant = req => safe(req.tenantId || 'tenant-public');
const actor = req => safe(
  req.user?.uid || req.user?.email || req.body?.email
  || pendingTokenIdentity(req.body?.pendingToken) || 'anonymous'
);
const ip = req => safe(ipKeyGenerator(req.ip));
const keyBy = mode => req => {
  const parts = [tenant(req)];
  if (mode === 'user') parts.push(actor(req));
  parts.push(ip(req), normalizedAction(req));
  return parts.join(':');
};
const tooMany = message => (_req, res) => res.status(429).json({ error: message, code: 'RATE_LIMITED' });

function limiter(name, { windowMs, max, message, mode = 'ip', skip, skipSuccessfulRequests = false }) {
  const store = distributedRateLimitStore(name);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyBy(mode),
    validate: { ip: false },
    handler: tooMany(message),
    passOnStoreError: false,
    skipSuccessfulRequests,
    ...(skip ? { skip } : {}),
    ...(store ? { store } : {}),
  });
}

const minute = 60 * 1000;
const hour = 60 * minute;
const retryMinute = 'طلبات كثيرة جدًا، انتظر دقيقة وحاول مرة أخرى';
const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const publicRequestMax = req => /^(GET|HEAD)$/i.test(req.method)
  ? positiveInt(process.env.PUBLIC_READ_RATE_LIMIT_PER_MINUTE, 600)
  : positiveInt(process.env.PUBLIC_WRITE_RATE_LIMIT_PER_MINUTE, 60);

const adminLimiter = limiter('privileged', {
  windowMs: minute, max: 400, mode: 'user', message: retryMinute,
  skip: req => req.path === '/api/admin/server-status',
});
const loginLimiter = [
  limiter('login-ip', {
    windowMs: 15 * minute, max: 50,
    skipSuccessfulRequests: true,
    message: 'محاولات دخول كثيرة من الشبكة، انتظر 15 دقيقة',
  }),
  limiter('login-account', {
    windowMs: 15 * minute, max: 15, mode: 'user',
    skipSuccessfulRequests: true,
    message: 'محاولات كثيرة للحساب، انتظر 15 دقيقة وحاول مرة أخرى',
  }),
];
const otpLimiter = [
  limiter('otp-ip', {
    windowMs: 10 * minute, max: 30, message: 'محاولات OTP كثيرة من الشبكة، انتظر 10 دقائق',
  }),
  limiter('otp-account', {
    windowMs: 10 * minute, max: 10, mode: 'user', message: 'محاولات OTP كثيرة للحساب، انتظر 10 دقائق',
  }),
];
const forgotPasswordLimiter = [
  limiter('forgot-password-ip', {
    windowMs: hour, max: 20, message: 'محاولات استعادة كثيرة من الشبكة، انتظر ساعة',
  }),
  limiter('forgot-password-account', {
    windowMs: hour, max: 8, mode: 'user', message: 'محاولات استعادة كثيرة للحساب، انتظر ساعة',
  }),
];
const registerLimiter = limiter('register', {
  windowMs: hour, max: 10, message: 'عدد تسجيلات كثير، انتظر ساعة وحاول مرة أخرى',
});
const paymobLimiter = limiter('paymob', {
  windowMs: minute, max: 60, message: 'طلبات دفع كثيرة، حاول بعد دقيقة',
});
// Catalog hydration is read-heavy and many branch employees share one NAT IP.
// Keep mutations conservative while preventing successful office traffic from
// exhausting the same per-action bucket used by public GET endpoints.
const publicLimiter = limiter('public', { windowMs: minute, max: publicRequestMax, message: retryMinute });
const contactLimiter = limiter('contact', {
  windowMs: hour, max: 5, message: 'عدد كبير من الرسائل، انتظر ساعة وحاول مرة أخرى',
});
const whatsappSendLimiter = limiter('whatsapp-send', {
  windowMs: minute, max: 30, mode: 'user', message: 'الحد الأقصى 30 رسالة واتساب في الدقيقة',
});
const whatsappWebhookLimiter = limiter('whatsapp-webhook', {
  windowMs: minute, max: 240, message: retryMinute,
});
const connectorDiagnosticLimiter = limiter('connector-test', {
  windowMs: 10 * minute, max: 8, mode: 'user', message: 'تم تجاوز حد اختبارات الربط. حاول لاحقًا.',
});
const uploadLimiter = limiter('upload', {
  windowMs: hour, max: 10, mode: 'user', message: 'تم تجاوز الحد المسموح لرفع الملفات.',
});
const bulkOperationLimiter = limiter('bulk-export', {
  windowMs: 10 * minute, max: 20, mode: 'user', message: 'عدد كبير من العمليات الجماعية أو التصدير. حاول لاحقًا.',
});
const communityPostLimiter = limiter('community-post', {
  windowMs: hour, max: 10, mode: 'user', message: 'عدد كبير من المشاركات. حاول لاحقًا.',
});
const imageProxyLimiter = limiter('image-proxy', {
  windowMs: minute, max: 600, message: retryMinute,
});
const aiLimiter = limiter('student-ai', {
  windowMs: minute, max: 12, mode: 'user', message: retryMinute,
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
  whatsappWebhookLimiter,
  connectorDiagnosticLimiter,
  uploadLimiter,
  communityPostLimiter,
  bulkOperationLimiter,
  imageProxyLimiter,
  aiLimiter,
  keyBy,
  normalizedAction,
  publicRequestMax,
};
