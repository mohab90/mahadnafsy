'use strict';

// 11,257 leads were sitting in "new", older than thirty days, with nothing ever
// recorded against them. They are not a work list — they are what makes the work
// list unreadable.
//
// The risk in a job like this is archiving something someone is working, so the
// conditions are pinned here: never contacted, no follow-up date, still in an
// opening status, and old enough. And it stays off until the owner sets a
// number, because archiving thousands of leads is a decision, not a default.

const test = require('node:test');
const assert = require('node:assert');
const { archiveColdLeads, COLD_STATUSES } = require('../lib/leadAutoArchive');

/** A pool that records what it was asked and answers from a script. */
function stubPool(answers = []) {
  const calls = [];
  let step = 0;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      const answer = answers[step++];
      return answer === undefined ? [[]] : answer;
    },
  };
}

test('an unset, zero or negative age does nothing at all', async () => {
  for (const olderThanDays of [undefined, null, 0, -1, '', 'abc']) {
    const pool = stubPool();
    const result = await archiveColdLeads(pool, { olderThanDays });
    assert.deepStrictEqual(result, { eligible: 0, archived: 0 });
    assert.strictEqual(pool.calls.length, 0, 'must not touch the database');
  }
});

test('nothing eligible means nothing written', async () => {
  const pool = stubPool([[[{ eligible: 0 }]]]);
  const result = await archiveColdLeads(pool, { olderThanDays: 30 });
  assert.deepStrictEqual(result, { eligible: 0, archived: 0 });
  assert.strictEqual(pool.calls.length, 1, 'only the count runs');
});

test('the selection requires never-contacted, no follow-up, and an opening status', async () => {
  const pool = stubPool([[[{ eligible: 0 }]]]);
  await archiveColdLeads(pool, { olderThanDays: 45 });
  const { sql, params } = pool.calls[0];

  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM communications c WHERE c\.lead_id = l\.id\)/,
    'a lead with any recorded contact is somebody\'s work');
  assert.match(sql, /next_follow_up_date IS NULL/,
    'a scheduled follow-up means someone intended to come back');
  assert.match(sql, /deleted_at IS NULL/);
  assert.match(sql, /hidden = 0/);
  assert.match(sql, /created_at < DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
  assert.ok(params.includes(45), 'the age is bound, not interpolated');
  for (const status of COLD_STATUSES) {
    assert.ok(params.includes(status), `${status} should be in the cold set`);
  }
});

test('a converted or interested lead is never in the cold set', () => {
  for (const status of ['converted', 'interested', 'interested_booking', 'contacted', 'won']) {
    assert.ok(!COLD_STATUSES.includes(status), `${status} must not be archived automatically`);
  }
});

test('the run is capped even when far more qualify', async () => {
  // 11,257 qualify today. A job that rewrites all of them in one pass is not
  // what should happen the first night after this is switched on.
  const pool = stubPool([
    [[{ eligible: 11257 }]],
    [[{ id: 'a' }]],
    [{ affectedRows: 1 }],
    [[]],
  ]);
  const result = await archiveColdLeads(pool, { olderThanDays: 30, limit: 1 });
  assert.strictEqual(result.eligible, 11257);
  assert.ok(result.archived <= 1, 'archived no more than the cap');
});

test('archiving does not move updated_at', async () => {
  const pool = stubPool([
    [[{ eligible: 1 }]],
    [[{ id: 'lead-1' }]],
    [{ affectedRows: 1 }],
    [[]],
  ]);
  await archiveColdLeads(pool, { olderThanDays: 30 });
  const update = pool.calls.find(call => call.sql.startsWith('UPDATE leads'));
  assert.ok(update, 'an update should have run');
  assert.match(update.sql, /updated_at=updated_at/,
    'a machine archiving a neglected lead is not someone working it — letting the '
    + 'timestamp move would hide it from the reports that exist to surface neglect');
  assert.match(update.sql, /status='archived'/);
});

test('the update re-checks the status instead of trusting the earlier select', async () => {
  // Two runs overlapped once and each narrated the same 4,000 leads, because the
  // update filtered on id alone and so reported rows it had not transitioned.
  const pool = stubPool([
    [[{ eligible: 2 }]],
    [[{ id: 'a' }, { id: 'b' }]],
    [{ affectedRows: 2 }],
    [[]],
  ]);
  await archiveColdLeads(pool, { olderThanDays: 30 });
  const update = pool.calls.find(call => call.sql.startsWith('UPDATE leads'));
  assert.match(update.sql, /AND status IN \(\?,\?,\?,\?\)/,
    'the update must confirm the lead is still cold');
  for (const status of COLD_STATUSES) {
    assert.ok(update.params.includes(status), `${status} should be bound to the update`);
  }
});

test('a batch another run took is not narrated twice', async () => {
  // Update reports fewer rows than were selected: someone else archived part of
  // the batch, so this run writes no note for any of it.
  const pool = stubPool([
    [[{ eligible: 2 }]],
    [[{ id: 'a' }, { id: 'b' }]],
    [{ affectedRows: 1 }],   // contended
    [[]],                    // nothing left to select
  ]);
  const result = await archiveColdLeads(pool, { olderThanDays: 30 });
  assert.strictEqual(result.archived, 1, 'counts only what it actually changed');
  const wroteNote = pool.calls.some(call => /lead_timeline|INSERT/i.test(call.sql));
  assert.strictEqual(wroteNote, false,
    'a missing courtesy note is a smaller wrong than a duplicated one');
});
