'use strict';

// The message outbox claimed up to a hundred rows and sent them one by one. A
// row left in 'processing' for 15 minutes is taken back by the next drain, so a
// batch slow enough — a provider timing out at 20 seconds a message — had its
// tail sent twice. Now a few rows are claimed at a time, each claim is checked
// still ours just before its message goes, and a drain past its time hands the
// rest back (lib/outbox.js). Driven against an in-memory stand-in for the table.

const test = require('node:test');
const assert = require('node:assert/strict');

const rows = new Map();
const claimSizes = [];
const notices = [];

function handle(sql, params = []) {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM message_outbox/.test(flat)) {
    assert.match(flat, /LIMIT \? FOR UPDATE$/);
    claimSizes.push(params[0]);
    const due = [...rows.values()].filter(row => row.status === 'pending' || row.status === 'failed');
    return [due.slice(0, params[0]).map(row => ({ ...row }))];
  }
  if (/SET status='processing',locked_at=NOW\(\),locked_by=\?/.test(flat)) {
    const [worker, ...ids] = params;
    for (const id of ids) Object.assign(rows.get(id), { status: 'processing', locked_by: worker });
    return [{ affectedRows: ids.length }];
  }
  if (/^UPDATE message_outbox SET locked_at=NOW\(\) WHERE id=\? AND tenant_id=\? AND locked_by=\? AND status='processing'$/.test(flat)) {
    const [id, , worker] = params;
    const row = rows.get(id);
    return [{ affectedRows: row && row.locked_by === worker && row.status === 'processing' ? 1 : 0 }];
  }
  if (/SET status='sent'/.test(flat)) {
    const row = rows.get(params[4]);
    if (row.locked_by === params[6]) Object.assign(row, { status: 'sent', locked_by: null });
    return [{ affectedRows: 1 }];
  }
  if (/SET status=\?,attempts=\?,last_error=\?/.test(flat)) {
    const [status, attempts, lastError, , id, , worker] = params;
    const row = rows.get(id);
    if (row.locked_by === worker) Object.assign(row, { status, attempts, last_error: lastError, locked_by: null });
    return [{ affectedRows: 1 }];
  }
  if (/SET status=IF\(attempts>0,'failed','pending'\)/.test(flat)) {
    const [worker, ...ids] = params;
    for (const id of ids) {
      const row = rows.get(id);
      if (row.locked_by === worker && row.status === 'processing') {
        Object.assign(row, { status: row.attempts > 0 ? 'failed' : 'pending', locked_by: null });
      }
    }
    return [{ affectedRows: ids.length }];
  }
  return [[]];
}

const pool = {
  query: async (sql, params) => handle(sql, params),
  getConnection: async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    query: async (sql, params) => handle(sql, params),
  }),
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', { pool });
stub('../lib/notification', { createNotification: async (...args) => { notices.push(args); } });

const outbox = require('../lib/outbox');

function seed(count, extra = {}) {
  rows.clear();
  claimSizes.length = 0;
  notices.length = 0;
  for (let i = 1; i <= count; i += 1) {
    rows.set(`m${i}`, {
      id: `m${i}`, tenant_id: 't', channel: 'whatsapp', recipient: `2010000000${String(i).padStart(2, '0')}`,
      subject: null, payload_json: JSON.stringify({ message: `رسالة ${i}`, category: 'payment' }),
      status: 'pending', attempts: 0, locked_by: null, ref_type: null, ref_id: null, ...extra,
    });
  }
}

test('a few rows are claimed at a time, and the drain still sends its usual twenty', async () => {
  seed(12);
  const sent = [];
  const count = await outbox.drain({ whatsapp: async ({ recipient }) => { sent.push(recipient); return { ok: true }; } });
  assert.equal(count, 12);
  assert.equal(sent.length, 12, 'each message once');
  assert.ok(claimSizes.every(size => size <= outbox.CLAIM_BATCH), `claims of ${claimSizes.join(',')}`);
  assert.ok([...rows.values()].every(row => row.status === 'sent'));

  seed(12);
  assert.equal(await outbox.drain({ whatsapp: async () => ({ ok: true }) }, 7), 7, 'the limit is the pace it always kept');
  assert.deepEqual(claimSizes, [5, 2]);
  assert.equal([...rows.values()].filter(row => row.status === 'pending').length, 5);
});

test('a row another worker took back while this one was busy is not sent again', async () => {
  seed(3);
  const sent = [];
  await outbox.drain({
    whatsapp: async ({ recipient }) => {
      sent.push(recipient);
      // Its claim went stale and another drain reclaimed it mid-batch.
      if (recipient.endsWith('01')) rows.get('m2').locked_by = 'message-other-worker';
      return { ok: true };
    },
  });
  assert.deepEqual(sent, ['201000000001', '201000000003'], 'm2 belongs to the worker that reclaimed it');
  assert.equal(rows.get('m2').status, 'processing');
  assert.equal(rows.get('m2').locked_by, 'message-other-worker');
});

test('a drain past its time hands back what it did not reach, at once', async () => {
  seed(4);
  const sent = [];
  const count = await outbox.drain({
    whatsapp: async ({ recipient }) => {
      sent.push(recipient);
      await new Promise(resolve => setTimeout(resolve, 40));
      return { ok: true };
    },
  }, 20, { budgetMs: 20 });
  assert.equal(count, 1);
  assert.equal(sent.length, 1);
  for (const id of ['m2', 'm3', 'm4']) {
    assert.equal(rows.get(id).status, 'pending', `${id} is back in the queue`);
    assert.equal(rows.get(id).locked_by, null);
  }
});

test('a number that wrote «ستوب» is not retried, and nobody is told the message failed', async () => {
  seed(1, { payload_json: JSON.stringify({ message: 'عرض', category: 'marketing' }) });
  await outbox.drain({ whatsapp: async () => ({ ok: false, reason: 'opted_out' }) });
  const row = rows.get('m1');
  assert.equal(row.status, 'dead', 'a standing decision, not a delivery fault');
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'opted_out');
  assert.equal(notices.length, 0);

  // A real failure that gives up is still announced.
  seed(1, { attempts: outbox.MAX_ATTEMPTS - 1 });
  await outbox.drain({ whatsapp: async () => ({ ok: false, reason: 'invalid_number' }) });
  assert.equal(rows.get('m1').status, 'dead');
  assert.equal(notices.length, 1);
});

test('the claim and the refresh are scoped to the worker that holds the row', () => {
  const source = require('node:fs').readFileSync(require.resolve('../lib/outbox'), 'utf8');
  assert.match(source, /const CLAIM_BATCH = 5;/);
  assert.match(source, /if \(!await refreshClaim\(m, workerId\)\)/);
  // The refresh comes before the send, inside the loop over the claimed rows.
  const loop = source.slice(source.indexOf('async function drain('));
  assert.ok(loop.indexOf('refreshClaim(m, workerId)') < loop.indexOf('deliver(m, senders, workerId)'));
});
