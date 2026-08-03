'use strict';

require('dotenv').config();

const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { getEmailConfig, mailer, sendEmail } = require('../lib/email');
const { getWaCfg, providerCredentialState, resolveProvider, sendWhatsApp } = require('../lib/whatsapp');
const { getPaymentGatewaySettings, isPaymobActive } = require('../lib/saasSettings');
const jobQueue = require('../lib/jobQueue');
const passwordHash = require('../lib/passwordHash');
const errorMonitor = require('../lib/errorMonitor');
const { getFxSnapshot } = require('../lib/finance');
const { getMfaPolicy, policyRequiresStaff } = require('../lib/mfaPolicy');
const { closeRedis, isDistributedEnabled, redisHealth } = require('../lib/rateLimitStore');
const { resolveSecret } = require('../lib/secretResolver');
const {
  authSecretDeploymentPolicy,
  auditSecretPolicy,
  auditSecretDeploymentPolicy,
  dataResidencyPolicy,
  geoProxyPolicy,
  hasReal,
  httpsUrlIsValid,
  managedDatabasePolicy,
  productClaimPolicy,
  redisDeploymentPolicy,
  sentryDsnIsValid,
} = require('../lib/productionConfig');

const liveExternal = process.argv.includes('--live-external');

const checks = [];

function check(id, ok, message, detail, skipped = false) {
  const result = { id, ok: Boolean(ok), skipped, message, detail: detail || '' };
  const existing = checks.findIndex(item => item.id === id);
  if (existing >= 0) checks[existing] = result;
  else checks.push(result);
}

function skip(id, message, detail) {
  check(id, true, message, detail, true);
}

async function main() {
  const secretResults = Object.fromEntries(
    ['JWT_SECRET', 'SESSION_BINDING_SECRET', 'OTP_HMAC_SECRET', 'AUDIT_HMAC_SECRET'].map(name => {
      try { return [name, { value: resolveSecret(name), error: '' }]; }
      catch (error) { return [name, { value: '', error: error.message }]; }
    })
  );
  const jwtSecret = secretResults.JWT_SECRET.value;
  const sessionSecret = secretResults.SESSION_BINDING_SECRET.value;
  const otpSecret = secretResults.OTP_HMAC_SECRET.value;
  const auditSecret = secretResults.AUDIT_HMAC_SECRET.value;

  check(
    'schema-policy',
    !require('fs').readFileSync(require.resolve('../server'), 'utf8').includes('registerStartupTasks(')
      && process.env.RUN_MIGRATIONS_ON_STARTUP !== 'true',
    'The API process must never register legacy runtime DDL',
    'Numbered migrations are the exclusive schema authority and production migrations run as a release job.'
  );

  check(
    'jwt-secret',
    hasReal(jwtSecret) && jwtSecret.length >= 48,
    'JWT_SECRET must be a real secret with at least 48 characters',
    secretResults.JWT_SECRET.error
  );
  check(
    'session-binding-secret',
    hasReal(sessionSecret)
      && sessionSecret.length >= 48
      && sessionSecret !== jwtSecret,
    'SESSION_BINDING_SECRET must be independent and at least 48 characters',
    secretResults.SESSION_BINDING_SECRET.error
  );
  check(
    'otp-hmac-secret',
    hasReal(otpSecret)
      && otpSecret.length >= 48
      && ![jwtSecret, sessionSecret, auditSecret].includes(otpSecret),
    'OTP_HMAC_SECRET must be independent and at least 48 characters',
    secretResults.OTP_HMAC_SECRET.error
  );
  const geoPolicy = geoProxyPolicy();
  check(
    'customer-geo-proxy-policy',
    geoPolicy.ok,
    'Customer geo and proxy trust require current production evidence',
    geoPolicy.errors.join('; ')
  );
  if (liveExternal) {
    const publicBaseUrl = String(process.env.PRODUCTION_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const expectedCountry = String(process.env.GEO_LIVE_EXPECTED_COUNTRY_CODE || '').toUpperCase();
    if (!httpsUrlIsValid(publicBaseUrl) || !/^[A-Z]{2}$/.test(expectedCountry)) {
      check(
        'customer-geo-live',
        false,
        'PRODUCTION_PUBLIC_BASE_URL and GEO_LIVE_EXPECTED_COUNTRY_CODE are required for edge verification'
      );
    } else {
      try {
        const response = await fetch(`${publicBaseUrl}/api/public/client-context`);
        const body = await response.json();
        const expectedCurrency = expectedCountry === 'EG' ? 'EGP' : expectedCountry === 'SA' ? 'SAR' : 'USD';
        check(
          'customer-geo-live',
          response.ok && body.locationResolved === true
            && body.countryCode === expectedCountry && body.currency === expectedCurrency,
          'The production edge must resolve the real test location and currency without spoofed headers',
          JSON.stringify({ status: response.status, body })
        );
      } catch (error) {
        check('customer-geo-live', false, 'Production edge geo request failed', error.message);
      }
    }
  }
  const claimPolicy = productClaimPolicy();
  check(
    'product-claim-boundary',
    claimPolicy.ok,
    'Deployment capability tier must not claim full enterprise SaaS/ERP readiness',
    claimPolicy.errors.join('; ')
  );

  const auditPolicy = auditSecretPolicy();
  check('audit-secret', auditPolicy.ok, 'AUDIT_HMAC_SECRET must be independent and at least 48 characters', auditPolicy.errors.join('; '));
  check(
    'audit-secret-source',
    ['secret-manager', 'vault', 'platform-secret'].includes(String(process.env.AUDIT_SECRET_SOURCE || '').toLowerCase()),
    'AUDIT_SECRET_SOURCE must document managed secret injection'
  );
  const auditDeployment = auditSecretDeploymentPolicy();
  check(
    'audit-secret-management',
    auditDeployment.ok,
    'Audit HMAC must have current production Secret Manager evidence',
    auditDeployment.errors.join('; ')
  );
  const authSecretDeployment = authSecretDeploymentPolicy();
  check(
    'auth-secret-management',
    authSecretDeployment.ok,
    'JWT, session-binding and OTP secrets must have independent managed references',
    authSecretDeployment.errors.join('; ')
  );

  const residency = dataResidencyPolicy();
  check('data-residency', residency.ok, 'Data residency requires current provider evidence, region and verification date', residency.errors.join('; '));

  check(
    'admin-emails',
    String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean).length > 0,
    'ADMIN_EMAILS must contain at least one production admin email'
  );

  const managedDatabase = managedDatabasePolicy();
  check(
    'managed-database',
    managedDatabase.ok,
    'Production MySQL must be managed, region-pinned, CA-verified and protected by tested PITR',
    managedDatabase.errors.join('; ')
  );

  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    check('database', true, `Database reachable (${Date.now() - t0}ms)`);
    const [[sslStatus]] = await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const sslCipher = String(sslStatus?.Value || sslStatus?.value || '');
    check(
      'database-tls-live',
      sslCipher.length > 0,
      'The live MySQL session must negotiate TLS',
      sslCipher ? `cipher=${sslCipher}` : 'Ssl_cipher is empty'
    );
    const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'");
    const [[saasIssues]] = await pool.query(`
      SELECT
        SUM(active_subscription_count<>1) AS invalid_subscription_count,
        SUM(active_subscription_count=1 AND (
          plan_id IS NULL
          OR subscription_status='past_due'
          OR (subscription_status='trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at<NOW())
          OR (subscription_status='active' AND ends_at IS NOT NULL AND ends_at<NOW())
        )) AS expired_or_planless_count
      FROM (
        SELECT t.id,
               COUNT(ts.id) AS active_subscription_count,
               MAX(ts.plan_id) AS plan_id,
               MAX(ts.status) AS subscription_status,
               MAX(ts.trial_ends_at) AS trial_ends_at,
               MAX(ts.ends_at) AS ends_at
        FROM tenants t
        LEFT JOIN tenant_subscriptions ts
          ON ts.tenant_id=t.id AND ts.status IN ('active','trialing','past_due')
        WHERE t.status='active'
        GROUP BY t.id
      ) readiness`);
    check(
      'saas-entitlements',
      Number(saasIssues?.invalid_subscription_count || 0) === 0
        && Number(saasIssues?.expired_or_planless_count || 0) === 0,
      'Every active tenant must have exactly one current, plan-backed subscription',
      JSON.stringify(saasIssues || {})
    );
    const requiredMigrations = [
      '144_v25_support_workflow_integrity.sql',
      '145_v25_notification_recipient_reads.sql',
      '146_v25_saas_control_plane_integrity.sql',
      '147_v25_whatsapp_delivery_receipts.sql',
      '148_v25_community_engagement_integrity.sql',
      '149_v25_customer_auth_geo_integrity.sql',
      '150_v25_hr_records_integrity.sql',
      '151_v25_payroll_scope_integrity.sql',
      '152_v25_instructor_rate_approval.sql',
      '153_v25_payment_compensation_integrity.sql',
      '154_v25_finance_query_indexes.sql',
      '155_v25_lms_assessment_integrity.sql',
      '156_v25_certificate_request_integrity.sql',
      '157_v25_attendance_dokki_indexes.sql',
      '158_v25_daqqi_attendance_events.sql',
      '159_v25_otp_secret_storage.sql',
    ];
    const [migrationRows] = await pool.query(
      `SELECT version, status FROM schema_migrations
       WHERE version IN (${requiredMigrations.map(() => '?').join(',')})`,
      requiredMigrations);
    const applied = new Set(migrationRows.filter(row => ['applied', 'baseline'].includes(row.status)).map(row => row.version));
    check(
      'latest-integrity-migrations',
      requiredMigrations.every(version => applied.has(version)),
      'Latest support, notification, SaaS, customer-auth, HR, finance and LMS integrity migrations must be applied',
      JSON.stringify({ required: requiredMigrations, applied: [...applied] })
    );
    const [[localizedCatalog]] = await pool.query(`
      SELECT SUM(n) AS missing_localized_prices FROM (
        SELECT COUNT(*) AS n FROM courses
         WHERE is_published=1 AND deleted_at IS NULL
           AND (price_egp<=0 OR price_sar<=0 OR price_usd<=0)
        UNION ALL
        SELECT COUNT(*) AS n FROM bundles
         WHERE is_published=1 AND deleted_at IS NULL
           AND (price_egp<=0 OR price_sar<=0 OR price_usd<=0)
        UNION ALL
        SELECT COUNT(*) AS n FROM therapists
         WHERE is_active=1 AND is_consultation_enabled=1
           AND (price_egp<=0 OR price_sar<=0 OR price_usd<=0)
      ) catalog`);
    check(
      'localized-catalog-prices',
      Number(localizedCatalog?.missing_localized_prices || 0) === 0,
      'Every sellable course, bundle and consultation must have positive EGP, SAR and USD prices',
      JSON.stringify(localizedCatalog || {})
    );
    const mfaPolicies = await Promise.all(tenants.map(async ({ id }) => ({
      tenantId: id,
      policy: await getMfaPolicy(id, { fresh: true }),
    })));
    check(
      'mfa-policy',
      mfaPolicies.length > 0 && mfaPolicies.every(({ policy }) => policy.enabled),
      'MFA policy must be enabled for every active tenant',
      JSON.stringify(mfaPolicies.map(({ tenantId, policy }) => ({
        tenantId,
        enabled: policy.enabled,
        requiredRoles: policy.required_roles,
      })))
    );
    const [staffRows] = await pool.query(
      `SELECT s.id,s.tenant_id,s.email,s.role,s.permissions_json,
              COALESCE(u.totp_enabled,0) AS totp_enabled
         FROM staff s
         LEFT JOIN users u
           ON u.tenant_id=s.tenant_id AND LOWER(TRIM(u.email))=LOWER(TRIM(s.email))
          AND u.is_active=1
        WHERE s.is_active=1 AND s.deleted_at IS NULL`
    );
    const policyByTenant = new Map(mfaPolicies.map(({ tenantId, policy }) => [String(tenantId), policy]));
    const mfaRequired = staffRows.filter(staff => {
      const policy = policyByTenant.get(String(staff.tenant_id));
      if (!policy) return false;
      if (typeof staff.permissions_json === 'string' && staff.permissions_json.trim()) {
        try { staff.permissionsArr = JSON.parse(staff.permissions_json); } catch { staff.permissionsArr = []; }
      }
      return policyRequiresStaff({ ...policy, enabled: true }, staff, policy.required_permissions);
    });
    const missingMfa = mfaRequired.filter(staff => !staff.totp_enabled);
    check(
      'mfa-enrollment',
      mfaRequired.length > 0 && missingMfa.length === 0,
      'Every active staff account covered by the MFA policy must be enrolled',
      JSON.stringify({
        required: mfaRequired.length,
        missing: missingMfa.map(staff => ({
          tenantId: staff.tenant_id,
          staffId: staff.id,
          role: staff.role,
        })),
      })
    );
    const fxResults = await Promise.all(tenants.map(async ({ id }) => {
      const snapshot = await getFxSnapshot(id);
      const updatedAt = snapshot.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0;
      const ageHours = updatedAt ? (Date.now() - updatedAt) / 3600000 : Infinity;
      return {
        tenantId: id,
        source: snapshot.source,
        ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(1)) : null,
        ok: snapshot.source !== 'static-fallback' && ageHours <= 72,
      };
    }));
    check(
      'fx-rates',
      fxResults.length > 0 && fxResults.every(result => result.ok),
      'Every active tenant must have provider-sourced FX rates refreshed within 72 hours',
      JSON.stringify(fxResults)
    );
  } catch (e) {
    check('database', false, 'Database is not reachable or tenant configuration cannot be read', e.message);
    check('database-tls-live', false, 'Live MySQL TLS could not be verified', e.message);
    check('fx-rates', false, 'FX readiness could not be verified', e.message);
    check('saas-entitlements', false, 'SaaS entitlement readiness could not be verified', e.message);
    check('latest-integrity-migrations', false, 'Integrity migrations could not be verified', e.message);
    check('localized-catalog-prices', false, 'Localized catalog price coverage could not be verified', e.message);
    check('mfa-policy', false, 'MFA policy readiness could not be verified', e.message);
    check('mfa-enrollment', false, 'MFA enrollment coverage could not be verified', e.message);
  }

  try {
    const queue = await jobQueue.healthSnapshot();
    check(
      'durable-job-queue',
      queue.stale === 0 && queue.dead === 0,
      'MySQL durable queue must have no stale locks or dead jobs',
      JSON.stringify(queue)
    );
  } catch (e) {
    check('durable-job-queue', false, 'MySQL durable queue health could not be verified', e.message);
  }

  try {
    const email = await getEmailConfig();
    const emailReady = hasReal(email.smtpHost) && Number(email.smtpPort) > 0
      && hasReal(email.smtpUser) && hasReal(email.smtpPass) && hasReal(email.senderAddress || email.smtpUser);
    check('smtp-config', emailReady, 'SMTP production credentials must be configured', JSON.stringify({
      port: email.smtpPort,
      hasHost: hasReal(email.smtpHost),
      hasUser: hasReal(email.smtpUser),
      hasPassword: hasReal(email.smtpPass),
      hasSender: hasReal(email.senderAddress || email.smtpUser),
    }));
    if (emailReady && liveExternal) {
      try {
        await mailer.verify();
        check('smtp-live-verify', true, 'SMTP live verify succeeded');
        const recipient = process.env.RESET_EMAIL_TEST_RECIPIENT;
        if (!hasReal(recipient)) {
          check('reset-email-live-send', false, 'RESET_EMAIL_TEST_RECIPIENT is required for a live reset-email delivery test');
        } else {
          try {
            const delivery = await sendEmail(
              recipient,
              'Mahad password reset delivery readiness',
              `<p>Delivery acceptance test at ${new Date().toISOString()}</p>`
            );
            check(
              'reset-email-live-send',
              true,
              'Reset-email SMTP provider accepted the live test recipient',
              JSON.stringify({ messageId: delivery.messageId || null })
            );
          } catch (error) {
            check('reset-email-live-send', false, 'Reset-email live send failed', error.message);
          }
        }
      } catch (e) {
        check('smtp-live-verify', false, 'SMTP live verify failed', e.message);
      }
    }
  } catch (e) {
    check('smtp-config', false, 'SMTP config could not be read', e.message);
  }

  try {
    const cfg = await getWaCfg();
    const provider = resolveProvider(cfg);
    const { metaReady, greenReady } = providerCredentialState(cfg);
    // Sends now resolve through messaging_channels — the company number, a
    // rep's own number, or a Wapilot instance, each with its own sealed
    // credentials. Reading only the legacy tenant-level whatsapp_config would
    // fail a system that sends perfectly well, and pass one whose only
    // configured provider is a stale row nothing routes to any more.
    const [channelRows] = await pool.query(
      `SELECT provider, COUNT(*) AS n
         FROM messaging_channels
        WHERE kind = 'whatsapp' AND status = 'connected' AND is_active = 1
        GROUP BY provider`
    ).catch(() => [[]]);
    const connectedChannels = channelRows.reduce((sum, row) => sum + Number(row.n || 0), 0);
    const legacyReady = provider === 'meta' ? metaReady : greenReady;
    check(
      'whatsapp-config',
      legacyReady || connectedChannels > 0,
      'WhatsApp must have a connected channel or configured tenant credentials',
      JSON.stringify({
        provider,
        metaReady,
        greenReady,
        connectedChannels,
        byProvider: channelRows.map(row => `${row.provider}:${row.n}`),
      })
    );
    if (liveExternal && legacyReady) {
      const recipient = process.env.WHATSAPP_TEST_RECIPIENT;
      if (!hasReal(recipient)) {
        check('whatsapp-live-send', false, 'WHATSAPP_TEST_RECIPIENT is required for a live delivery test');
      } else {
        const trackingId = uuidv4();
        await pool.query(
          `INSERT INTO message_outbox
             (id,tenant_id,channel,recipient,payload_json,status,attempts,next_attempt_at,locked_at,locked_by)
           VALUES (?,?, 'whatsapp',?,?,'processing',0,NOW(),NOW(),'production-readiness')`,
          [
            trackingId,
            process.env.DEFAULT_TENANT_ID || 'tenant-default',
            recipient,
            JSON.stringify({ purpose: 'production-readiness' }),
          ]
        );
        const result = await sendWhatsApp(recipient, `Mahad production readiness ${new Date().toISOString()}`);
        if (result?.ok) {
          await pool.query(
            `UPDATE message_outbox
                SET status='sent',sent_at=NOW(),locked_at=NULL,locked_by=NULL,
                    provider=?,provider_message_id=?,delivery_status='accepted',provider_status_at=NOW()
              WHERE id=?`,
            [result.provider || provider, result.idMessage || null, trackingId]
          );
        } else {
          await pool.query(
            "UPDATE message_outbox SET status='failed',last_error=?,locked_at=NULL,locked_by=NULL WHERE id=?",
            [String(result?.reason || 'provider rejected message').slice(0, 2000), trackingId]
          );
        }
        check('whatsapp-live-send', result?.ok, 'WhatsApp live test message must be accepted', JSON.stringify({
          provider,
          accepted: Boolean(result?.ok),
          messageId: result?.idMessage || null,
          reason: result?.ok ? null : result?.reason,
        }));
        if (result?.ok && result?.idMessage) {
          const waitMs = Math.min(Math.max(Number(process.env.WHATSAPP_DELIVERY_WAIT_MS || 45000), 1000), 60000);
          const deadline = Date.now() + waitMs;
          let receipt = null;
          while (Date.now() < deadline) {
            [[receipt]] = await pool.query(
              `SELECT delivery_status,provider_status_at,delivered_at,read_at,provider_error
                 FROM message_outbox WHERE id=? LIMIT 1`,
              [trackingId]
            );
            if (['delivered', 'read', 'failed'].includes(receipt?.delivery_status)) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          check(
            'whatsapp-delivery-receipt',
            ['delivered', 'read'].includes(receipt?.delivery_status),
            'WhatsApp provider must return a delivered/read receipt',
            JSON.stringify(receipt || {})
          );
        }
      }
    }
  } catch (e) {
    check('whatsapp-config', false, 'WhatsApp config could not be read', e.message);
  }

  if (process.env.PAYMOB_REVIEW_PENDING === 'true') {
    skip('paymob-config', 'Paymob is deliberately suspended pending provider review');
  } else try {
    const payment = await getPaymentGatewaySettings();
    const paymob = payment.paymob || {};
    const paymobReady = isPaymobActive(payment)
      && hasReal(paymob.api_key || process.env.PAYMOB_API_KEY)
      && hasReal(paymob.hmac_secret || process.env.PAYMOB_HMAC_SECRET)
      && hasReal(paymob.integration_id_card || process.env.PAYMOB_INTEGRATION_ID)
      && hasReal(paymob.iframe_id || process.env.PAYMOB_IFRAME_ID);
    const paymobDetail = JSON.stringify({
      activeProvider: payment.active_provider,
      mode: payment.mode,
      enabled: !!paymob.enabled,
      hasApiKey: hasReal(paymob.api_key || process.env.PAYMOB_API_KEY),
      hasHmac: hasReal(paymob.hmac_secret || process.env.PAYMOB_HMAC_SECRET),
      hasIntegration: hasReal(paymob.integration_id_card || process.env.PAYMOB_INTEGRATION_ID),
      hasIframe: hasReal(paymob.iframe_id || process.env.PAYMOB_IFRAME_ID),
    });
    check('paymob-config', paymobReady, 'Paymob sandbox/live credentials must be configured and active', paymobDetail);
  } catch (e) {
    check('paymob-config', false, 'Paymob config could not be read', e.message);
  }

  let sentryDsn = '';
  let alertWebhookUrl = '';
  try { sentryDsn = resolveSecret('SENTRY_DSN'); } catch (_) {}
  try { alertWebhookUrl = resolveSecret('ALERT_WEBHOOK_URL'); } catch (_) {}
  check(
    'sentry-config',
    sentryDsnIsValid(sentryDsn),
    'SENTRY_DSN must be a valid HTTPS project DSN'
  );
  check(
    'alert-routing',
    httpsUrlIsValid(alertWebhookUrl),
    'ALERT_WEBHOOK_URL must route production alerts to an HTTPS incident channel'
  );
  check('observability-release', hasReal(process.env.APP_RELEASE), 'APP_RELEASE must identify the deployed build');
  if (liveExternal && sentryDsnIsValid(sentryDsn)) {
    try {
      const Sentry = require('@sentry/node');
      Sentry.init({ dsn: sentryDsn, environment: 'readiness', tracesSampleRate: 0 });
      Sentry.captureMessage('Mahad production readiness test');
      check('sentry-live-event', await Sentry.flush(5000), 'Sentry must accept and flush a test event');
    } catch (error) {
      check('sentry-live-event', false, 'Sentry live event failed', error.message);
    }
  }
  if (liveExternal && httpsUrlIsValid(alertWebhookUrl)) {
    check(
      'alert-routing-live',
      await errorMonitor.alert('Mahad production readiness test', { source: 'production-readiness' }),
      'Incident alert webhook must accept a test event'
    );
  }

  check(
    'password-hash-engine',
    passwordHash.engine === 'bcrypt-native',
    'Native bcrypt must handle password work without blocking the event loop',
    `engine=${passwordHash.engine}; cost=${passwordHash.COST}`
  );
  const threadPoolSize = Number(process.env.UV_THREADPOOL_SIZE || 4);
  check(
    'password-thread-pool',
    Number.isInteger(threadPoolSize) && threadPoolSize >= 8 && threadPoolSize <= 32,
    'UV_THREADPOOL_SIZE must provide bounded bcrypt concurrency',
    `UV_THREADPOOL_SIZE=${threadPoolSize}`
  );

  const redisPolicy = redisDeploymentPolicy();
  check('distributed-rate-limit', isDistributedEnabled(), 'Distributed tenant rate limiting must use Redis in staging/production');
  check(
    'managed-redis',
    redisPolicy.ok,
    'Redis must be managed, region-pinned and TLS-protected',
    redisPolicy.errors.join('; ')
  );
  if (liveExternal && isDistributedEnabled()) {
    const redis = await redisHealth({ writeProbe: true });
    check('redis-live-ping', redis.ok, 'Redis PING must succeed for distributed rate limiting', JSON.stringify(redis));
  }

  const failed = checks.filter(c => !c.ok && !c.skipped);
  for (const c of checks) {
    const mark = c.skipped ? 'SKIP' : c.ok ? 'PASS' : 'FAIL';
    console.log(`${mark} ${c.id}: ${c.message}${c.detail ? ` | ${c.detail}` : ''}`);
  }
  const skipped = checks.filter(c => c.skipped).length;
  console.log(`SUMMARY total=${checks.length} pass=${checks.length - failed.length - skipped} skip=${skipped} fail=${failed.length}`);
  await closeRedis().catch(() => {});
  await pool.end().catch(() => {});
  if (failed.length) process.exit(1);
}

main().catch(async (e) => {
  console.error('FAIL readiness-script:', e.stack || e.message);
  await closeRedis().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
