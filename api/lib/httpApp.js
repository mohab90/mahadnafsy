'use strict';

const path = require('path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./logger');
const errorMonitor = require('./errorMonitor');
const { uuidv4 } = require('./id');
const { publishRealtimeEvent } = require('./realtime');
const { registerRoutes } = require('./registerRoutes');
const { createAdminAuditMiddleware } = require('../middleware/adminAudit');
const { sanitizeBody, securityHeaders } = require('../middleware/sanitize');
const { resolveTenant } = require('../middleware/tenantContext');
const { legacyTenantContainment } = require('../middleware/legacyTenantContainment');
const { enforceAdminIpWhitelist } = require('../middleware/ipWhitelist');
const { adminLimiter } = require('../middleware/rateLimits');
const { adminFeatureGate, isPublicAdminPath } = require('./adminFeatureGate');
const { requireAuth } = require('../middleware/auth');
const { cleanupMemoryPresence } = require('./onlineUsers');

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function originPolicy() {
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim());
  const allowed = process.env.NODE_ENV === 'production'
    ? configured.filter((origin) => origin && !origin.includes('localhost') && !origin.includes('127.0.0.1'))
    : configured;
  const local = (origin) => process.env.NODE_ENV !== 'production'
    && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
  return (origin) => !origin || allowed.includes(origin) || local(origin);
}

/**
 * A browser request that changes something, carries the session cookie, and
 * names an Origin the institute does not own is refused.
 *
 * The session cookie is SameSite=None (the admin and the API live on different
 * hosts), so a page on any other site can make the browser attach it. CORS stops
 * that page READING the answer; it does not stop the request being made, and a
 * write does not need its answer read. Browsers always send Origin on a
 * cross-site write, so checking it closes that without a token. Same-origin
 * requests (Origin host = the host asked), the allow-list in ALLOWED_ORIGINS and
 * requests with no cookie — webhooks, provider callbacks, scripts using a bearer
 * header — are untouched.
 */
function csrfOriginGuard() {
  const isAllowed = originPolicy();
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin || !/(?:^|;\s*)authToken=/.test(req.headers.cookie || '')) return next();
    if (isAllowed(origin)) return next();
    try {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
      if (host && new URL(origin).host.toLowerCase() === host) return next();
    } catch (_) { /* a malformed Origin is refused below */ }
    return res.status(403).json({ error: 'Origin not allowed', code: 'ORIGIN_NOT_ALLOWED' });
  };
}

function corsConfig() {
  const isAllowed = originPolicy();
  return {
    origin: (origin, callback) => callback(null, isAllowed(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Tenant-Id', 'Idempotency-Key'],
    credentials: true,
  };
}

// The internals (memory, CPU, pool, queue depths, Redis) are for the people who run
// the server. A caller on the box itself, or one holding HEALTH_TOKEN, gets them;
// anybody else gets only whether the service is up — which is all an uptime
// monitor needs, and nothing a stranger can use to time an attack.
function privilegedHealthCaller(req) {
  const token = String(process.env.HEALTH_TOKEN || '');
  const given = String(req.headers['x-health-token'] || '');
  if (token && given.length === token.length
    && require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(token))) return true;
  const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const forwarded = Boolean(req.headers['x-forwarded-for']);
  return !forwarded && (ip === '127.0.0.1' || ip === '::1');
}

function registerHealthRoutes(app, pool) {
  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'ok', service: 'mahad-api', time: new Date().toISOString() });
  });
  app.get('/api/health/detailed', async (req, res) => {
    const started = Date.now();
    let db = { ok: false, ms: null, error: null };
    try {
      await pool.query('SELECT 1');
      db = { ok: true, ms: Date.now() - started, error: null };
    } catch (error) {
      db = { ok: false, ms: Date.now() - started, error: error.code || error.message };
    }
    const redis = await require('./rateLimitStore').redisHealth();
    const dependenciesOk = db.ok && (!redis.enabled || redis.ok);
    if (!privilegedHealthCaller(req)) {
      return res.status(dependenciesOk ? 200 : 503).json({ status: dependenciesOk ? 'ok' : 'degraded' });
    }
    const memory = process.memoryUsage();
    const rawPool = pool.pool || {};
    const totalConnections = rawPool._allConnections?.length || 0;
    const freeConnections = rawPool._freeConnections?.length || 0;
    const cpu = process.cpuUsage();
    const uptimeSec = Math.max(process.uptime(), 0.001);
    res.status(dependenciesOk ? 200 : 503).json({
      status: dependenciesOk ? 'ok' : 'degraded',
      service: 'mahad-api',
      db,
      redis,
      uptimeSec: Math.round(uptimeSec),
      rssMB: Math.round(memory.rss / 1048576),
      cpuAveragePercent: Number((((cpu.user + cpu.system) / 1e6) / uptimeSec * 100).toFixed(2)),
      eventLoop: {
        p95Ms: Number((eventLoopDelay.percentile(95) / 1e6).toFixed(2)),
        maxMs: Number((eventLoopDelay.max / 1e6).toFixed(2)),
      },
      dbPool: {
        active: Math.max(totalConnections - freeConnections, 0),
        free: freeConnections,
        total: totalConnections,
        queued: rawPool._connectionQueue?.length || 0,
        limit: rawPool.config?.connectionLimit || null,
      },
      errorMonitor: errorMonitor.isActive() ? 'active' : 'logs-only',
      time: new Date().toISOString(),
    });
  });
  app.get('/api/health/queues', async (req, res) => {
    try {
      const jobs = await require('./jobQueue').healthSnapshot();
      const ok = jobs.stale === 0 && jobs.dead === 0;
      if (!privilegedHealthCaller(req)) return res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded' });
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        backend: 'mysql',
        jobs,
        time: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        status: 'unavailable',
        backend: 'mysql',
        error: error.code || error.message,
        time: new Date().toISOString(),
      });
    }
  });
}

function createHttpApp({ pool, brandAssetRoot }) {
  const app = express();
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS);
  app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 1);
  app.use(compression());

  const corsOptions = corsConfig();
  app.options('*', cors(corsOptions));
  app.use(cors(corsOptions));
  app.use(csrfOriginGuard());
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'none'"], objectSrc: ["'none'"],
        frameSrc: ["'none'"], baseUri: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '10mb', verify: (req, _res, buffer) => { req.rawBody = buffer; } }));
  app.use(sanitizeBody);
  app.use(securityHeaders);
  app.use((req, res, next) => {
    req.reqId = uuidv4();
    res.setHeader('X-Request-ID', req.reqId);
    next();
  });
  app.use(resolveTenant);
  app.use(legacyTenantContainment);
  app.use((req, res, next) => {
    if (req.path === '/api/health/live' || req.path === '/api/health') return next();
    const started = Date.now();
    res.on('finish', () => {
      const meta = { reqId: req.reqId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started };
      if (res.statusCode >= 500) {
        logger.error('http', meta);
        try { errorMonitor.recordError(meta); } catch { /* optional monitor */ }
      } else if (res.statusCode >= 400) logger.warn('http', meta);
      else logger.info('http', meta);
    });
    next();
  });
  registerHealthRoutes(app, pool);
  app.use((req, res, next) => {
    res.setTimeout(45000, () => {
      if (!res.headersSent) res.status(408).json({ error: 'Request timeout' });
    });
    next();
  });

  for (const { key, purpose } of [
    { key: 'DB_HOST', purpose: 'MySQL DB connection' },
    { key: 'DB_USER', purpose: 'MySQL DB connection' },
    { key: 'DB_PASSWORD', purpose: 'MySQL DB connection' },
    { key: 'DB_NAME', purpose: 'MySQL DB connection' },
  ]) {
    if (!process.env[key]) logger.error(`[CONFIG] ⚠️  ${key} is not set in .env (${purpose}) — server may fail to start correctly.`);
  }

  app.use('/api/admin', createAdminAuditMiddleware({ pool, uuidv4, publishRealtimeEvent }));
  app.use('/api/admin', adminLimiter);
  app.use('/api/staff', adminLimiter);
  app.use('/api/admin', (req, res, next) => {
    const pathname = req.originalUrl?.split('?')[0] || req.path || '';
    return isPublicAdminPath(pathname) ? next() : requireAuth(req, res, next);
  });
  app.use('/api/admin', adminFeatureGate);
  setInterval(() => cleanupMemoryPresence(), 60 * 1000);
  app.use(enforceAdminIpWhitelist);
  app.use('/uploads/branding', express.static(brandAssetRoot, {
    dotfiles: 'deny', etag: true, immutable: true, maxAge: '365d', fallthrough: true,
  }));

  registerRoutes(app);
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  if (process.env.STATIC_DIR) {
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.sendFile(path.resolve(process.env.STATIC_DIR, 'index.html'));
    });
  } else {
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  }
  app.use((error, req, res, _next) => {
    logger.error('unhandled route error', {
      reqId: req.reqId, method: req.method, path: req.path, msg: error.message, stack: error.stack,
    });
    errorMonitor.captureException(error, { reqId: req.reqId, method: req.method, path: req.path });
    if (res.headersSent) return;
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

module.exports = { createHttpApp, corsConfig, csrfOriginGuard, registerHealthRoutes };
