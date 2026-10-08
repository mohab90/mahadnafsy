'use strict';

const logger = require('./logger').child({ module: 'realtime' });

async function publishRealtimeEvent(event, payload = {}, options = {}) {
  const baseUrl = process.env.WS_SERVER_URL;
  const secret = process.env.WS_INTERNAL_SECRET;
  if (!baseUrl || !secret) {
    return { ok: false, skipped: true, reason: 'WS_SERVER_URL or WS_INTERNAL_SECRET not configured' };
  }
  // An event without a room went to every connected account of every tenant
  // (HIGH-08); the ws-server refuses one now, and it is not sent.
  if (!options.room) {
    logger.warn('realtime emit without a room — not sent', { event });
    return { ok: false, skipped: true, reason: 'room is required' };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/emit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({
        event,
        payload,
        room: options.room || null,
      }),
      signal: AbortSignal.timeout(Number(process.env.WS_EMIT_TIMEOUT_MS || 2500)),
    });

    if (!response.ok) {
      logger.warn('realtime emit failed', { event, status: response.status });
      return { ok: false, status: response.status };
    }

    return { ok: true };
  } catch (err) {
    logger.warn('realtime emit error', { event, error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  publishRealtimeEvent,
};
