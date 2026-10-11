'use strict';

// The message worker ran every 60 seconds from a bare setInterval: a tick still
// sending when the next fired meant two drains at once, and commission was
// recorded in the same tick, behind whatever WhatsApp was doing. Now three
// ticks, each guarded against itself (lib/jobLock.js exclusiveTick).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', { pool: {} });
const { exclusiveTick } = require('../lib/jobLock');

const quiet = { info() {}, warn() {} };
const passThrough = (_name, fn) => fn();

test('a tick that is still running is not started a second time', async () => {
  let release;
  let runs = 0;
  const tick = exclusiveTick('message_outbox', async () => {
    runs += 1;
    await new Promise(resolve => { release = resolve; });
    return 'done';
  }, { lock: passThrough, log: quiet });
  const first = tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await tick(), { skipped: true }, 'the next minute finds it busy');
  release();
  assert.equal(await first, 'done');
  assert.equal(runs, 1);
  // Free again once it finished.
  const again = tick();
  await new Promise(resolve => setImmediate(resolve));
  release();
  assert.equal(await again, 'done');
  assert.equal(runs, 2);
});

test('the tick takes the database lock too, so another process skips it', async () => {
  const names = [];
  const tick = exclusiveTick('finance_outbox', async () => 'ran', {
    lock: async (name, fn) => { names.push(name); return name === 'finance_outbox' ? { skipped: true } : fn(); },
    log: quiet,
  });
  assert.deepEqual(await tick(), { skipped: true });
  assert.deepEqual(names, ['finance_outbox']);
});

test('a failing tick is logged and the next one still runs', async () => {
  const warned = [];
  let calls = 0;
  const tick = exclusiveTick('job_queue', async () => { calls += 1; throw new Error('boom'); }, {
    lock: passThrough, log: { info() {}, warn: (...args) => warned.push(args.join(' ')) },
  });
  assert.deepEqual(await tick(), { failed: true });
  assert.deepEqual(await tick(), { failed: true });
  assert.equal(calls, 2);
  assert.match(warned[0], /job_queue tick failed/);
});

test('a slow WhatsApp tick does not hold commission back', async () => {
  let releaseMessages;
  const messages = exclusiveTick('message_outbox', () => new Promise(resolve => { releaseMessages = resolve; }), { lock: passThrough, log: quiet });
  let commission = 0;
  const finance = exclusiveTick('finance_outbox', async () => { commission += 1; }, { lock: passThrough, log: quiet });
  const pending = messages();
  await finance();
  assert.equal(commission, 1, 'recorded while the sends are still going');
  releaseMessages();
  await pending;
});

test('the scheduler runs messages, money and jobs as separate guarded ticks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'backgroundScheduler.js'), 'utf8');
  const tickBody = name => {
    const start = source.indexOf(`exclusiveTick('${name}'`);
    assert.ok(start > -1, name);
    const next = source.indexOf('exclusiveTick(', start + 10);
    return source.slice(start, next > -1 ? next : source.indexOf('repeat(messageWorker'));
  };
  assert.match(tickBody('message_outbox'), /outbox\.drain\(/);
  assert.doesNotMatch(tickBody('message_outbox'), /record_commission|drainFinanceOutbox/);
  assert.match(tickBody('finance_outbox'), /record_commission/);
  assert.doesNotMatch(tickBody('finance_outbox'), /outbox\.drain\(/);
  assert.match(tickBody('job_queue'), /queue\.processBatch/);
  for (const worker of ['messageWorker', 'financeWorker', 'jobWorker']) {
    assert.match(source, new RegExp(`repeat\\(${worker}, 60 \\* 1000\\)`));
  }
  assert.doesNotMatch(source, /const worker = async \(\) =>/, 'no unguarded shared tick');
});
