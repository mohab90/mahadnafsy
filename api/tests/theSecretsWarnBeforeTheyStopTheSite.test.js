'use strict';

// Audit finding (11 Oct 2026): the boot refuses signing secrets older than 370
// days, and both dates in the systemd unit are 2026-08-03 — so about
// 2027-08-08 the next restart would take the site down with no warning. The
// refusal stays; from day 330 the health output, the admin's system card and a
// weekly WhatsApp to the owner say so first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-rotation-secret-0123456789-abcdefghijklmnop';

const outboxed = [];
let ownerReports = {};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { outboxed.push(message); return 'id'; } });
stub('../lib/tenantSettings', { getTenantSetting: async () => ownerReports, setTenantSetting: async () => {} });

const {
  authSecretDeploymentPolicy, auditSecretDeploymentPolicy, secretRotationStatus,
} = require('../lib/productionConfig');
const { composeSecretRotationAlert, queueSecretRotationAlerts } = require('../lib/secretRotationAlert');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const unit = read('..', 'deploy', 'systemd', 'mahad-api.service');
const unitValue = name => unit.match(new RegExp(`^Environment=${name}=(.+)$`, 'm'))?.[1];

const ROTATED = { AUTH_SECRET_ROTATED_AT: '2026-08-03', AUDIT_SECRET_ROTATED_AT: '2026-08-03' };
const at = iso => Date.parse(`${iso}T00:00:00Z`);

test('quiet until day 330, due from day 330, expired only past day 370', () => {
  const day329 = secretRotationStatus(ROTATED, at('2027-06-28'));
  assert.equal(day329.state, 'ok');
  assert.equal(day329.warning, false);
  assert.equal(day329.secrets[0].ageDays, 329);

  const day330 = secretRotationStatus(ROTATED, at('2027-06-29'));
  assert.equal(day330.state, 'due');
  assert.equal(day330.warning, true);
  assert.equal(day330.secrets[0].daysLeft, 40);
  assert.equal(day330.secrets[0].refusesBootAfter, '2027-08-08', 'the date the audit named');

  const day370 = secretRotationStatus(ROTATED, at('2027-08-08'));
  assert.equal(day370.state, 'due', 'day 370 itself still boots');
  assert.equal(day370.secrets[0].daysLeft, 0);

  const day371 = secretRotationStatus(ROTATED, at('2027-08-09'));
  assert.equal(day371.state, 'expired');
  assert.equal(day371.warning, true);
});

test('the warning follows whichever family is older, and says nothing about an unset date', () => {
  const status = secretRotationStatus({ AUTH_SECRET_ROTATED_AT: '2027-05-01', AUDIT_SECRET_ROTATED_AT: '2026-08-03' }, at('2027-07-01'));
  assert.equal(status.state, 'due');
  assert.deepEqual(status.secrets.map(item => [item.key, item.state]), [['auth', 'ok'], ['audit', 'due']]);
  const dev = secretRotationStatus({}, at('2027-07-01'));
  assert.equal(dev.state, 'unset');
  assert.equal(dev.warning, false, 'a development machine has no rotation policy to warn about');
});

test('the status names the sealing key, never a secret', () => {
  const env = { ...ROTATED, JWT_SECRET: 'x'.repeat(60), AUDIT_HMAC_SECRET: 'y'.repeat(60) };
  const shared = secretRotationStatus(env, at('2027-07-01'));
  assert.equal(shared.sealedDataKey, 'jwt-fallback');
  assert.equal(secretRotationStatus({ ...env, CHANNEL_SECRET_KEY_FILE: '/run/creds/channel' }, at('2027-07-01')).sealedDataKey, 'own');
  const text = JSON.stringify(shared);
  assert.doesNotMatch(text, /xxxxxxxx|yyyyyyyy/);
});

test('the 370-day refusal is unchanged', () => {
  const auth = {
    AUTH_SECRET_SOURCE: 'platform-secret', AUTH_SECRET_PROVIDER: 'systemd-credentials',
    JWT_SECRET_REFERENCE: 'systemd-cred:mahad/jwt@2026-08-03',
    SESSION_BINDING_SECRET_REFERENCE: 'systemd-cred:mahad/session@2026-08-03',
    OTP_HMAC_SECRET_REFERENCE: 'systemd-cred:mahad/otp@2026-08-03',
    AUTH_SECRET_ROTATED_AT: '2026-08-03',
  };
  const audit = {
    AUDIT_SECRET_SOURCE: 'platform-secret', AUDIT_SECRET_PROVIDER: 'systemd-credentials',
    AUDIT_SECRET_REFERENCE: 'systemd-cred:mahad/audit@2026-08-03', AUDIT_SECRET_ROTATED_AT: '2026-08-03',
  };
  assert.equal(authSecretDeploymentPolicy(auth, at('2027-08-08')).ok, true);
  assert.equal(auditSecretDeploymentPolicy(audit, at('2027-08-08')).ok, true);
  assert.equal(authSecretDeploymentPolicy(auth, at('2027-08-09')).ok, false);
  assert.equal(auditSecretDeploymentPolicy(audit, at('2027-08-09')).ok, false);
});

test('the systemd unit carries the dates the warning reads, and the steps to rotate them', () => {
  const env = { AUTH_SECRET_ROTATED_AT: unitValue('AUTH_SECRET_ROTATED_AT'), AUDIT_SECRET_ROTATED_AT: unitValue('AUDIT_SECRET_ROTATED_AT') };
  const status = secretRotationStatus(env, at('2027-07-15'));
  assert.equal(status.state, 'due');
  for (const item of status.secrets) {
    assert.match(unit, new RegExp(`due by ${item.refusesBootAfter}`), 'the comment names the real deadline');
  }
  assert.match(unit, /openssl rand -hex 36/);
  assert.match(unit, /systemctl daemon-reload && systemctl restart mahad-api/);
  assert.match(unit, /CHANNEL_SECRET_KEY_FILE=%d\/channel/, 'the sealing key is set apart before JWT_SECRET changes');
  assert.match(unit, /api\/health\/detailed/);
});

test('a WhatsApp to every owner-report number, once a week, as a staff alert', async () => {
  ownerReports = { enabled: false, phones: ['01001234567', '01112223334'] };
  outboxed.length = 0;
  assert.equal(await queueSecretRotationAlerts({ tenantId: 't', env: ROTATED, now: at('2027-06-01') }, {}), 0, 'day 302: nothing');
  assert.equal(outboxed.length, 0);

  const queued = await queueSecretRotationAlerts({ tenantId: 't', env: ROTATED, now: Date.parse('2027-07-01T09:00:00Z') }, {});
  assert.equal(queued, 2, 'sent though the daily report itself is switched off');
  assert.deepEqual(outboxed.map(m => m.recipient), ['201001234567', '201112223334']);
  for (const message of outboxed) {
    assert.equal(message.channel, 'whatsapp');
    assert.equal(message.tenantId, 't');
    assert.equal(message.payload.category, 'staff_alert');
    assert.match(message.payload.message, /2027-08-08/);
  }
  // 1 Jul 2027 is a Thursday: the week is the Monday before it.
  assert.equal(outboxed[0].dedupeKey, 'secret-rotation:2027-06-28:201001234567');

  outboxed.length = 0;
  await queueSecretRotationAlerts({ tenantId: 't', env: ROTATED, now: Date.parse('2027-07-04T09:00:00Z') }, {});
  assert.equal(outboxed[0].dedupeKey, 'secret-rotation:2027-06-28:201001234567', 'the same week: the outbox drops it');
  outboxed.length = 0;
  await queueSecretRotationAlerts({ tenantId: 't', env: ROTATED, now: Date.parse('2027-07-05T09:00:00Z') }, {});
  assert.equal(outboxed[0].dedupeKey, 'secret-rotation:2027-07-05:201001234567', 'next week: again');

  ownerReports = { phones: [] };
  outboxed.length = 0;
  assert.equal(await queueSecretRotationAlerts({ tenantId: 't', env: ROTATED, now: at('2027-07-05'), logger: { warn() {} } }, {}), 0);
});

test('past day 370 the message says the next restart will not come back', () => {
  const text = composeSecretRotationAlert(secretRotationStatus(ROTATED, at('2027-08-20')));
  assert.match(text, /انتهت/);
  assert.match(text, /أي ريستارت للسيرفر دلوقتي الموقع مش هيقوم/);
});

test('health/detailed carries it for the server itself, and nothing for a visitor', async () => {
  require('../lib/rateLimitStore').redisHealth = async () => ({ enabled: false, ok: false });
  const { registerHealthRoutes } = require('../lib/httpApp');
  const routes = {};
  registerHealthRoutes({ get: (route, handler) => { routes[route] = handler; } }, { query: async () => [[{ 1: 1 }]], pool: {} });
  const ask = async (ip, forwarded) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes['/api/health/detailed']({ headers: forwarded ? { 'x-forwarded-for': ip } : {}, socket: { remoteAddress: ip } }, res);
    return res;
  };
  const local = await ask('127.0.0.1');
  assert.equal(local.statusCode, 200, 'a due rotation does not turn the status to degraded');
  assert.ok(local.body.secretRotation, 'present for the box itself');
  assert.equal(local.body.secretRotation.refuseAfterDays, 370);
  assert.equal(local.body.secretRotation.warnFromDays, 330);
  const visitor = await ask('197.0.0.9', true);
  assert.deepEqual(visitor.body, { status: 'ok' });
});

test('the scheduler asks, the admin card reads it, and the card is on the system screens', () => {
  const scheduler = read('lib', 'backgroundScheduler.js');
  assert.match(scheduler, /lockedJob\('secret_rotation_alert'/);
  assert.match(scheduler, /queueSecretRotationAlerts\(\{ logger \}\)/);
  const adminUtils = read('routes', 'admin-utils.js');
  assert.match(adminUtils, /router\.get\('\/api\/admin\/system\/secret-rotation', requireAuth, requireAdmin/);
  const card = read('..', 'admin', 'components', 'SecretRotationCard.tsx');
  assert.match(card, /adminGet<RotationStatus>\('\/admin\/system\/secret-rotation'\)/);
  assert.match(read('..', 'admin', 'pages', 'dashboard', 'tabs', 'KpiDashboardTab.tsx'), /<SecretRotationCard/);
  assert.match(read('..', 'admin', 'pages', 'dashboard', 'tabs', 'SystemSettingsTab.tsx'), /<SecretRotationCard/);
});
