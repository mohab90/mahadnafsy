'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { prioritizeLead, buildWorkQueue } = require('../lib/crmWorkQueue');

const NOW = new Date('2026-07-30T12:00:00.000Z');

test('CRM work queue prioritizes breached first response and overdue commit deals explainably', () => {
  const item = prioritizeLead({
    id: 'lead-a',
    status: 'interested',
    score: 80,
    interest_level: 'HIGH',
    forecast_category: 'commit',
    deal_value: 5000,
    created_at: '2026-07-27T12:00:00.000Z',
    next_follow_up_date: '2026-07-28T12:00:00.000Z',
    communication_count: 0,
  }, NOW);
  assert.equal(item.priorityBand, 'critical');
  assert.equal(item.nextAction, 'first_contact');
  assert.ok(item.reasons.includes('first_response_sla_breached'));
  assert.ok(item.reasons.includes('forecast_commit'));
  assert.ok(item.reasons.some(reason => reason.startsWith('follow_up_overdue:')));
});

test('CRM work queue is deterministic, bounded and excludes terminal leads', () => {
  const queue = buildWorkQueue([
    { id: 'low', status: 'new', created_at: NOW, score: 5, communication_count: 1 },
    { id: 'closed', status: 'converted', created_at: NOW, score: 100 },
    {
      id: 'high', status: 'interested', created_at: '2026-07-20',
      next_follow_up_date: '2026-07-29', score: 90, communication_count: 2,
    },
  ], { now: NOW, limit: 1 });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].id, 'high');
  assert.equal(queue.summary.total, 1);
});

test('CRM work queue endpoint is permissioned, tenant-bound and lead-scoped', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm-ops.js'), 'utf8');
  assert.match(route, /\/api\/admin\/crm\/work-queue/);
  assert.match(route, /requirePermission\('view_leads'\)/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /communications WHERE tenant_id=\?/);
  assert.match(route, /drip_enrollments[\s\S]*WHERE tenant_id=\?/);
});
