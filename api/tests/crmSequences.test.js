'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeSequenceSteps,
  assertTimezone,
  assertEmail,
  stopSequencesOnReply,
} = require('../lib/crmSequences');

test('CRM sequence steps are bounded and normalized', () => {
  assert.deepEqual(normalizeSequenceSteps([
    { delay_days: '1.256', subject: ' Hello ', body_html: ' <p>Body</p> ' },
  ]), [{ delay_days: 1.26, subject: 'Hello', body_html: '<p>Body</p>' }]);
  assert.throws(() => normalizeSequenceSteps([{ delay_days: -1, subject: 'x', body_html: 'x' }]), /Invalid/);
  assert.throws(() => normalizeSequenceSteps(Array.from({ length: 31 }, () => ({}))), /at most 30/);
});

test('CRM sequence timezone and email validation reject ambiguous delivery contracts', () => {
  assert.equal(assertTimezone('Africa/Cairo'), 'Africa/Cairo');
  assert.equal(assertEmail(' Test@Example.COM '), 'test@example.com');
  assert.throws(() => assertTimezone('Cairo-ish'), /Invalid IANA/);
  assert.throws(() => assertEmail('not-an-email'), /valid CRM email/);
});

test('reply exit is tenant-scoped and only closes sequences configured to exit', async () => {
  let call;
  const db = {
    async query(sql, params) {
      call = { sql, params };
      return [{ affectedRows: 2 }];
    },
  };
  assert.equal(await stopSequencesOnReply({ tenantId: 'tenant-a', leadId: 'lead-a' }, db), 2);
  assert.match(call.sql, /ds\.exit_on_reply=1/);
  assert.match(call.sql, /de\.tenant_id=\?/);
  assert.match(call.sql, /de\.lead_id=\?/);
  assert.deepEqual(call.params, ['reply_received', 'tenant-a', 'lead-a']);
});

test('CRM sequence route preserves history, freezes versions and enforces scope', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm-sequences.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '161_v25_crm_sequence_lifecycle.sql'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dripCampaigns.js'), 'utf8');
  const outbox = fs.readFileSync(path.join(__dirname, '..', 'lib', 'outbox.js'), 'utf8');
  assert.match(route, /requirePermission\('view_leads'\)/);
  assert.match(route, /requirePermission\('manage_leads'\)/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /steps_snapshot/);
  assert.match(route, /version=version\+\?/);
  assert.match(route, /archived_at=NOW\(\)/);
  assert.doesNotMatch(route, /DELETE FROM drip_sequences/);
  assert.match(route, /pause', 'resume', 'unenroll/);
  assert.match(worker, /crm_sequence_step_executions/);
  assert.match(worker, /refType: 'crm_sequence_step'/);
  assert.match(outbox, /row\.ref_type === 'crm_sequence_step'/);
  assert.match(migration, /UNIQUE KEY uq_crm_sequence_step/);
});
