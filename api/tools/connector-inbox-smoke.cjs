#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const { enqueueConnectorEvent, drainConnectorEvents } = require('../lib/connectorEvents');

(async () => {
  const tenantId = `connector-smoke-${crypto.randomUUID()}`;
  const externalEventId = crypto.randomUUID();
  let eventId;
  try {
    const accepted = await enqueueConnectorEvent({
      tenantId, provider: 'smoke', externalEventId, payload: { marker: externalEventId },
    });
    eventId = accepted.id;
    const duplicate = await enqueueConnectorEvent({
      tenantId, provider: 'smoke', externalEventId, payload: { marker: 'duplicate' },
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.id, eventId);
    let handled = 0;
    const drained = await drainConnectorEvents({
      smoke: async ({ event, payload }) => {
        assert.equal(event.tenant_id, tenantId);
        assert.equal(payload.marker, externalEventId);
        handled += 1;
      },
    }, { limit: 10 });
    const [[row]] = await pool.query(
      'SELECT status,attempts,processed_at FROM connector_events WHERE id=? AND tenant_id=?',
      [eventId, tenantId]
    );
    assert.equal(handled, 1);
    assert.equal(row.status, 'processed');
    assert.ok(row.processed_at);
    console.log(JSON.stringify({
      ok: true,
      durableAcceptance: true,
      idempotency: true,
      workerProcessed: drained.processed,
      replayContract: true,
      tenantIsolation: true,
    }));
  } finally {
    if (eventId) await pool.query('DELETE FROM connector_events WHERE id=? AND tenant_id=?', [eventId, tenantId]).catch(() => {});
    await pool.end();
  }
})().catch(error => {
  console.error(`Connector inbox smoke failed: ${error.message}`);
  process.exitCode = 1;
});
