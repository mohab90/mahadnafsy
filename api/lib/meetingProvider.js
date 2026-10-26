'use strict';

// «محتاجين السيستم يربط API بزوم أو جوجل ميت … يبقى أساسي ميبقاش كل محاضر يختار هو … السيستم كله مربوط بنظام، هو بس بيعمل اتصال أو تشغيل»
// (26 Oct 2026): one video-meeting account for the whole institute. The owner picks the provider once and pastes its keys; a lecturer
// never types a link or picks a platform — the system makes the meeting for every live and every consultation, and the lecturer only
// presses «ابدأ» (the host link) while the client gets the join link.
//
//   zoom         Zoom Server-to-Server OAuth app (account id + client id + client secret), meetings made under the account's own user.
//   google_meet  Google Calendar event with a Meet room, made by the service account (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY,
//                the same one the Drive upload uses) acting for a Workspace user (domain-wide delegation, scope calendar.events).
//
// The setting `meeting_integration` lives in tenant_settings; the secrets in it are sealed (lib/secretBox.js) and never leave the server.

const crypto = require('node:crypto');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { seal, open } = require('./secretBox');

const SETTING = 'meeting_integration';
const PROVIDERS = Object.freeze(['zoom', 'google_meet']);
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const clean = (value, max = 255) => String(value ?? '').trim().slice(0, max);
const httpsUrl = value => (/^https:\/\/[^\s]+$/i.test(String(value || '')) ? String(value) : '');

async function readSettings(tenantId, { db } = {}) {
  const raw = await getTenantSetting(SETTING, { tenantId, fallback: {}, ...(db ? { db } : {}) });
  return raw && typeof raw === 'object' ? raw : {};
}

function readGoogleServiceAccount(env = process.env) {
  const email = clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const key = String(env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  return { email, key, ready: Boolean(email && key.includes('PRIVATE KEY')) };
}

/** What the screens may know: which provider, whether it can make a meeting, never a secret. */
async function integrationStatus(tenantId, { env = process.env } = {}) {
  const settings = await readSettings(tenantId);
  const provider = PROVIDERS.includes(settings.provider) ? settings.provider : null;
  const zoomReady = Boolean(settings.zoom?.accountId && settings.zoom?.clientId && settings.zoom?.clientSecretSealed);
  const google = readGoogleServiceAccount(env);
  const googleReady = Boolean(google.ready && settings.google?.delegatedUser);
  return {
    provider,
    configured: provider === 'zoom' ? zoomReady : provider === 'google_meet' ? googleReady : false,
    zoom: { accountId: settings.zoom?.accountId || '', clientId: settings.zoom?.clientId || '', hasSecret: Boolean(settings.zoom?.clientSecretSealed), hostUser: settings.zoom?.hostUser || '' },
    google: { delegatedUser: settings.google?.delegatedUser || '', serviceAccountReady: google.ready, serviceAccountEmail: google.email },
    updatedAt: settings.updatedAt || null,
  };
}

/** Save the owner's choice. A blank secret keeps the one on file. */
async function saveIntegration(tenantId, input, { actorId = null } = {}) {
  const current = await readSettings(tenantId);
  const provider = PROVIDERS.includes(input?.provider) ? input.provider : null;
  const zoomIn = input?.zoom || {};
  const secret = clean(zoomIn.clientSecret, 200);
  const next = {
    provider,
    zoom: {
      accountId: clean(zoomIn.accountId ?? current.zoom?.accountId, 80),
      clientId: clean(zoomIn.clientId ?? current.zoom?.clientId, 120),
      hostUser: clean(zoomIn.hostUser ?? current.zoom?.hostUser, 160),
      clientSecretSealed: secret ? seal(secret) : (current.zoom?.clientSecretSealed || ''),
    },
    google: { delegatedUser: clean(input?.google?.delegatedUser ?? current.google?.delegatedUser, 160).toLowerCase() },
    updatedAt: new Date().toISOString(),
  };
  await setTenantSetting(SETTING, next, { tenantId, actorId });
  return integrationStatus(tenantId);
}

// ── Zoom ─────────────────────────────────────────────────────────────────────

const tokenCache = new Map();

async function zoomToken(settings, { fetchImpl, now }) {
  const cacheKey = `${settings.zoom.accountId}:${settings.zoom.clientId}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt - 60_000 > now()) return hit.token;
  const secret = open(settings.zoom.clientSecretSealed);
  const response = await fetchImpl(`${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(settings.zoom.accountId)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${settings.zoom.clientId}:${secret}`).toString('base64')}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Zoom refused the keys (${response.status}${body.reason ? ` ${body.reason}` : ''})`);
  tokenCache.set(cacheKey, { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3000) * 1000 });
  return body.access_token;
}

async function zoomRequest(settings, method, path, body, ctx) {
  const token = await zoomToken(settings, ctx);
  const response = await ctx.fetchImpl(`${ZOOM_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return {};
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Zoom ${method} ${path} failed (${response.status}${payload.message ? ` ${payload.message}` : ''})`);
  return payload;
}

async function zoomCreate(settings, meeting, ctx) {
  const user = encodeURIComponent(settings.zoom.hostUser || 'me');
  const created = await zoomRequest(settings, 'POST', `/users/${user}/meetings`, {
    topic: meeting.topic, type: 2, start_time: meeting.startLocal, timezone: meeting.timeZone, duration: meeting.durationMinutes,
    settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true, approval_type: 2, auto_recording: 'none' },
  }, ctx);
  return { provider: 'zoom', meetingId: String(created.id), joinUrl: httpsUrl(created.join_url), hostUrl: httpsUrl(created.start_url), passcode: created.password || null };
}

// ── Google Meet (a Calendar event with a Meet room) ──────────────────────────

const b64url = value => Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function googleAssertion(account, subject, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: account.email, sub: subject, scope: CALENDAR_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.key);
  return `${header}.${claims}.${b64url(signature)}`;
}

async function googleToken(settings, { fetchImpl, now, env }) {
  const account = readGoogleServiceAccount(env);
  if (!account.ready) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY are not set');
  const cacheKey = `${account.email}:${settings.google.delegatedUser}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt - 60_000 > now()) return hit.token;
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: googleAssertion(account, settings.google.delegatedUser, Math.floor(now() / 1000)) }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Google refused the service account (${response.status}${body.error ? ` ${body.error}` : ''})`);
  tokenCache.set(cacheKey, { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3000) * 1000 });
  return body.access_token;
}

/** Add `minutes` to a local wall-clock string «YYYY-MM-DDTHH:mm:ss» without touching any time zone. */
function addMinutesLocal(local, minutes) {
  const [date, time] = String(local).split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const end = new Date(Date.UTC(y, mo - 1, d, h, mi + minutes, s || 0));
  return end.toISOString().slice(0, 19);
}

async function googleCreate(settings, meeting, ctx) {
  const token = await googleToken(settings, ctx);
  const response = await ctx.fetchImpl(`${CALENDAR_API}?conferenceDataVersion=1&sendUpdates=none`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: meeting.topic,
      start: { dateTime: meeting.startLocal, timeZone: meeting.timeZone },
      end: { dateTime: addMinutesLocal(meeting.startLocal, meeting.durationMinutes), timeZone: meeting.timeZone },
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Calendar failed (${response.status}${payload.error?.message ? ` ${payload.error.message}` : ''})`);
  const link = httpsUrl(payload.hangoutLink);
  if (!link) throw new Error('Google made the event but no Meet room (is Meet on for the delegated user?)');
  // The organiser opens the same room link; the host is whoever is signed in as the delegated user.
  return { provider: 'google_meet', meetingId: String(payload.id), joinUrl: link, hostUrl: link, passcode: null };
}

// ── The two calls the rest of the system makes ───────────────────────────────

/**
 * Make a meeting for a live or a consultation. `startLocal` is a wall clock «YYYY-MM-DDTHH:mm:ss» in `timeZone`
 * (Cairo for a consultation, UTC for a live, which the screens keep in UTC).
 * @returns {Promise<{provider:string, meetingId:string, joinUrl:string, hostUrl:string, passcode:string|null} | null>}
 *          null when no integration is set up — the caller keeps the link it was given.
 */
async function createMeeting(tenantId, { topic, startLocal, timeZone = 'Africa/Cairo', durationMinutes = 60 }, deps = {}) {
  const settings = await readSettings(tenantId);
  const status = await integrationStatus(tenantId, { env: deps.env || process.env });
  if (!status.configured) return null;
  const ctx = { fetchImpl: deps.fetchImpl || global.fetch, now: deps.now || Date.now, env: deps.env || process.env };
  const meeting = {
    topic: clean(topic, 200) || 'معهد الدراسات النفسية',
    startLocal: String(startLocal).replace(' ', 'T').slice(0, 19),
    timeZone,
    durationMinutes: Math.min(480, Math.max(10, Math.round(Number(durationMinutes)) || 60)),
  };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(meeting.startLocal)) throw new Error('startLocal must be YYYY-MM-DDTHH:mm:ss');
  return status.provider === 'zoom' ? zoomCreate(settings, meeting, ctx) : googleCreate(settings, meeting, ctx);
}

/** Take a meeting down when its live or session is cancelled. Best effort: a meeting nobody joins costs nothing. */
async function deleteMeeting(tenantId, { provider, meetingId }, deps = {}) {
  if (!provider || !meetingId) return false;
  const settings = await readSettings(tenantId);
  const status = await integrationStatus(tenantId, { env: deps.env || process.env });
  if (!status.configured || status.provider !== provider) return false;
  const ctx = { fetchImpl: deps.fetchImpl || global.fetch, now: deps.now || Date.now, env: deps.env || process.env };
  if (provider === 'zoom') {
    await zoomRequest(settings, 'DELETE', `/meetings/${encodeURIComponent(meetingId)}`, null, ctx);
    return true;
  }
  const token = await googleToken(settings, ctx);
  const response = await ctx.fetchImpl(`${CALENDAR_API}/${encodeURIComponent(meetingId)}?sendUpdates=none`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return response.ok || response.status === 410;
}

module.exports = { SETTING, PROVIDERS, integrationStatus, saveIntegration, createMeeting, deleteMeeting, addMinutesLocal, _tokenCache: tokenCache };
